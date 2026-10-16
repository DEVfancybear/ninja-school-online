import { Injectable, computed, signal } from '@angular/core';
import {
  Opcode,
  type BattleEnd,
  type BattleEvent,
  type BattleResult,
  type BattleStart,
  type BattleTurn,
  type Combatant,
} from '@ninja/shared';

/** Trận đấu như client đang biết: ai đang hành động và còn bao lâu. */
export interface BattleSnapshot {
  readonly battleId: string;
  readonly roundNo: number;
  readonly actorId: string;
  readonly turnMs: number;
  readonly turnEndsAt: number;
  readonly participants: readonly Combatant[];
}

/** Số dòng nhật ký giữ lại; trận dài cũng không làm khung nhật ký phình ra. */
export const BATTLE_LOG_LIMIT = 60;

/** Nhịp vẽ lại đồng hồ lượt. Đồng hồ là thứ duy nhất cần cập nhật liên tục khi trận đang chạy. */
export const BATTLE_CLOCK_INTERVAL_MS = 200;

/**
 * Trạng thái trận đấu theo lượt ở phía client.
 *
 * Client **không** tự tính gì: sát thương, thứ tự lượt và phần thưởng đều do server quyết định và
 * tới đây qua `S2C_BATTLE_*`. Việc của service này là giữ trạng thái gần nhất và đếm ngược cho vui
 * mắt — đồng hồ đếm từ **lúc nhận gói**, không phải từ `turnEndsAt` của server, để máy lệch giờ
 * cũng không hiện số vô lý.
 */
@Injectable({ providedIn: 'root' })
export class BattleState {
  private readonly battleSignal = signal<BattleSnapshot | null>(null);
  private readonly logSignal = signal<readonly BattleEvent[]>([]);
  private readonly outcomeSignal = signal<BattleEnd | null>(null);
  private readonly selfIdSignal = signal<string | null>(null);
  private readonly remainingSignal = signal(0);

  /** Thời điểm nhận gói đổi lượt gần nhất; `0` là không có lượt nào đang chạy. */
  private turnReceivedAt = 0;
  private clock: ReturnType<typeof setInterval> | null = null;

  readonly battle = this.battleSignal.asReadonly();
  readonly log = this.logSignal.asReadonly();
  /** Kết quả trận vừa xong; `null` khi chưa có. Trang chơi đóng bảng này bằng `closeOutcome()`. */
  readonly outcome = this.outcomeSignal.asReadonly();
  /** Số mili giây còn lại của lượt đang chạy (đã trừ thời gian từ lúc nhận gói). */
  readonly remainingMs = this.remainingSignal.asReadonly();

  /** Người đang tới lượt; `null` khi lượt đó thuộc về quái. */
  readonly actor = computed<Combatant | null>(() => {
    const battle = this.battleSignal();
    if (!battle) {
      return null;
    }
    return battle.participants.find((entry) => entry.id === battle.actorId) ?? null;
  });

  /** Nhân vật của mình trong trận. */
  readonly me = computed<Combatant | null>(() => {
    const selfId = this.selfIdSignal();
    return selfId === null
      ? null
      : (this.battleSignal()?.participants.find((entry) => entry.id === selfId) ?? null);
  });

  /** Con quái của trận (M3: một trận một con). */
  readonly monster = computed<Combatant | null>(
    () => this.battleSignal()?.participants.find((entry) => entry.kind === 'monster') ?? null,
  );

  readonly isMyTurn = computed(() => {
    const battle = this.battleSignal();
    const selfId = this.selfIdSignal();
    return (
      battle !== null &&
      selfId !== null &&
      battle.actorId === selfId &&
      this.outcomeSignal() === null
    );
  });

  readonly inBattle = computed(() => this.battleSignal() !== null);

  setSelfId(characterId: string | null): void {
    this.selfIdSignal.set(characterId);
  }

  /** Áp một gói server gửi xuống; trả về `false` nếu gói không thuộc phần trận đấu. */
  applyPacket(op: number, payload: unknown): boolean {
    switch (op) {
      case Opcode.S2C_BATTLE_START:
        this.start(payload as BattleStart);
        return true;
      case Opcode.S2C_BATTLE_TURN:
        this.turn(payload as BattleTurn);
        return true;
      case Opcode.S2C_BATTLE_RESULT:
        this.appendLog((payload as BattleResult).events);
        this.replaceParticipants((payload as BattleResult).participants);
        return true;
      case Opcode.S2C_BATTLE_END:
        this.end(payload as BattleEnd);
        return true;
      default:
        return false;
    }
  }

  /** Đóng bảng kết trận; trận đã kết thúc nên không còn gì phải giữ. */
  closeOutcome(): void {
    this.outcomeSignal.set(null);
    this.battleSignal.set(null);
    this.logSignal.set([]);
    this.stopClock();
  }

  /** Mất kết nối hoặc rời trang: bỏ toàn bộ trạng thái trận. */
  reset(): void {
    this.closeOutcome();
  }

  private start(payload: BattleStart): void {
    this.outcomeSignal.set(null);
    this.battleSignal.set({
      battleId: payload.battleId,
      roundNo: payload.roundNo,
      actorId: payload.actorId,
      turnMs: payload.turnMs,
      turnEndsAt: payload.turnEndsAt,
      participants: payload.participants,
    });
    this.restartClock(payload.turnMs);
  }

  private turn(payload: BattleTurn): void {
    const battle = this.battleSignal();
    if (!battle || battle.battleId !== payload.battleId) {
      // Đổi lượt của trận khác (trận cũ vừa bị đóng): bỏ qua, tránh trộn hai trận vào nhau.
      return;
    }
    this.battleSignal.set({
      ...battle,
      roundNo: payload.roundNo,
      actorId: payload.actorId,
      turnMs: payload.turnMs,
      turnEndsAt: payload.turnEndsAt,
    });
    this.restartClock(payload.turnMs);
  }

  private end(payload: BattleEnd): void {
    this.replaceParticipants(payload.participants);
    this.outcomeSignal.set(payload);
    this.stopClock();
  }

  private replaceParticipants(participants: readonly Combatant[]): void {
    const battle = this.battleSignal();
    if (!battle) {
      return;
    }
    this.battleSignal.set({ ...battle, participants });
  }

  private appendLog(events: readonly BattleEvent[]): void {
    if (events.length === 0) {
      return;
    }
    this.logSignal.update((lines) => [...lines, ...events].slice(-BATTLE_LOG_LIMIT));
  }

  private restartClock(turnMs: number): void {
    this.turnReceivedAt = Date.now();
    this.remainingSignal.set(turnMs);
    if (this.clock !== null) {
      return;
    }
    this.clock = setInterval(() => {
      this.tickClock();
    }, BATTLE_CLOCK_INTERVAL_MS);
  }

  private tickClock(): void {
    const battle = this.battleSignal();
    if (!battle) {
      this.stopClock();
      return;
    }
    this.remainingSignal.set(Math.max(0, battle.turnMs - (Date.now() - this.turnReceivedAt)));
  }

  private stopClock(): void {
    if (this.clock !== null) {
      clearInterval(this.clock);
      this.clock = null;
    }
    this.remainingSignal.set(0);
  }
}
