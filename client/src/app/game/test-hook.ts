import { Injectable, inject, isDevMode } from '@angular/core';
import { BattleState } from '../net/battle-state';
import { WorldState } from '../net/world-state';
import type { Point } from './world-logic';

declare global {
  interface Window {
    /** Hook chỉ tồn tại ở chế độ phát triển, dùng cho kiểm thử đầu-cuối Playwright. */
    __ninjaWorld?: NinjaWorldTestHook;
  }
}

/** Một con quái đang vẽ trên bản đồ, đủ để e2e kiểm tra thanh máu. */
export interface NinjaTestMonster {
  readonly name: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly shape: string;
  readonly alive: boolean;
}

/** Người tham gia trận, đọc theo góc nhìn client. */
export interface NinjaTestCombatant {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly level: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly mp: number;
  readonly maxMp: number;
  readonly alive: boolean;
}

/** Trạng thái trận đấu mà client đang vẽ. */
export interface NinjaTestBattle {
  readonly battleId: string;
  readonly roundNo: number;
  readonly actorId: string;
  readonly actorName: string;
  readonly isMyTurn: boolean;
  readonly remainingMs: number;
  readonly participants: readonly NinjaTestCombatant[];
  readonly logLines: string[];
  readonly outcome: string | null;
  readonly monsterName: string;
  readonly rewards: {
    readonly exp: number;
    readonly yen: number;
    readonly levelsGained: number;
    readonly level: number;
    readonly drops: readonly { readonly name: string; readonly qty: number }[];
  } | null;
}

/** Chỉ số nhân vật như HUD đang vẽ. */
export interface NinjaTestCharacter {
  readonly name: string;
  readonly level: number;
  readonly exp: number;
  readonly expToNext: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly mp: number;
  readonly maxMp: number;
  readonly yen: number;
  readonly skills: readonly {
    readonly skillId: string;
    readonly name: string;
    readonly costMp: number;
  }[];
}

/** Một dòng trong túi đồ. */
export interface NinjaTestItem {
  readonly itemId: string;
  readonly name: string;
  readonly quantity: number;
  readonly usable: boolean;
}

/** Cầu nối cho e2e: đọc trạng thái client đang vẽ và mô phỏng hành động của người chơi. */
export interface NinjaWorldTestHook {
  /** Tên mọi thực thể đang vẽ, kể cả nhân vật của mình. */
  entityNames(): string[];
  npcNames(): string[];
  monsterNames(): string[];
  monsters(): NinjaTestMonster[];
  /** Toạ độ thực thể theo góc nhìn client (đơn vị pixel của server). */
  position(name: string): Point | null;
  localPlayerName(): string;
  clickEntity(name: string): void;
  /** Mô phỏng đúng việc người chơi bấm chuột vào một con quái (đi tới nếu còn xa, vào trận nếu đủ gần). */
  attackMonster(name: string): void;
  battle(): NinjaTestBattle | null;
  closeBattle(): void;
  character(): NinjaTestCharacter | null;
  inventory(): NinjaTestItem[];
  useItem(name: string): void;
  toggleInventory(open?: boolean): void;
  inventoryOpen(): boolean;
  /** Câu lỗi gần nhất đang hiện trên thanh thông báo (server từ chối lệnh chẳng hạn). */
  lastError(): string | null;
}

export interface NinjaWorldTestActions {
  /** Mô phỏng đúng việc người chơi bấm chuột vào một thực thể. */
  clickEntity(name: string): void;
  attackMonster(name: string): void;
  useItem(itemId: string): void;
  toggleInventory(open: boolean): void;
  inventoryOpen(): boolean;
  closeBattle(): void;
  lastError(): string | null;
}

/**
 * Gắn hook kiểm thử lên `window.__ninjaWorld` khi chạy ở chế độ phát triển.
 *
 * Bản production **không** phơi hook này: `install()` mặc định chỉ chạy khi `isDevMode()`
 * trả về `true`, và trang `/play` gọi `uninstall()` khi rời đi. Hook chỉ **đọc** trạng thái và gọi
 * lại đúng những hàm mà giao diện gọi, nên e2e kiểm tra được đúng đường người chơi đi.
 */
@Injectable({ providedIn: 'root' })
export class WorldTestHook {
  private readonly world = inject(WorldState);
  private readonly battleState = inject(BattleState);
  private installed = false;

  install(actions: NinjaWorldTestActions, enabled: boolean = isDevMode()): void {
    if (!enabled || this.installed || typeof window === 'undefined') {
      return;
    }
    this.installed = true;
    window.__ninjaWorld = {
      entityNames: () => this.world.entities().map((entity) => entity.name),
      npcNames: () =>
        this.world
          .entities()
          .filter((entity) => entity.kind === 'npc')
          .map((entity) => entity.name),
      monsterNames: () => this.monsterList().map((monster) => monster.name),
      monsters: () => this.monsterList(),
      position: (name) => {
        const entity = this.world.entities().find((candidate) => candidate.name === name);
        return entity ? { x: entity.x, y: entity.y } : null;
      },
      localPlayerName: () => this.world.self()?.name ?? '',
      clickEntity: (name) => {
        actions.clickEntity(name);
      },
      attackMonster: (name) => {
        actions.attackMonster(name);
      },
      battle: () => this.battle(),
      closeBattle: () => {
        actions.closeBattle();
      },
      character: () => this.character(),
      inventory: () =>
        this.world.inventory().map((item) => ({
          itemId: item.itemId,
          name: item.name,
          quantity: item.quantity,
          usable: item.usable,
        })),
      useItem: (name) => {
        const item = this.world.inventory().find((candidate) => candidate.name === name);
        if (item) {
          actions.useItem(item.itemId);
        }
      },
      toggleInventory: (open) => {
        actions.toggleInventory(open ?? true);
      },
      inventoryOpen: () => actions.inventoryOpen(),
      lastError: () => actions.lastError(),
    };
  }

  /** Quái đang vẽ trên bản đồ, kèm thanh máu để e2e kiểm tra việc đánh nhau trên map. */
  private monsterList(): NinjaTestMonster[] {
    return this.world
      .entities()
      .filter((entity) => entity.kind === 'monster')
      .map((entity) => ({
        name: entity.name,
        hp: entity.hp ?? 0,
        maxHp: entity.maxHp ?? 0,
        shape: entity.shape ?? '',
        alive: (entity.hp ?? 0) > 0,
      }));
  }

  private character(): NinjaTestCharacter | null {
    const stats = this.world.character();
    if (!stats) {
      return null;
    }
    return {
      name: stats.name,
      level: stats.level,
      exp: stats.exp,
      expToNext: stats.expToNext,
      hp: stats.hp,
      maxHp: stats.maxHp,
      mp: stats.mp,
      maxMp: stats.maxMp,
      yen: stats.yen,
      skills: stats.skills.map((skill) => ({
        skillId: skill.skillId,
        name: skill.name,
        costMp: skill.costMp,
      })),
    };
  }

  private battle(): NinjaTestBattle | null {
    const battle = this.battleState.battle();
    if (!battle) {
      return null;
    }
    const outcome = this.battleState.outcome();
    const actor = battle.participants.find((entry) => entry.id === battle.actorId);
    return {
      battleId: battle.battleId,
      roundNo: battle.roundNo,
      actorId: battle.actorId,
      actorName: actor?.name ?? '',
      isMyTurn: this.battleState.isMyTurn(),
      remainingMs: this.battleState.remainingMs(),
      participants: battle.participants.map((entry) => ({
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
        level: entry.level,
        hp: entry.hp,
        maxHp: entry.maxHp,
        mp: entry.mp,
        maxMp: entry.maxMp,
        alive: entry.alive,
      })),
      logLines: this.battleState.log().map((event) => event.text),
      outcome: outcome?.outcome ?? null,
      monsterName: outcome?.monsterName ?? this.battleState.monster()?.name ?? '',
      rewards: outcome?.rewards
        ? {
            exp: outcome.rewards.exp,
            yen: outcome.rewards.yen,
            levelsGained: outcome.rewards.levelsGained,
            level: outcome.rewards.level,
            drops: outcome.rewards.drops.map((drop) => ({ name: drop.name, qty: drop.qty })),
          }
        : null,
    };
  }

  uninstall(): void {
    if (!this.installed) {
      return;
    }
    this.installed = false;
    delete window.__ninjaWorld;
  }
}
