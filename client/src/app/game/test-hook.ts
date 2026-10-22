import { Injectable, inject, isDevMode } from '@angular/core';
import { ArenaState } from '../net/arena-state';
import { BattleState } from '../net/battle-state';
import { MailState } from '../net/mail-state';
import { PartyState } from '../net/party-state';
import { SocialState } from '../net/social-state';
import { WorldState } from '../net/world-state';
import type { SocialPerson } from '@ninja/shared';
import type { Point } from './world-logic';

declare global {
  interface Window {
    /** Hook chỉ tồn tại ở chế độ phát triển, dùng cho kiểm thử đầu-cuối Playwright. */
    __ninjaWorld?: NinjaWorldTestHook;
  }
}

/** Một con quái đang vẽ trên bản đồ, đủ để e2e kiểm tra thanh máu. */
export interface NinjaTestMonster {
  readonly id: string;
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
  /** `pve` (đánh quái) hay `arena` (Lôi Đài) — e2e cần biết đang ở trận nào. */
  readonly mode: string;
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
  /**
   * Chỉ số gốc: server đã cộng trang bị vào rồi, nên e2e kiểm được "mặc vào thấy chỉ số tăng" bằng
   * chính những số này sau khi mặc/tháo.
   */
  readonly strength: number;
  readonly agility: number;
  readonly spirit: number;
  readonly attack: number;
  readonly defense: number;
  readonly speed: number;
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
  /** Ô mặc của món; `null` với vật phẩm không mặc được. */
  readonly slot: string | null;
  readonly upgradeLevel: number;
  readonly sellPrice: number;
}

/** Một ô trong bảng trang bị, đúng thứ tự `EQUIP_SLOTS` mà giao diện đang vẽ. */
export interface NinjaTestEquipmentSlot {
  readonly slot: string;
  /** Ô trống: e2e kiểm được bằng trường này hoặc bằng `name` rỗng. */
  readonly empty: boolean;
  readonly name: string;
  readonly upgradeLevel: number;
  readonly stats: {
    readonly strength: number;
    readonly agility: number;
    readonly spirit: number;
    readonly hp: number;
    readonly mp: number;
  };
}

/** Quầy hàng của NPC đang nói chuyện; `null` khi NPC chỉ nói chuyện. */
export interface NinjaTestShop {
  readonly npcName: string;
  readonly entries: readonly {
    readonly name: string;
    readonly price: number;
    readonly sellPrice: number;
  }[];
}

/** Một mục tiêu nhiệm vụ kèm tiến độ server đã tính sẵn (client không tự đếm). */
export interface NinjaTestQuestObjective {
  readonly kind: string;
  readonly targetId: string;
  /** Chữ server soạn sẵn, ví dụ "Đánh hạ 2 Bù Nhìn Tập Luyện"; tiến độ nằm ở hai trường dưới. */
  readonly description: string;
  readonly count: number;
  readonly progress: number;
  readonly done: boolean;
}

/** Một nhiệm vụ đang làm, kèm tiến độ từng mục tiêu. */
export interface NinjaTestQuest {
  readonly questId: string;
  readonly name: string;
  /** `active` (đang làm) hoặc `ready` (xong mục tiêu, chờ trả). */
  readonly state: string;
  readonly giverName: string;
  readonly turnInName: string;
  readonly objectives: readonly NinjaTestQuestObjective[];
}

/** Một nhiệm vụ đủ điều kiện nhận mà người chơi chưa nhận. */
export interface NinjaTestQuestAvailable {
  readonly questId: string;
  readonly name: string;
  readonly giverName: string;
  readonly turnInName: string;
  readonly levelRequired: number;
}

/**
 * Trạng thái nhiệm vụ client đang vẽ: nhiệm vụ đang làm, loại có thể nhận, id đã trả xong và cờ
 * tính năng đã mở khóa (cờ ở đây là id trong hợp đồng, ví dụ `party`).
 */
export interface NinjaTestQuestState {
  readonly active: readonly NinjaTestQuest[];
  readonly available: readonly NinjaTestQuestAvailable[];
  readonly completed: readonly string[];
  readonly unlockedFeatures: readonly string[];
  readonly maxActive: number;
}

/** Một người trong danh sách bạn bè / thành viên đội / lời mời, đủ để e2e so tên và cấp. */
export interface NinjaTestPerson {
  readonly name: string;
  readonly level: number;
  readonly online: boolean;
}

/** Bạn bè và lời mời kết bạn mà bảng xã hội đang vẽ. */
export interface NinjaTestSocial {
  readonly friends: readonly NinjaTestPerson[];
  readonly incoming: readonly NinjaTestPerson[];
  readonly outgoing: readonly NinjaTestPerson[];
  readonly maxFriends: number;
}

/** Tổ đội mà bảng xã hội đang vẽ. */
export interface NinjaTestParty {
  readonly partyId: string | null;
  readonly leaderName: string | null;
  readonly members: readonly NinjaTestPerson[];
  readonly invites: readonly { readonly fromName: string }[];
  readonly maxMembers: number;
}

/** Lôi Đài mà bảng Lôi Đài đang vẽ: hàng chờ, điểm và thành tích. */
export interface NinjaTestArena {
  readonly queued: boolean;
  readonly queueSize: number;
  readonly rating: number;
  readonly wins: number;
  readonly losses: number;
}

/** Một lá thư trong hộp thư.
 *
 * `yen` và `items` là quà kèm theo — e2e kiểm được "nhận thư thì được gì" mà không phải mở gói
 * `S2C_MAILS` thô.
 */
export interface NinjaTestMail {
  readonly id: string;
  readonly subject: string;
  /** Nội dung thư; server cho phép rỗng nên kiểu để tuỳ chọn. */
  readonly body?: string;
  readonly claimed: boolean;
  readonly yen: number;
  readonly items: readonly { readonly name: string; readonly qty: number }[];
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
  /**
   * Mô phỏng việc người chơi bấm vào một con quái: chọn con **còn sống** đầu tiên có tên này (trong
   * game thì bấm theo vị trí, nhưng nhiều con cùng loại có cùng tên nên kiểm thử cần quy ước này).
   */
  attackMonster(name: string): void;
  /** Bấm vào đúng quái theo ID do máy chủ cấp; dùng khi nhiều client cùng nhắm một thực thể. */
  attackMonsterById(id: string): void;
  /** Bấm vào con quái thứ `index` trong danh sách đang vẽ, kể cả con đã gục (bấm theo vị trí). */
  attackMonsterAt(index: number): void;
  battle(): NinjaTestBattle | null;
  closeBattle(): void;
  character(): NinjaTestCharacter | null;
  inventory(): NinjaTestItem[];
  useItem(name: string): void;
  toggleInventory(open?: boolean): void;
  inventoryOpen(): boolean;
  /** Bốn ô trang bị theo thứ tự `EQUIP_SLOTS`; ô trống có `empty: true` và `name` rỗng. */
  equipment(): NinjaTestEquipmentSlot[];
  /** Quầy hàng của NPC đang nói chuyện, `null` khi không có hội thoại bán hàng. */
  shop(): NinjaTestShop | null;
  toggleEquipment(open?: boolean): void;
  equipmentOpen(): boolean;
  /** Trạng thái nhiệm vụ: đang làm, có thể nhận, đã xong, cờ mở khóa. */
  questState(): NinjaTestQuestState;
  /** Mở/đóng nhật ký nhiệm vụ; không truyền tham số thì mở. */
  openQuestLog(open?: boolean): void;
  questLogOpen(): boolean;
  /** Câu lỗi gần nhất đang hiện trên thanh thông báo (server từ chối lệnh chẳng hạn). */
  lastError(): string | null;
  /** Bạn bè và lời mời kết bạn đang vẽ — bản chụp dữ liệu thuần, không phải signal. */
  social(): NinjaTestSocial;
  /** Tổ đội đang vẽ. */
  party(): NinjaTestParty;
  /** Hàng chờ và điểm Lôi Đài đang vẽ. */
  arena(): NinjaTestArena;
  /** Hộp thư đang vẽ, kèm quà của từng lá. */
  mails(): NinjaTestMail[];
}

export interface NinjaWorldTestActions {
  /** Mô phỏng đúng việc người chơi bấm chuột vào một thực thể. */
  clickEntity(name: string): void;
  attackMonster(name: string): void;
  /** Bấm vào đúng quái theo ID do máy chủ cấp; dùng khi nhiều client cùng nhắm một thực thể. */
  attackMonsterById(id: string): void;
  /** Bấm vào con quái thứ `index` trong danh sách đang vẽ, kể cả con đã gục (bấm theo vị trí). */
  attackMonsterAt(index: number): void;
  useItem(itemId: string): void;
  toggleInventory(open: boolean): void;
  inventoryOpen(): boolean;
  toggleEquipment(open: boolean): void;
  equipmentOpen(): boolean;
  openQuestLog(open: boolean): void;
  questLogOpen(): boolean;
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
  private readonly socialState = inject(SocialState);
  private readonly partyState = inject(PartyState);
  private readonly arenaState = inject(ArenaState);
  private readonly mailState = inject(MailState);
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
      attackMonsterById: (id) => {
        actions.attackMonsterById(id);
      },
      attackMonsterAt: (index) => {
        actions.attackMonsterAt(index);
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
          slot: item.slot,
          upgradeLevel: item.upgradeLevel,
          sellPrice: item.sellPrice,
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
      equipment: () =>
        this.world.equipment().map(({ slot, item }) => ({
          slot,
          empty: item === null,
          name: item?.name ?? '',
          upgradeLevel: item?.upgradeLevel ?? 0,
          stats: item?.stats ?? EMPTY_STATS,
        })),
      shop: () => {
        const dialog = this.world.npcDialog();
        if (!dialog?.shop) {
          return null;
        }
        return {
          npcName: dialog.npcName,
          entries: dialog.shop.entries.map((entry) => ({
            name: entry.name,
            price: entry.price,
            sellPrice: entry.sellPrice,
          })),
        };
      },
      toggleEquipment: (open) => {
        actions.toggleEquipment(open ?? true);
      },
      equipmentOpen: () => actions.equipmentOpen(),
      questState: () => this.questState(),
      openQuestLog: (open) => {
        actions.openQuestLog(open ?? true);
      },
      questLogOpen: () => actions.questLogOpen(),
      lastError: () => actions.lastError(),
      social: () => this.social(),
      party: () => this.party(),
      arena: () => this.arena(),
      mails: () => this.mails(),
    };
  }

  /** Quái đang vẽ trên bản đồ, kèm thanh máu để e2e kiểm tra việc đánh nhau trên map. */
  private monsterList(): NinjaTestMonster[] {
    return this.world
      .entities()
      .filter((entity) => entity.kind === 'monster')
      .map((entity) => ({
        id: entity.id,
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
      strength: stats.strength,
      agility: stats.agility,
      spirit: stats.spirit,
      attack: stats.attack,
      defense: stats.defense,
      speed: stats.speed,
      skills: stats.skills.map((skill) => ({
        skillId: skill.skillId,
        name: skill.name,
        costMp: skill.costMp,
      })),
    };
  }

  /** Trạng thái nhiệm vụ e2e đọc được, đúng những gì nhật ký nhiệm vụ đang vẽ. */
  private questState(): NinjaTestQuestState {
    const quests = this.world.quests();
    return {
      active: quests.active.map((quest) => ({
        questId: quest.questId,
        name: quest.name,
        state: quest.state,
        giverName: quest.giverName,
        turnInName: quest.turnInName,
        objectives: quest.objectives.map((objective) => ({
          kind: objective.kind,
          targetId: objective.targetId,
          description: objective.description,
          count: objective.count,
          progress: objective.progress,
          done: objective.done,
        })),
      })),
      available: quests.available.map((quest) => ({
        questId: quest.questId,
        name: quest.name,
        giverName: quest.giverName,
        turnInName: quest.turnInName,
        levelRequired: quest.levelRequired,
      })),
      completed: [...quests.completed],
      unlockedFeatures: [...quests.unlockedFeatures],
      maxActive: quests.maxActive,
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
      mode: battle.mode,
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

  /** Bạn bè và lời mời kết bạn, đúng những gì bảng xã hội đang vẽ. */
  private social(): NinjaTestSocial {
    return {
      friends: toPersons(this.socialState.friends()),
      incoming: toPersons(this.socialState.incoming()),
      outgoing: toPersons(this.socialState.outgoing()),
      maxFriends: this.socialState.maxFriends(),
    };
  }

  /** Tổ đội: id, đội trưởng, thành viên và người đã mời mình. */
  private party(): NinjaTestParty {
    return {
      partyId: this.partyState.partyId(),
      leaderName: this.partyState.leaderName(),
      members: toPersons(this.partyState.members()),
      invites: this.partyState.invites().map((invite) => ({ fromName: invite.fromName })),
      maxMembers: this.partyState.maxMembers(),
    };
  }

  /** Hàng chờ và điểm Lôi Đài đang vẽ. */
  private arena(): NinjaTestArena {
    return {
      queued: this.arenaState.queued(),
      queueSize: this.arenaState.queueSize(),
      rating: this.arenaState.rating(),
      wins: this.arenaState.wins(),
      losses: this.arenaState.losses(),
    };
  }

  /** Hộp thư, kèm quà của từng lá để e2e kiểm được yên/món nhận được. */
  private mails(): NinjaTestMail[] {
    return this.mailState.mails().map((mail) => ({
      id: mail.id,
      subject: mail.subject,
      body: mail.body,
      claimed: mail.claimed,
      yen: mail.yen,
      items: mail.items.map((item) => ({ name: item.name, qty: item.qty })),
    }));
  }

  uninstall(): void {
    if (!this.installed) {
      return;
    }
    this.installed = false;
    delete window.__ninjaWorld;
  }
}

/** Ô trang bị trống không có món nào để đọc chỉ số, nhưng e2e vẫn cần đủ năm trường. */
const EMPTY_STATS = { strength: 0, agility: 0, spirit: 0, hp: 0, mp: 0 } as const;

/** Bản chụp người trong danh sách xã hội, chỉ giữ ba trường e2e dùng. */
function toPersons(people: readonly SocialPerson[]): NinjaTestPerson[] {
  return people.map((person) => ({
    name: person.name,
    level: person.level,
    online: person.online,
  }));
}
