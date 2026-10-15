import {
  ChangeDetectionStrategy,
  Component,
  InjectionToken,
  type OnDestroy,
  type OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  CHAT_MAX_LENGTH,
  ErrorCode,
  MAX_CHARACTERS_PER_ACCOUNT,
  Opcode,
  TICK_RATE_MS,
  type Character,
  type Notify,
} from '@ninja/shared';
import { apiErrorMessage } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { CharacterService } from '../../core/character/character.service';
import { WorldCanvas } from '../../game/world-canvas/world-canvas';
import { WorldTestHook } from '../../game/test-hook';
import { type Point } from '../../game/world-logic';
import { isTypingTarget } from '../../input/key-map';
import { MOVE_COMMAND_INTERVAL_MS, MovementController } from '../../input/movement-controller';
import { GameSocket, type SocketError } from '../../net/game-socket';
import { type Facing } from '../../net/world-types';
import { WorldState } from '../../net/world-state';
import { ChatPanel } from '../../ui/chat-panel/chat-panel';
import { Hud } from '../../ui/hud/hud';
import { NoticeBar } from '../../ui/notice-bar/notice-bar';
import { NpcDialogPanel } from '../../ui/npc-dialog/npc-dialog';

/** Thời gian thanh thông báo tự ẩn. */
export const NOTICE_HIDE_MS = 4000;

/**
 * Sau khi bắt tay xong, chờ ngần này mili giây cho `S2C_ENTER_MAP`.
 *
 * Hợp đồng không nói rõ server tự gửi dữ liệu map sau `S2C_HELLO` hay chờ client xin bằng
 * `C2S_ENTER_MAP`. Cách này chạy đúng với cả hai: nếu server tự gửi thì bộ đếm bị huỷ, còn
 * nếu không thì client xin lại bằng đúng `mapId` server vừa báo trong `S2C_HELLO`.
 */
export const SNAPSHOT_FALLBACK_MS = 2000;

/** Cho phép kiểm thử rút ngắn thời gian chờ trên. */
export const SNAPSHOT_FALLBACK_DELAY = new InjectionToken<number>('ninja.snapshot-fallback-ms', {
  providedIn: 'root',
  factory: () => SNAPSHOT_FALLBACK_MS,
});

/**
 * Trang `/play`: vào thế giới ninja.
 *
 * Việc của trang: xác nhận có nhân vật, mở kết nối WebSocket, nối dữ liệu thế giới vào canvas
 * Phaser, và gom các lớp giao diện (HUD, chat, hội thoại NPC, thanh thông báo, lớp phủ mất
 * kết nối) lên trên canvas.
 */
@Component({
  selector: 'app-play',
  imports: [RouterLink, WorldCanvas, Hud, ChatPanel, NpcDialogPanel, NoticeBar],
  templateUrl: './play.html',
  styleUrl: './play.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Play implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly characters = inject(CharacterService);
  private readonly socket = inject(GameSocket);
  private readonly world = inject(WorldState);
  private readonly testHook = inject(WorldTestHook);
  private readonly snapshotFallbackMs = inject(SNAPSHOT_FALLBACK_DELAY);

  /** Nhân vật muốn vào, lấy từ `?characterId=` khi đi từ trang nhân vật. */
  readonly characterId = input<string | undefined>(undefined);

  /** Giới hạn nhân vật mỗi tài khoản — dùng cho câu hướng dẫn khi tài khoản chưa có nhân vật. */
  readonly maxCharacters = MAX_CHARACTERS_PER_ACCOUNT;

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly noCharacter = signal(false);
  readonly started = signal(false);
  readonly chatVisible = signal(true);
  readonly notice = signal<string | null>(null);
  readonly chatNotice = signal<string | null>(null);
  readonly localFacing = signal<Facing | null>(null);

  private readonly character = signal<Character | null>(null);

  readonly status = this.socket.status;
  readonly latencyMs = this.socket.latencyMs;
  readonly online = this.socket.isReady;
  readonly map = this.world.map;
  readonly entities = this.world.entities;
  readonly selfId = this.world.selfId;
  readonly chat = this.world.chat;
  readonly dialog = this.world.npcDialog;
  readonly tickRateMs = this.world.tickRateMs;

  readonly characterName = computed(
    () => this.world.self()?.name ?? this.character()?.name ?? '',
  );
  readonly mapName = computed(() => this.world.mapName());

  /** Lỗi ở mức kết nối mà việc nối lại không giải quyết được. */
  readonly fatalError = computed(() => {
    const error = this.socket.error();
    return error && error.fatal ? error : null;
  });

  /** Chỉ hiện lớp phủ khi vẫn còn hy vọng nối lại được. */
  readonly reconnecting = computed(
    () =>
      this.started() &&
      !this.noCharacter() &&
      this.fatalError() === null &&
      this.status() !== 'ready',
  );

  readonly reconnectingText = computed(() => {
    switch (this.status()) {
      case 'connecting':
        return 'Đang kết nối tới máy chủ…';
      case 'handshaking':
        return 'Đang bắt tay với máy chủ…';
      case 'error':
        return this.socket.error()?.message ?? 'Kết nối đã dừng.';
      default:
        return 'Đang kết nối lại…';
    }
  });

  private readonly movement = new MovementController((destination) => {
    this.socket.send(Opcode.C2S_MOVE, destination);
  });

  private moveTimer?: ReturnType<typeof setInterval>;
  private noticeTimer?: ReturnType<typeof setTimeout>;
  private chatNoticeTimer?: ReturnType<typeof setTimeout>;
  private snapshotTimer?: ReturnType<typeof setTimeout>;
  /** Lần bắt tay đã nhận được dữ liệu map; 0 nghĩa là chưa nhận lần nào. */
  private snapshotEpoch = 0;
  private unsubscribe?: () => void;

  constructor() {
    // Rời khỏi `ready` (mất mạng, chưa nối được) là bỏ ngay dữ liệu thế giới cũ. Xoá ở đây,
    // lúc trạng thái đổi, chứ không xoá lúc bắt tay xong — làm vậy sẽ xoá nhầm bản đồ vừa nhận.
    effect(() => {
      const status = this.socket.status();
      untracked(() => {
        if (status === 'ready') {
          return;
        }
        this.world.reset();
        this.movement.reset();
        this.localFacing.set(null);
        this.snapshotEpoch = 0;
        this.clearSnapshotTimer();
      });
    });

    // Bắt tay xong: lấy nhịp tick mới và chờ (hoặc xin lại) dữ liệu map.
    effect(() => {
      const epoch = this.socket.connectionEpoch();
      if (epoch === 0) {
        return;
      }
      untracked(() => this.onHandshake(epoch));
    });

    // Lỗi mức kết nối: thanh thông báo + hướng dẫn theo mã lỗi.
    effect(() => {
      const error = this.socket.error();
      if (!error) {
        return;
      }
      untracked(() => this.onSocketError(error));
    });
  }

  ngOnInit(): void {
    this.testHook.install({ clickEntity: (name) => this.clickEntityByName(name) });
    void this.start();
  }

  ngOnDestroy(): void {
    this.testHook.uninstall();
    this.stopInput();
    this.clearSnapshotTimer();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.socket.disconnect();
    this.world.reset();
  }

  /** Tải danh sách nhân vật rồi mở kết nối; gọi lại được khi người chơi bấm "Thử lại". */
  async start(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    this.noCharacter.set(false);

    let list: Character[];
    try {
      list = await this.characters.list();
    } catch (error) {
      this.loadError.set(apiErrorMessage(error));
      this.loading.set(false);
      return;
    }

    if (list.length === 0) {
      this.noCharacter.set(true);
      this.loading.set(false);
      return;
    }

    const wanted = this.characterId();
    const chosen = (wanted ? list.find((item) => item.id === wanted) : undefined) ?? list[0];
    const credential = this.auth.accessToken();
    if (!credential) {
      this.loadError.set('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.');
      this.loading.set(false);
      return;
    }

    this.character.set(chosen);
    this.unsubscribe?.();
    this.unsubscribe = this.socket.onPacket(this.handlePacket);
    this.started.set(true);
    this.socket.connect({ credential, characterId: chosen.id });
    this.startInput();
    this.loading.set(false);
  }

  toggleChat(): void {
    this.chatVisible.update((visible) => !visible);
  }

  closeDialog(): void {
    this.world.closeDialog();
  }

  /** Bấm vào một ô trên bản đồ (từ canvas Phaser). */
  onMoveTo(destination: Point): void {
    this.movement.requestDestination(destination);
  }

  /** Bấm vào một NPC (từ canvas Phaser). */
  talkTo(npcId: string): void {
    this.socket.send(Opcode.C2S_NPC_TALK, { npcId });
  }

  onChatSend(text: string): void {
    const trimmed = text.trim().slice(0, CHAT_MAX_LENGTH);
    if (trimmed.length === 0) {
      return;
    }
    if (!this.online()) {
      this.showChatNotice('Chưa kết nối tới máy chủ nên tin nhắn chưa gửi đi được.');
      return;
    }
    this.socket.send(Opcode.C2S_CHAT, { channel: 'map', text: trimmed });
  }

  // ------------------------------------------------------------------ nội bộ

  private readonly handlePacket = (op: number, payload: unknown): void => {
    if (op === Opcode.S2C_ENTER_MAP) {
      // Dữ liệu map này thuộc lần bắt tay hiện tại: không cần xin lại nữa.
      this.snapshotEpoch = this.socket.connectionEpoch();
      this.clearSnapshotTimer();
    } else if (op === Opcode.S2C_NOTIFY) {
      this.showNotice((payload as Notify).message);
    }
    this.world.applyPacket(op, payload);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target)) {
      return;
    }
    if (this.movement.press(event.key)) {
      event.preventDefault();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target)) {
      return;
    }
    if (this.movement.release(event.key)) {
      event.preventDefault();
    }
  };

  private startInput(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.moveTimer = setInterval(() => this.tickMovement(), MOVE_COMMAND_INTERVAL_MS);
  }

  private stopInput(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    if (this.moveTimer !== undefined) {
      clearInterval(this.moveTimer);
      this.moveTimer = undefined;
    }
    this.movement.reset();
    this.localFacing.set(null);
  }

  private tickMovement(): void {
    const self = this.world.self();
    this.movement.tick(Date.now(), self ? { x: self.x, y: self.y } : null);
    this.localFacing.set(this.movement.moving ? this.movement.facing() : null);
  }

  private onHandshake(epoch: number): void {
    this.world.setTickRate(this.socket.serverHello()?.tickRateMs ?? TICK_RATE_MS);
    this.movement.reset();
    this.localFacing.set(null);
    this.chatNotice.set(null);
    if (this.snapshotEpoch === epoch) {
      this.clearSnapshotTimer();
      return;
    }
    this.armSnapshotFallback(epoch);
  }

  private onSocketError(error: SocketError): void {
    this.showNotice(error.message);
    if (error.code === ErrorCode.RATE_LIMITED) {
      this.showChatNotice('Bạn gửi tin nhắn quá nhanh, chờ một chút rồi gửi lại.');
    }
    if (error.code === ErrorCode.NO_CHARACTER) {
      this.noCharacter.set(true);
    }
    if (error.fatal) {
      this.stopInput();
    }
  }

  private armSnapshotFallback(epoch: number): void {
    this.clearSnapshotTimer();
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = undefined;
      if (this.snapshotEpoch === epoch || this.socket.connectionEpoch() !== epoch) {
        return;
      }
      const mapId = this.socket.serverHello()?.mapId;
      if (mapId) {
        this.socket.send(Opcode.C2S_ENTER_MAP, { mapId });
      }
    }, this.snapshotFallbackMs);
  }

  private clearSnapshotTimer(): void {
    if (this.snapshotTimer !== undefined) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = undefined;
    }
  }

  private showNotice(message: string): void {
    this.notice.set(message);
    if (this.noticeTimer !== undefined) {
      clearTimeout(this.noticeTimer);
    }
    this.noticeTimer = setTimeout(() => {
      this.noticeTimer = undefined;
      this.notice.set(null);
    }, NOTICE_HIDE_MS);
  }

  private showChatNotice(message: string): void {
    this.chatNotice.set(message);
    if (this.chatNoticeTimer !== undefined) {
      clearTimeout(this.chatNoticeTimer);
    }
    this.chatNoticeTimer = setTimeout(() => {
      this.chatNoticeTimer = undefined;
      this.chatNotice.set(null);
    }, NOTICE_HIDE_MS);
  }

  /** Dùng chung cho cú bấm thật ngoài canvas và hàm hook của kiểm thử đầu-cuối. */
  private clickEntityByName(name: string): void {
    const entity = this.world.entities().find((candidate) => candidate.name === name);
    if (!entity) {
      return;
    }
    if (entity.kind === 'npc') {
      this.talkTo(entity.id);
      return;
    }
    this.onMoveTo({ x: entity.x, y: entity.y });
  }
}
