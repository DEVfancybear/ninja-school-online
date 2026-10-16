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
  MAX_MOVE_DISTANCE_PX,
  MONSTER_ENGAGE_RANGE_PX,
  Opcode,
  TICK_RATE_MS,
  type BattleAction,
  type Character,
  type EquipSlot,
  type Notify,
  type UpgradeResult,
} from '@ninja/shared';
import { apiErrorMessage } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { CharacterService } from '../../core/character/character.service';
import { WorldCanvas } from '../../game/world-canvas/world-canvas';
import { WorldTestHook } from '../../game/test-hook';
import { type Point } from '../../game/world-logic';
import { isTypingTarget } from '../../input/key-map';
import { MOVE_COMMAND_INTERVAL_MS, MovementController } from '../../input/movement-controller';
import { BattleState } from '../../net/battle-state';
import { GameSocket, type SocketError } from '../../net/game-socket';
import { type Facing } from '../../net/world-types';
import { WorldState } from '../../net/world-state';
import { BattlePanel, type BattleActionRequest } from '../../ui/battle-panel/battle-panel';
import { ChatPanel } from '../../ui/chat-panel/chat-panel';
import { EquipmentPanel } from '../../ui/equipment-panel/equipment-panel';
import { Hud } from '../../ui/hud/hud';
import { InventoryPanel } from '../../ui/inventory-panel/inventory-panel';
import { NoticeBar } from '../../ui/notice-bar/notice-bar';
import { NpcDialogPanel } from '../../ui/npc-dialog/npc-dialog';
import { ShopPanel } from '../../ui/shop-panel/shop-panel';

/** Thời gian thanh thông báo tự ẩn. */
export const NOTICE_HIDE_MS = 4000;

/**
 * Đuổi theo quái ở xa: đi được quãng này kể từ lệnh trước thì gửi chặng mới — đủ thưa để không
 * thành một tràng lệnh, mà vẫn bám sát đường đi.
 */
export const APPROACH_REISSUE_PX = 48;

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
  imports: [
    RouterLink,
    WorldCanvas,
    Hud,
    ChatPanel,
    NpcDialogPanel,
    NoticeBar,
    BattlePanel,
    InventoryPanel,
    EquipmentPanel,
    ShopPanel,
  ],
  templateUrl: './play.html',
  styleUrl: './play.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Play implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly characters = inject(CharacterService);
  private readonly socket = inject(GameSocket);
  private readonly world = inject(WorldState);
  private readonly battleState = inject(BattleState);
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
  readonly bagOpen = signal(false);
  /** Mở/đóng bảng trang bị; mặc và tháo đều không tự đóng bảng để còn mặc tiếp món khác. */
  readonly equipmentOpen = signal(false);
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
  /** Chỉ số nhân vật (máu, nội lực, cấp, chiêu) — khác `character` là dữ liệu REST của nhân vật. */
  readonly stats = this.world.character;
  readonly inventory = this.world.inventory;
  readonly bagCapacity = this.world.inventoryCapacity;
  readonly equipment = this.world.equipment;
  readonly battle = this.battleState.battle;
  readonly battleLog = this.battleState.log;
  readonly battleOutcome = this.battleState.outcome;
  readonly battleRemainingMs = this.battleState.remainingMs;
  readonly isMyTurn = this.battleState.isMyTurn;
  readonly inBattle = this.battleState.inBattle;

  readonly characterName = computed(() => this.world.self()?.name ?? this.character()?.name ?? '');
  readonly mapName = computed(() => this.world.mapName());

  /**
   * Quầy hàng của NPC đang nói chuyện. Bảng shop sống theo hội thoại nên không có trạng thái riêng:
   * đóng hội thoại là đóng luôn quầy, còn NPC chỉ nói chuyện thì `S2C_NPC_DIALOG` gửi `shop` null.
   */
  readonly shopCounter = computed(() => {
    const dialog = this.dialog();
    return dialog?.shop ? { npcName: dialog.npcName, shop: dialog.shop } : null;
  });

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
  /**
   * Quái người chơi vừa bấm nhưng còn ở ngoài tầm: đi tới gần rồi tự xin vào trận. Xoá khi đã vào
   * trận, khi con quái biến mất, khi mất kết nối, hoặc khi người chơi bấm chỗ khác.
   */
  private pendingAttackId: string | null = null;

  /** Chặng đang đi khi đuổi theo con quái ở xa; `null` khi không đuổi theo con nào. */
  private approachLeg: { from: Point; to: Point } | null = null;

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
        this.battleState.reset();
        this.movement.reset();
        this.localFacing.set(null);
        this.snapshotEpoch = 0;
        this.pendingAttackId = null;
        this.approachLeg = null;
        this.bagOpen.set(false);
        this.equipmentOpen.set(false);
        this.clearSnapshotTimer();
      });
    });

    // Lên cấp: báo cho người chơi biết mình vừa mạnh lên và học được chiêu gì.
    effect(() => {
      const levelUp = this.world.lastLevelUp();
      if (!levelUp) {
        return;
      }
      untracked(() => {
        const learned = levelUp.learnedSkills.map((skill) => skill.name).join(', ');
        this.showNotice(
          `Lên cấp ${levelUp.character.level}!` + (learned ? ` Học được: ${learned}.` : ''),
        );
        this.world.clearLevelUp();
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
    this.testHook.install({
      clickEntity: (name) => this.clickEntityByName(name),
      attackMonster: (name) => {
        // Nhiều con quái cùng loại dùng chung một tên, nên chọn con còn sống đầu tiên.
        const monster = this.world
          .entities()
          .find(
            (entity) => entity.name === name && entity.kind === 'monster' && (entity.hp ?? 1) > 0,
          );
        if (monster) {
          this.onAttackMonster(monster.id);
        }
      },
      attackMonsterAt: (index) => {
        const monster = this.world.entities().filter((entity) => entity.kind === 'monster')[index];
        if (monster) {
          this.onAttackMonster(monster.id);
        }
      },
      useItem: (itemId) => this.onUseItem(itemId),
      toggleInventory: (open) => this.setInventoryOpen(open),
      inventoryOpen: () => this.bagOpen(),
      toggleEquipment: (open) => this.setEquipmentOpen(open),
      equipmentOpen: () => this.equipmentOpen(),
      closeBattle: () => this.dismissBattleOutcome(),
      lastError: () => this.notice(),
    });
    void this.start();
  }

  ngOnDestroy(): void {
    this.testHook.uninstall();
    this.stopInput();
    this.clearSnapshotTimer();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.socket.disconnect();
    this.battleState.reset();
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
    if (this.inBattle()) {
      // Trong trận thì đứng yên (server cũng từ chối lệnh di chuyển), nhưng chặn ở đây cho đỡ gửi.
      return;
    }
    this.pendingAttackId = null;
    this.approachLeg = null;
    this.movement.requestDestination(destination);
  }

  /**
   * Bấm vào một con quái (từ canvas Phaser): đủ gần thì xin vào trận ngay, còn xa thì đi tới trước.
   * Tầm được so bằng đúng con số server dùng (`MONSTER_ENGAGE_RANGE_PX`) để không có chuyện client
   * tưởng đã đủ gần rồi bị từ chối.
   */
  onAttackMonster(monsterId: string): void {
    if (this.inBattle()) {
      return;
    }
    const self = this.world.self();
    const monster = this.world.entities().find((entity) => entity.id === monsterId);
    if (!self || !monster) {
      return;
    }
    if (distance(self, monster) <= MONSTER_ENGAGE_RANGE_PX) {
      this.pendingAttackId = null;
      this.approachLeg = null;
      this.movement.reset();
      this.socket.send(Opcode.C2S_ATTACK_MOB, { targetId: monster.id });
      return;
    }
    this.pendingAttackId = monsterId;
    this.approachLeg = null;
    this.approachPendingMonster(monster);
  }

  /** Người chơi chọn một hành động trong trận (từ bảng trận đấu). */
  onBattleAction(request: BattleActionRequest): void {
    const battle = this.battleState.battle();
    if (!battle) {
      return;
    }
    const targetId = this.battleState.monster()?.alive
      ? (this.battleState.monster()?.id ?? undefined)
      : undefined;
    const payload: BattleAction = { battleId: battle.battleId, ...request, targetId };
    this.socket.send(Opcode.C2S_BATTLE_ACTION, payload);
  }

  /** Đóng bảng kết trận. */
  dismissBattleOutcome(): void {
    this.battleState.closeOutcome();
  }

  toggleInventory(): void {
    this.bagOpen.update((open) => !open);
  }

  setInventoryOpen(open: boolean): void {
    this.bagOpen.set(open);
  }

  toggleEquipment(): void {
    this.equipmentOpen.update((open) => !open);
  }

  setEquipmentOpen(open: boolean): void {
    this.equipmentOpen.set(open);
  }

  /** Dùng một vật phẩm ngoài trận (trong trận phải dùng qua lượt của mình). */
  onUseItem(itemId: string): void {
    if (this.inBattle()) {
      this.showNotice('Đang trong trận, hãy dùng vật phẩm ở lượt của bạn.');
      return;
    }
    this.socket.send(Opcode.C2S_USE_ITEM, { itemId });
  }

  /** Mặc một món trong túi. Chỉ số sau khi mặc do server gửi lại bằng `S2C_CHARACTER`, client không tự cộng. */
  onEquip(itemId: string): void {
    this.socket.send(Opcode.C2S_EQUIP, { itemId });
  }

  /** Tháo món ở một ô trang bị. */
  onUnequip(slot: EquipSlot): void {
    this.socket.send(Opcode.C2S_UNEQUIP, { slot });
  }

  /** Mua một món ở quầy đang mở; bấm nhiều lần là mua nhiều món. */
  onShopBuy(itemId: string): void {
    this.socket.send(Opcode.C2S_SHOP_BUY, { itemId, quantity: 1 });
  }

  /** Bán một món trong túi; bấm nhiều lần là bán nhiều món. */
  onShopSell(itemId: string): void {
    this.socket.send(Opcode.C2S_SHOP_SELL, { itemId, quantity: 1 });
  }

  /** Thử cường hóa một món; kết quả về sau bằng `S2C_UPGRADE_RESULT`. */
  onUpgrade(itemId: string): void {
    this.socket.send(Opcode.C2S_UPGRADE, { itemId });
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
    if (op === Opcode.S2C_CHARACTER || op === Opcode.S2C_LEVEL_UP) {
      // "Ai đang chơi" là điều kiện để biết lượt nào là của mình trong trận.
      this.battleState.setSelfId((payload as { id?: string }).id ?? this.world.selfId());
    }
    if (op === Opcode.S2C_ENTER_MAP) {
      // Dữ liệu map này thuộc lần bắt tay hiện tại: không cần xin lại nữa.
      this.snapshotEpoch = this.socket.connectionEpoch();
      this.clearSnapshotTimer();
      // Id nhân vật nằm ngay trong gói này, nên biết "ai là mình" không cần chờ gói chỉ số.
      this.battleState.setSelfId(this.world.selfId());
    } else if (op === Opcode.S2C_NOTIFY) {
      this.showNotice((payload as Notify).message);
    } else if (op === Opcode.S2C_UPGRADE_RESULT) {
      this.onUpgradeResult(payload as UpgradeResult);
    }
    if (!this.battleState.applyPacket(op, payload)) {
      this.world.applyPacket(op, payload);
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target) || this.inBattle()) {
      return;
    }
    if (this.movement.press(event.key)) {
      event.preventDefault();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target) || this.inBattle()) {
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
    this.tryEngagePendingMonster();
    if (this.inBattle()) {
      // Trong trận thì không gửi lệnh di chuyển nào; hướng đứng yên cũng bỏ để nhân vật đứng lại.
      this.localFacing.set(null);
      return;
    }
    const self = this.world.self();
    this.movement.tick(Date.now(), self ? { x: self.x, y: self.y } : null);
    this.localFacing.set(this.movement.moving ? this.movement.facing() : null);
  }

  private onHandshake(epoch: number): void {
    this.world.setTickRate(this.socket.serverHello()?.tickRateMs ?? TICK_RATE_MS);
    this.movement.reset();
    this.localFacing.set(null);
    this.chatNotice.set(null);
    this.pendingAttackId = null;
    this.approachLeg = null;
    this.battleState.reset();
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

  /**
   * Kết quả cường hóa: server đã soạn câu tiếng Việt nên client hiện thẳng `message`, chỉ nhắc thêm
   * tỉ lệ của chính lần thử này (trường `successRate` có sẵn để nói cho người chơi biết lần vừa rồi
   * khó tới đâu). Tỉ lệ 100% thì không cần nhắc.
   */
  private onUpgradeResult(result: UpgradeResult): void {
    const rate = Math.round(result.successRate * 100);
    this.showNotice(result.successRate < 1 ? `${result.message} (tỉ lệ ${rate}%)` : result.message);
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

  /**
   * Người chơi đã bấm một con quái ở xa: mỗi khung hình kiểm lại khoảng cách, tới đủ tầm thì xin vào
   * trận. Kiểm ở vòng lặp khung hình (chứ không phải `effect`) vì đây là việc phụ thuộc **thời gian
   * và vị trí**, đúng chỗ mà vòng lặp này đã chạy mỗi khung hình.
   */
  private tryEngagePendingMonster(): void {
    const pending = this.pendingAttackId;
    if (pending === null) {
      return;
    }
    if (this.inBattle()) {
      this.pendingAttackId = null;
      this.approachLeg = null;
      return;
    }
    const self = this.world.self();
    const monster = this.world.entities().find((entity) => entity.id === pending);
    if (!self || !monster || (monster.hp ?? 1) <= 0) {
      this.pendingAttackId = null;
      this.approachLeg = null;
      return;
    }
    if (distance(self, monster) <= MONSTER_ENGAGE_RANGE_PX) {
      this.pendingAttackId = null;
      this.approachLeg = null;
      this.socket.send(Opcode.C2S_ATTACK_MOB, { targetId: monster.id });
      return;
    }
    this.approachPendingMonster(monster);
  }

  /**
   * Đi từng chặng tới con quái đang nhắm: một lệnh `C2S_MOVE` chỉ được xa tối đa
   * `MAX_MOVE_DISTANCE_PX`, nên quái ở xa hơn phải nối nhiều chặng mới tới nơi. Chặng mới chỉ gửi
   * khi nhân vật đã nhích được một quãng hoặc đã tới đầu chặng cũ — nhờ vậy điểm đến bị chặn (hoặc
   * lệnh bị server từ chối) không thành một tràng lệnh lặp lại mỗi khung hình.
   */
  private approachPendingMonster(monster: Point): void {
    const self = this.world.self();
    if (!self) {
      return;
    }
    const dx = monster.x - self.x;
    const dy = monster.y - self.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) {
      return;
    }
    const legLength = Math.min(dist, MAX_MOVE_DISTANCE_PX);
    const destination = {
      x: self.x + (dx / dist) * legLength,
      y: self.y + (dy / dist) * legLength,
    };
    const leg = this.approachLeg;
    const reachedLeg = leg !== null && distance(leg.to, self) <= APPROACH_REISSUE_PX;
    const movedOn = leg !== null && distance(leg.from, self) >= APPROACH_REISSUE_PX;
    if (leg !== null && !reachedLeg && !movedOn) {
      return;
    }
    this.approachLeg = { from: { x: self.x, y: self.y }, to: destination };
    this.movement.requestDestination(destination);
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
    if (entity.kind === 'monster') {
      this.onAttackMonster(entity.id);
      return;
    }
    this.onMoveTo({ x: entity.x, y: entity.y });
  }
}

/** Khoảng cách giữa hai điểm trong hệ toạ độ thế giới (pixel). */
function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
