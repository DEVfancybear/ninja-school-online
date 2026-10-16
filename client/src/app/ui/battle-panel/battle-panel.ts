import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import {
  BATTLE_TURN_SECONDS,
  type BattleEnd,
  type BattleEvent,
  type CharacterStats,
  type Combatant,
  type InventoryItem,
} from '@ninja/shared';
import type { BattleSnapshot } from '../../net/battle-state';

/** Hành động người chơi chọn trong lượt của mình; trang `/play` đổi nó thành gói tin. */
export type BattleActionRequest =
  | { readonly action: 'attack' }
  | { readonly action: 'skill'; readonly skillId: string }
  | { readonly action: 'item'; readonly itemId: string }
  | { readonly action: 'flee' };

/** Bảng hành động cần dữ liệu này để vẽ nút nào bấm được. */
interface SkillButton {
  readonly skillId: string;
  readonly name: string;
  readonly costMp: number;
  readonly cooldownTurns: number;
  readonly readyInTurns: number;
  readonly disabled: boolean;
}

/** Ngưỡng đổi màu đồng hồ lượt: dưới ngần này giây thì đỏ và nhấp nháy. */
export const BATTLE_URGENT_SECONDS = 5;

/**
 * Lớp phủ trận đấu theo lượt: thẻ quái, thẻ người chơi, dòng lượt kèm đồng hồ, nút hành động và
 * nhật ký trận. Component **không** gửi gói tin — nó chỉ phát ra hành động người chơi chọn.
 */
@Component({
  selector: 'app-battle-panel',
  templateUrl: './battle-panel.html',
  styleUrl: './battle-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BattlePanel {
  readonly battle = input<BattleSnapshot | null>(null);
  readonly log = input<readonly BattleEvent[]>([]);
  readonly outcome = input<BattleEnd | null>(null);
  readonly character = input<CharacterStats | null>(null);
  readonly inventory = input<readonly InventoryItem[]>([]);
  readonly selfId = input<string | null>(null);
  readonly isMyTurn = input(false);
  readonly remainingMs = input(0);

  readonly action = output<BattleActionRequest>();
  readonly dismissed = output<void>();

  /** Danh sách vật phẩm dùng được đang mở hay không (mở theo yêu cầu, không mở sẵn). */
  readonly itemsOpen = signal(false);

  readonly monster = computed<Combatant | null>(
    () => this.battle()?.participants.find((entry) => entry.kind === 'monster') ?? null,
  );

  readonly players = computed<readonly Combatant[]>(
    () => this.battle()?.participants.filter((entry) => entry.kind === 'player') ?? [],
  );

  readonly actor = computed<Combatant | null>(() => {
    const battle = this.battle();
    return battle?.participants.find((entry) => entry.id === battle.actorId) ?? null;
  });

  readonly me = computed<Combatant | null>(() => {
    const selfId = this.selfId();
    return selfId === null
      ? null
      : (this.battle()?.participants.find((entry) => entry.id === selfId) ?? null);
  });

  /** Chỉ số của mình trong trận cộng với mô tả chiêu ở `S2C_CHARACTER` để hiện giá và hồi chiêu. */
  readonly skills = computed<readonly SkillButton[]>(() => {
    const me = this.me();
    if (!me?.skills) {
      return [];
    }
    const catalog = new Map(
      (this.character()?.skills ?? []).map((skill) => [skill.skillId, skill] as const),
    );
    const mp = me.mp;
    return me.skills.map((skill) => {
      const known = catalog.get(skill.skillId);
      const costMp = known?.costMp ?? skill.costMp;
      return {
        skillId: skill.skillId,
        name: skill.name,
        costMp,
        cooldownTurns: known?.cooldownTurns ?? skill.cooldownTurns,
        readyInTurns: skill.readyInTurns,
        // Nút chỉ bấm được khi đúng lượt mình, chiêu đã sẵn sàng và còn đủ nội lực.
        disabled:
          !this.isMyTurn() ||
          skill.readyInTurns > 0 ||
          mp < costMp ||
          (this.outcome() !== null ? true : false),
      };
    });
  });

  readonly usableItems = computed<readonly InventoryItem[]>(() =>
    this.inventory().filter((item) => item.usable && item.quantity > 0),
  );

  readonly canAct = computed(
    () => this.isMyTurn() && this.outcome() === null && (this.me()?.alive ?? false),
  );

  readonly secondsLeft = computed(() => Math.ceil(this.remainingMs() / 1000));

  readonly urgent = computed(
    () => this.secondsLeft() <= BATTLE_URGENT_SECONDS && this.outcome() === null,
  );

  /** Câu mô tả lượt đang tới ai, đọc theo góc nhìn người chơi. */
  readonly turnText = computed(() => {
    const outcome = this.outcome();
    if (outcome) {
      return '';
    }
    const actor = this.actor();
    if (!actor) {
      return 'Đang chờ máy chủ…';
    }
    if (actor.id === this.selfId()) {
      return 'Tới lượt bạn';
    }
    return actor.kind === 'monster' ? `${actor.name} đang ra đòn…` : `Tới lượt ${actor.name}`;
  });

  readonly outcomeTitle = computed(() => {
    switch (this.outcome()?.outcome) {
      case 'victory':
        return 'Thắng trận!';
      case 'defeat':
        return 'Bạn đã gục ngã';
      case 'fled':
        return 'Đã chạy thoát';
      default:
        return '';
    }
  });

  readonly outcomeText = computed(() => {
    const outcome = this.outcome();
    if (!outcome) {
      return '';
    }
    const monsterName = outcome.monsterName;
    switch (outcome.outcome) {
      case 'victory':
        return `${monsterName} đã bị hạ gục.`;
      case 'defeat':
        return `${monsterName} đã đánh bại bạn. Bạn được đưa về làng hồi sinh với một nửa máu và mất một phần yên.`;
      default:
        return `Bạn đã rời khỏi trận với ${monsterName}. Nó hồi lại đầy máu.`;
    }
  });

  /** Thời gian mỗi lượt, để câu hướng dẫn nói đúng luật thật của server. */
  readonly turnSeconds = BATTLE_TURN_SECONDS;

  percent(value: number, max: number): number {
    if (max <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  }

  choose(action: BattleActionRequest): void {
    this.itemsOpen.set(false);
    this.action.emit(action);
  }

  toggleItems(): void {
    this.itemsOpen.update((open) => !open);
  }

  dismiss(): void {
    this.dismissed.emit();
  }
}
