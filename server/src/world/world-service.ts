import {
  CHAT_MIN_INTERVAL_MS,
  ErrorCode,
  Opcode,
  PROTOCOL_VERSION,
  TICK_RATE_MS,
  type AttackMob,
  type BattleAction,
  type Character,
  type ChatSend,
  type ClientHello,
  type EnterMap,
  type Equip,
  type LevelUp,
  type Move,
  type NpcTalk,
  type Notify,
  type Ping,
  type QuestAccept,
  type QuestComplete,
  type ServerEnterMap,
  type ServerHello,
  type ShopBuy,
  type ShopSell,
  type Unequip,
  type Upgrade,
  type UseItem,
} from '@ninja/shared';
import { BattleService } from '../battle/service.js';
import type { RoomManager } from '../core/room-manager.js';
import type { TickScheduler } from '../core/tick.js';
import type { ChatService } from '../modules/chat/service.js';
import type { CharacterService } from '../modules/character/service.js';
import { characterStatsPayload, skillsOf } from '../modules/character/stats.js';
import type { EquipmentService } from '../modules/equipment/service.js';
import type { InventoryService } from '../modules/inventory/service.js';
import type { NpcService } from '../modules/npc/service.js';
import { lostItemsMessage, type QuestService } from '../modules/quest/service.js';
import { pickDialogNode } from '../modules/quest/dialog.js';
import type { ShopService } from '../modules/shop/service.js';
import type { UpgradeService } from '../modules/upgrade/service.js';
import type { GameSession } from '../net/session.js';
import type { SessionRegistry } from '../net/session-registry.js';
import { GameDataError, type GameData } from './game-data.js';
import { HandshakeError } from './handshake-error.js';
import type { MapPortal } from './map.js';
import { checkMove, MOVE_REJECTION_MESSAGES } from './movement.js';
import { createPlayer, playerView, type Room, type RoomNpc, type RoomPlayer } from './room.js';

/**
 * Bản đồ và điểm spawn khi vào game. **M2 chưa lưu vị trí vào database**: mỗi lần kết nối đều vào
 * đúng bản đồ khởi đầu này, ở đúng điểm spawn `default`.
 */
export const START_MAP_ID = 'lang-khoi-nguon';
export const START_SPAWN_ID = 'default';

export interface WorldServiceOptions {
  gameData: GameData;
  rooms: RoomManager;
  sessions: SessionRegistry;
  characters: CharacterService;
  chat: ChatService;
  npcs: NpcService;
  inventory: InventoryService;
  equipment: EquipmentService;
  shop: ShopService;
  upgrade: UpgradeService;
  /** Nhiệm vụ (M5): luật nhận/trả, tiến độ và thưởng đều nằm trong service này. */
  quests: QuestService;
  /** Nhịp dùng chung: trận đấu đếm lượt và hết giờ trên cùng nhịp với phần còn lại của server. */
  tick: TickScheduler;
  /** Xác thực access token (dùng `app.jwt`); trả `undefined` nếu token sai hoặc hết hạn. */
  verifyToken: (token: string) => AccountToken | undefined;
  now?: () => number;
}

export interface AccountToken {
  readonly sub: string;
  readonly username: string;
}

/**
 * Nguồn sự thật của thế giới: bắt tay, vào/đổi bản đồ, di chuyển, chat, hội thoại NPC.
 * Mọi quyết định đều ở đây; tầng `net/` chỉ lo vận chuyển, `modules/` lo luật của từng hệ thống.
 */
export class WorldService {
  private readonly now: () => number;
  /**
   * Trận đấu PvE (M3). Thế giới **sở hữu** nó (chứ không nhận từ ngoài) vì trận đấu cần room, phiên
   * kết nối, dữ liệu nhân vật, túi đồ — và cần gọi lại thế giới khi người chơi thua (hồi sinh về làng).
   */
  readonly battle: BattleService;
  /**
   * Quầy hàng người chơi đang mở, theo id nhân vật. `C2S_SHOP_BUY`/`C2S_SHOP_SELL` không có `npcId`
   * (hợp đồng M4) nên server nhớ NPC mà người chơi vừa bấm vào ở `talkToNpc`. Quên đi khi rời thế
   * giới hoặc đổi bản đồ — quầy thuộc về một NPC đang đứng trong map hiện tại.
   */
  private readonly openShops = new Map<string, string>();
  /**
   * Hội thoại đang mở của từng nhân vật: NPC đang nói chuyện và nhánh đang đứng (`nodeId` là `null`
   * khi NPC trả lời bằng `lines` mặc định). `C2S_NPC_TALK` kèm `optionId` phải khớp đúng cặp này,
   * nếu không client đang gửi lựa chọn của một bảng hội thoại đã cũ (`dialog_not_open`). Quên đi khi
   * rời thế giới hoặc đổi bản đồ, cùng lúc với quầy hàng.
   */
  private readonly openDialogs = new Map<string, { npcId: string; nodeId: string | null }>();

  constructor(private readonly options: WorldServiceOptions) {
    this.now = options.now ?? (() => Date.now());
    this.battle = new BattleService({
      gameData: options.gameData,
      rooms: options.rooms,
      sessions: options.sessions,
      characters: options.characters,
      inventory: options.inventory,
      equipment: options.equipment,
      tick: options.tick,
      onDefeat: (characterId) => {
        this.respawnAtStart(characterId);
      },
      // Hạ quái xong mới cộng tiến độ nhiệm vụ: id ở đây là id **dữ liệu** (`mob-…`), không phải id
      // thực thể trong room nên nhiệm vụ sống sót qua mọi lần quái hồi sinh.
      onMonsterKilled: (characterId, monsterId) => {
        void this.noteKill(characterId, monsterId);
      },
      now: this.now,
    });

    if (!options.gameData.maps.has(START_MAP_ID)) {
      throw new GameDataError([
        {
          file: 'maps/',
          path: START_MAP_ID,
          message: `thiếu bản đồ khởi đầu "${START_MAP_ID}" trong game-data/maps/`,
        },
      ]);
    }
  }

  /**
   * Bắt tay: xác thực token → kiểm phiên bản giao thức → chọn nhân vật → đưa vào bản đồ khởi đầu.
   * Ném `HandshakeError` (fatal) khi từ chối.
   */
  async handshake(session: GameSession, hello: ClientHello): Promise<void> {
    const account = this.options.verifyToken(hello.token);
    if (!account) {
      throw new HandshakeError(
        ErrorCode.UNAUTHORIZED,
        'phiên đăng nhập không hợp lệ hoặc đã hết hạn, hãy đăng nhập lại',
      );
    }

    if (hello.protocolVersion !== PROTOCOL_VERSION) {
      throw new HandshakeError(
        ErrorCode.PROTOCOL_MISMATCH,
        `phiên bản giao thức không khớp: server dùng ${PROTOCOL_VERSION}, ` +
          `client gửi ${hello.protocolVersion} — hãy tải lại trang`,
      );
    }

    const character = await this.options.characters.pickForWorld(account.sub, hello.characterId);
    if (!character) {
      throw hello.characterId
        ? new HandshakeError(
            ErrorCode.BAD_PACKET,
            'nhân vật này không thuộc tài khoản đang đăng nhập',
          )
        : new HandshakeError(
            ErrorCode.NO_CHARACTER,
            'tài khoản chưa có nhân vật nào — hãy vào trang tạo nhân vật rồi quay lại',
          );
    }

    // Token hợp lệ nhưng kết nối đã bị đóng trong lúc chờ database: đừng thêm thực thể ma.
    if (session.closed) {
      return;
    }

    const room = this.options.rooms.getOrCreate(START_MAP_ID);
    const spawn = room?.map.spawnPosition(START_SPAWN_ID) ?? room?.map.defaultSpawn();
    if (!room || !spawn) {
      throw new HandshakeError(
        ErrorCode.INTERNAL,
        `bản đồ khởi đầu "${START_MAP_ID}" không có điểm spawn "${START_SPAWN_ID}"`,
      );
    }

    this.evictPreviousSessions(session, character.id);

    const player = createPlayer({ character, position: spawn, channel: session });
    room.addPlayer(player);
    session.characterId = character.id;
    session.mapId = room.map.id;

    session.send(Opcode.S2C_HELLO, this.helloPayload(character, room.map.id));
    this.sendEnterMap(session, room, player);
    // Người đã ở trong map mới biết có người vừa vào — báo ngay trong cùng nhịp này, **trước** khi
    // đọc database: chờ đọc xong mới báo thì người vào sau kịp nhận gói ADD của người vào trước
    // (gói trễ, trùng với danh sách `entities` nó vừa nhận trong `S2C_ENTER_MAP`).
    room.broadcast(Opcode.S2C_ENTITY_ADD, { entity: playerView(player) }, player.id);
    // Bản đồ khởi đầu cũng tính là "đã tới": nhiệm vụ `reach` nhắm ngay làng xong lúc vào game.
    // Không gửi gói riêng ở đây vì `sendCharacterState` ngay dưới gửi cả trạng thái nhiệm vụ.
    await this.options.quests.progressReach(character.id, room.map.id);
    // Chỉ số và túi đồ gửi ngay sau bản đồ: HUD cần chúng trước khi người chơi kịp đánh con quái nào.
    await this.sendCharacterState(session, character.id);
  }

  /**
   * `C2S_MOVE`: kiểm khoảng cách / biên bản đồ / ô bị chặn. Sai thì báo lỗi và **không** đổi vị trí;
   * đúng thì đặt đích và để `Room.tick()` đẩy dần mỗi nhịp.
   */
  move(session: GameSession, move: Move): void {
    const located = this.locate(session);
    if (!located) {
      this.rejectNotInWorld(session);
      return;
    }
    const { room, player } = located;

    if (this.battle.isBusy(player.id)) {
      // Trong trận thì đứng yên: đánh nhau mà chạy lung tung sẽ phá vỡ luật khoảng cách của trận.
      session.sendError(ErrorCode.IN_BATTLE, 'đang trong trận đấu, không di chuyển được');
      return;
    }

    const rejection = checkMove(room.map, { x: player.x, y: player.y }, move);
    if (rejection) {
      session.sendError(ErrorCode.BAD_PACKET, MOVE_REJECTION_MESSAGES[rejection]);
      return;
    }
    player.target = { x: move.x, y: move.y };
  }

  /**
   * `C2S_ENTER_MAP`: chỉ hợp lệ khi người chơi đang đứng trong vùng một cổng của map hiện tại dẫn
   * tới bản đồ đó. Điểm đến do cổng trong game-data quyết định, **không** dùng `spawnId` client gửi.
   *
   * Từ khi cổng tự kích hoạt lúc đi bộ (`enterPortal`), gói này là đường chủ động dành cho tính
   * năng sau này (dịch chuyển, cắt cảnh) và cho client công cụ; luật kiểm tra vẫn giữ nguyên.
   */
  enterMap(session: GameSession, request: EnterMap): void {
    const located = this.locate(session);
    if (!located) {
      this.rejectNotInWorld(session);
      return;
    }
    const { room, player } = located;

    const portal = room.map.portalAt(player.x, player.y);
    if (!portal || portal.toMap !== request.mapId) {
      session.sendError(
        ErrorCode.UNKNOWN_MAP,
        'bạn phải đứng trong vùng cổng dẫn tới bản đồ đó mới đi được',
      );
      return;
    }

    this.transfer(room, player, portal, session);
  }

  /**
   * Người chơi **bước vào vùng cổng** trong lúc đi (`Room.tick()` báo lên): đổi bản đồ ngay, không
   * cần client xin phép. Server đã biết vị trí nên cổng là một phần của bản đồ, không phải một
   * hành động của người chơi.
   */
  enterPortal(room: Room, player: RoomPlayer, portal: MapPortal): void {
    const session = this.options.sessions.get(player.id);
    if (!session) {
      // Nhân vật không còn phiên nào (vừa bị đẩy ra hoặc vừa ngắt kết nối): không có gì để chuyển.
      return;
    }
    this.transfer(room, player, portal, session);
  }

  /** `C2S_CHAT`: giới hạn tần suất theo từng người, rồi phát cho cả room kèm lịch sử gần nhất. */
  chat(session: GameSession, chat: ChatSend): void {
    const located = this.locate(session);
    if (!located) {
      this.rejectNotInWorld(session);
      return;
    }
    const { room, player } = located;

    if (!this.options.chat.allow(player.id)) {
      session.sendError(
        ErrorCode.RATE_LIMITED,
        `chậm thôi — mỗi ${CHAT_MIN_INTERVAL_MS / 1000} giây chỉ gửi được một tin nhắn`,
      );
      return;
    }

    room.sendChat(this.options.chat.mapMessage(player, chat.text, this.now()));
  }

  /**
   * `C2S_NPC_TALK`: chỉ trả lời NPC đang có trong bản đồ hiện tại.
   *
   * Không có `optionId` → **bắt đầu** nói chuyện: cộng tiến độ nhiệm vụ `talk` trước, rồi mới chọn
   * nhánh hội thoại. Nhờ thứ tự đó, nhiệm vụ vừa xong mục tiêu ngay trong lần nói chuyện này đã thấy
   * nhánh "đã xong" và danh sách nhiệm vụ mới (nút "Trả nhiệm vụ" hiện ngay).
   *
   * Có `optionId` → người chơi đang bấm một lựa chọn của bảng hội thoại đang mở: chỉ nhánh đang mở
   * mới được phép; lựa chọn **không** có `next` là kết thúc hội thoại, server quên nhánh và **không**
   * gửi gì (client tự đóng bảng), lựa chọn có `next` thì mở nhánh đó.
   */
  async talkToNpc(session: GameSession, talk: NpcTalk): Promise<void> {
    const located = this.locate(session);
    if (!located) {
      this.rejectNotInWorld(session);
      return;
    }

    const npc = located.room.getNpc(talk.npcId);
    if (!npc) {
      session.sendError(ErrorCode.UNKNOWN_ENTITY, 'không có NPC này trong bản đồ hiện tại');
      return;
    }

    // Bấm vào NPC bán hàng là mở quầy của NPC đó: các gói mua/bán sau không mang `npcId`.
    this.openShops.set(located.player.id, npc.id);

    if (talk.optionId !== undefined) {
      await this.pickDialogOption(session, located.player.id, npc, talk.optionId);
      return;
    }

    if (await this.options.quests.progressTalk(located.player.id, npc.id)) {
      await this.sendQuestUpdate(session, located.player.id);
    }
    await this.sendDialog(session, located.player.id, npc);
  }

  /** `C2S_QUEST_ACCEPT` (0x0601): nhận nhiệm vụ ở NPC đang mở hội thoại. */
  async questAccept(session: GameSession, accept: QuestAccept): Promise<void> {
    const located = this.locate(session);
    if (!located) {
      this.rejectNotInWorld(session);
      return;
    }
    if (this.rejectWhileDoingQuest(session, located.player.id)) {
      return;
    }

    const outcome = await this.options.quests.accept(
      located.player.id,
      accept.questId,
      this.openDialogNpcId(located.player.id),
      located.room.map.id,
    );
    if (!outcome.ok) {
      session.sendError(outcome.code, outcome.message);
      return;
    }

    session.send(Opcode.S2C_NOTIFY, { message: outcome.message } satisfies Notify);
    await this.refreshAfterQuest(session, located.room, located.player.id, 0);
  }

  /** `C2S_QUEST_COMPLETE` (0x0602): trả nhiệm vụ ở NPC đang mở hội thoại, cộng thưởng. */
  async questComplete(session: GameSession, request: QuestComplete): Promise<void> {
    const located = this.locate(session);
    if (!located) {
      this.rejectNotInWorld(session);
      return;
    }
    if (this.rejectWhileDoingQuest(session, located.player.id)) {
      return;
    }

    const outcome = await this.options.quests.complete(
      located.player.id,
      request.questId,
      this.openDialogNpcId(located.player.id),
    );
    if (!outcome.ok) {
      session.sendError(outcome.code, outcome.message);
      return;
    }

    session.send(Opcode.S2C_NOTIFY, { message: outcome.message } satisfies Notify);
    if (outcome.lostItems.length > 0) {
      // Nhiệm vụ vẫn trả xong; nói rõ món nào không cất được để người chơi không tưởng là mất oan.
      session.send(Opcode.S2C_NOTIFY, {
        message: lostItemsMessage(outcome.lostItems),
      } satisfies Notify);
    }
    await this.refreshAfterQuest(
      session,
      located.room,
      located.player.id,
      outcome.levelsGained,
      outcome.levelBefore,
    );
  }

  /**
   * Sau khi nhận/trả nhiệm vụ: gửi lại chỉ số, túi đồ, nhật ký nhiệm vụ, gói lên cấp và **bảng hội
   * thoại đang mở**. Gói hội thoại là phần không được quên: `S2C_NPC_DIALOG.quests` mới là thứ client
   * vẽ nút "Nhận nhiệm vụ"/"Trả nhiệm vụ", nên hộp thoại còn mở mà không gửi lại thì người chơi vẫn
   * thấy nhiệm vụ vừa trả và không thấy nhiệm vụ kế tiếp.
   */
  private async refreshAfterQuest(
    session: GameSession,
    room: Room,
    characterId: string,
    levelsGained: number,
    levelBefore = 0,
  ): Promise<void> {
    await this.sendCharacterStats(session, characterId);
    if (levelsGained > 0) {
      await this.sendLevelUp(session, characterId, levelsGained, levelBefore);
    }
    await this.sendInventory(session, characterId);
    await this.sendQuestUpdate(session, characterId);
    await this.resendOpenDialog(session, room, characterId);
  }

  /** `S2C_LEVEL_UP` sau khi lên cấp vì thưởng nhiệm vụ — cùng nội dung với đường thắng trận. */
  private async sendLevelUp(
    session: GameSession,
    characterId: string,
    levelsGained: number,
    levelBefore: number,
  ): Promise<void> {
    const record = await this.options.characters.findById(characterId);
    if (!record || session.closed) {
      return;
    }
    const bonus = await this.options.equipment.bonusFor(characterId);
    const learned = skillsOf(this.options.gameData, {
      class: record.class,
      level: record.level,
    }).filter((skill) => skill.levelRequired > levelBefore);
    const payload: LevelUp = {
      character: characterStatsPayload({ record, data: this.options.gameData, bonus }),
      levelsGained,
      learnedSkills: learned.map((skill) => ({ skillId: skill.id, name: skill.name })),
    };
    session.send(Opcode.S2C_LEVEL_UP, payload);
  }

  /**
   * Chọn nhánh hội thoại theo trạng thái **hiện tại** rồi gửi `S2C_NPC_DIALOG` kèm nhiệm vụ làm được
   * ngay tại NPC này; nhớ lại nhánh vừa mở để lựa chọn sau (`optionId`) phải khớp.
   */
  private async sendDialog(session: GameSession, characterId: string, npc: RoomNpc): Promise<void> {
    const [questStates, level, quests] = await Promise.all([
      this.options.quests.dialogStates(characterId),
      this.options.characters.findById(characterId),
      this.options.quests.offersFor(characterId, npc.id),
    ]);
    const node = pickDialogNode(npc.data, { questStates, level: level?.level ?? 1 });
    this.openDialogs.set(characterId, { npcId: npc.id, nodeId: node?.id ?? null });
    session.send(Opcode.S2C_NPC_DIALOG, this.options.npcs.dialog(npc, { node, quests }));
  }

  /** Gửi lại bảng hội thoại đang mở (nếu có) sau khi nhận/trả nhiệm vụ làm trạng thái đổi. */
  private async resendOpenDialog(
    session: GameSession,
    room: Room,
    characterId: string,
  ): Promise<void> {
    const open = this.openDialogs.get(characterId);
    if (open === undefined) {
      return;
    }
    const npc = room.getNpc(open.npcId);
    if (npc === undefined) {
      this.openDialogs.delete(characterId);
      return;
    }
    await this.sendDialog(session, characterId, npc);
  }

  /**
   * Người chơi bấm một lựa chọn hội thoại. Chỉ nhận khi hội thoại của **chính NPC này** đang mở và
   * lựa chọn thuộc nhánh đang mở; sai thì `dialog_not_open` để client bấm lại vào NPC.
   */
  private async pickDialogOption(
    session: GameSession,
    characterId: string,
    npc: RoomNpc,
    optionId: string,
  ): Promise<void> {
    const open = this.openDialogs.get(characterId);
    if (open === undefined || open.npcId !== npc.id) {
      session.sendError(
        ErrorCode.DIALOG_NOT_OPEN,
        'hội thoại này không còn mở, hãy bấm lại vào NPC',
      );
      return;
    }

    const node =
      open.nodeId === null
        ? undefined
        : npc.data.dialog.find((branch) => branch.id === open.nodeId);
    const option = node?.options.find((candidate) => candidate.id === optionId);
    if (option === undefined) {
      session.sendError(ErrorCode.DIALOG_NOT_OPEN, 'lựa chọn này không có trong hội thoại đang mở');
      return;
    }

    if (option.next === undefined) {
      // Lựa chọn kết thúc hội thoại: quên nhánh đang mở và không gửi gì — client tự đóng bảng.
      this.openDialogs.delete(characterId);
      return;
    }

    const next = npc.data.dialog.find((branch) => branch.id === option.next);
    if (next === undefined) {
      // `checkGameData` bảo đảm `next` trỏ tới nhánh có thật; tới đây nghĩa là file đổi giữa chừng.
      this.openDialogs.delete(characterId);
      session.sendError(
        ErrorCode.INTERNAL,
        'hội thoại của NPC này bị lỗi dữ liệu, hãy bấm lại vào NPC',
      );
      return;
    }

    this.openDialogs.set(characterId, { npcId: npc.id, nodeId: next.id });
    const quests = await this.options.quests.offersFor(characterId, npc.id);
    session.send(Opcode.S2C_NPC_DIALOG, this.options.npcs.dialog(npc, { node: next, quests }));
  }

  /** Nhận/trả nhiệm vụ khi đang đánh nhau là không được: hội thoại đã đóng lúc vào trận. */
  private rejectWhileDoingQuest(session: GameSession, characterId: string): boolean {
    if (!this.battle.isBusy(characterId)) {
      return false;
    }
    session.sendError(ErrorCode.IN_BATTLE, 'đang trong trận đấu, không nhận hay trả nhiệm vụ được');
    return true;
  }

  /** NPC của hội thoại đang mở — nguồn duy nhất để biết người chơi đang nói chuyện với ai. */
  private openDialogNpcId(characterId: string): string | undefined {
    return this.openDialogs.get(characterId)?.npcId;
  }

  /** Nhật ký nhiệm vụ của nhân vật — gửi sau bắt tay và mỗi khi tiến độ đổi. */
  private async sendQuestUpdate(session: GameSession, characterId: string): Promise<void> {
    if (session.closed) {
      return;
    }
    session.send(Opcode.S2C_QUEST_UPDATE, await this.options.quests.state(characterId));
  }

  /**
   * Hạ quái xong: cộng tiến độ rồi báo cho người chơi nếu còn online. Gọi từ trận đấu (đường bất
   * đồng bộ) nên không được để lỗi database làm sập nhịp tick.
   */
  private async noteKill(characterId: string, monsterId: string): Promise<void> {
    if (!(await this.options.quests.progressKill(characterId, monsterId))) {
      return;
    }
    const session = this.options.sessions.get(characterId);
    if (session !== undefined) {
      await this.sendQuestUpdate(session, characterId);
    }
  }

  /** Tới bản đồ mới: cộng tiến độ `reach` rồi báo ngay nếu có gì đổi. */
  private async noteReach(session: GameSession, characterId: string, mapId: string): Promise<void> {
    if (await this.options.quests.progressReach(characterId, mapId)) {
      await this.sendQuestUpdate(session, characterId);
    }
  }

  /** `C2S_EQUIP`: mặc một món trong túi vào ô của nó (món đang ở ô đó tự về túi). */
  async equip(session: GameSession, request: Equip): Promise<void> {
    const located = this.locate(session);
    if (!located) {
      this.rejectNotInWorld(session);
      return;
    }
    if (this.rejectWhileInBattle(session, located.player.id)) {
      return;
    }

    const outcome = await this.options.equipment.equip(located.player.id, request.itemId);
    if (!outcome.ok) {
      session.sendError(outcome.code, outcome.message);
      return;
    }

    session.send(Opcode.S2C_EQUIPMENT, await this.options.equipment.toPacket(located.player.id));
    // Món vừa mặc rời túi nên túi phải được gửi lại, nếu không client còn thấy nó trong túi.
    await this.sendInventory(session, located.player.id);
    await this.sendCharacterStats(session, located.player.id);
  }

  /** `C2S_UNEQUIP`: tháo món đang mặc ở một ô về túi. */
  async unequip(session: GameSession, request: Unequip): Promise<void> {
    const located = this.locate(session);
    if (!located) {
      this.rejectNotInWorld(session);
      return;
    }
    if (this.rejectWhileInBattle(session, located.player.id)) {
      return;
    }

    const outcome = await this.options.equipment.unequip(located.player.id, request.slot);
    if (!outcome.ok) {
      session.sendError(outcome.code, outcome.message);
      return;
    }

    session.send(Opcode.S2C_EQUIPMENT, await this.options.equipment.toPacket(located.player.id));
    // Món vừa tháo quay lại túi: gửi lại túi cùng lúc với bảng trang bị.
    await this.sendInventory(session, located.player.id);
    await this.sendCharacterStats(session, located.player.id);
  }

  /** `C2S_SHOP_BUY`: mua ở quầy của NPC mà người chơi vừa bấm vào (xem `openShops`). */
  async shopBuy(session: GameSession, request: ShopBuy): Promise<void> {
    const located = this.locate(session);
    if (!located) {
      this.rejectNotInWorld(session);
      return;
    }
    if (this.rejectWhileInBattle(session, located.player.id)) {
      return;
    }

    const npc = this.openShop(located.room, located.player.id);
    if (!npc) {
      session.sendError(ErrorCode.NOT_FOR_SALE, 'hãy bấm vào NPC bán hàng trước rồi mua');
      return;
    }

    const outcome = await this.options.shop.buy(
      located.player.id,
      npc.data,
      request.itemId,
      request.quantity,
    );
    if (!outcome.ok) {
      session.sendError(outcome.code, outcome.message);
      return;
    }
    await this.sendAfterTrade(session, located.player.id, outcome.message);
  }

  /** `C2S_SHOP_SELL`: bán món trong túi — shop mua lại mọi món nên không cần đang mở quầy nào. */
  async shopSell(session: GameSession, request: ShopSell): Promise<void> {
    const located = this.locate(session);
    if (!located) {
      this.rejectNotInWorld(session);
      return;
    }
    if (this.rejectWhileInBattle(session, located.player.id)) {
      return;
    }

    const outcome = await this.options.shop.sell(
      located.player.id,
      request.itemId,
      request.quantity,
    );
    if (!outcome.ok) {
      session.sendError(outcome.code, outcome.message);
      return;
    }
    await this.sendAfterTrade(session, located.player.id, outcome.message);
  }

  /** `C2S_UPGRADE`: cường hóa một món đang sở hữu (trong túi hay đang mặc đều được). */
  async upgrade(session: GameSession, request: Upgrade): Promise<void> {
    const located = this.locate(session);
    if (!located) {
      this.rejectNotInWorld(session);
      return;
    }
    if (this.rejectWhileInBattle(session, located.player.id)) {
      return;
    }

    const outcome = await this.options.upgrade.upgrade(located.player.id, request.itemId);
    if (!outcome.ok) {
      session.sendError(outcome.code, outcome.message);
      return;
    }

    // Món vừa cường hóa có thể đang mặc hoặc đang trong túi: gửi lại cả hai gói, cộng chỉ số mới.
    session.send(Opcode.S2C_UPGRADE_RESULT, outcome.result);
    session.send(
      Opcode.S2C_INVENTORY_UPDATE,
      await this.options.inventory.toPacket(located.player.id),
    );
    session.send(Opcode.S2C_EQUIPMENT, await this.options.equipment.toPacket(located.player.id));
    await this.sendCharacterStats(session, located.player.id);
  }

  /** `C2S_ATTACK_MOB`: chạm vào quái trong tầm để vào trận (hoặc vào chung trận đang có). */
  attackMonster(session: GameSession, request: AttackMob): void {
    const located = this.locate(session);
    if (!located) {
      this.rejectNotInWorld(session);
      return;
    }
    void this.battle.engage({
      session,
      room: located.room,
      player: located.player,
      targetId: request.targetId,
    });
  }

  /** `C2S_BATTLE_ACTION`: hành động trong lượt của người chơi. */
  battleAction(session: GameSession, request: BattleAction): void {
    void this.battle.action(session, request);
  }

  /** `C2S_USE_ITEM`: dùng vật phẩm hồi phục khi đang rảnh (trong trận phải đi qua lượt). */
  useItem(session: GameSession, request: UseItem): void {
    void this.battle.useItem(session, request);
  }

  /**
   * Đưa một nhân vật về điểm hồi sinh của làng khởi đầu (sau khi thua trận). Máu/nội lực đã được ghi
   * xuống database trước khi hàm này chạy; ở đây chỉ đổi bản đồ và gửi lại dữ liệu bản đồ.
   */
  respawnAtStart(characterId: string): void {
    const session = this.options.sessions.get(characterId);
    const from = session?.mapId ? this.options.rooms.get(session.mapId) : undefined;
    const player = from?.getPlayer(characterId);
    const target = this.options.rooms.getOrCreate(START_MAP_ID);
    const spawn = target?.map.spawnPosition(START_SPAWN_ID) ?? target?.map.defaultSpawn();
    if (!session || !from || !player || !target || !spawn) {
      return;
    }

    from.removePlayer(player.id);
    from.broadcast(Opcode.S2C_ENTITY_REMOVE, { id: player.id });
    this.options.rooms.dropIfEmpty(from);
    this.openShops.delete(characterId);
    this.openDialogs.delete(characterId);

    player.x = spawn.x;
    player.y = spawn.y;
    player.target = undefined;
    player.facing = 'none';
    target.addPlayer(player);
    session.mapId = target.map.id;

    this.sendEnterMap(session, target, player);
    target.broadcast(Opcode.S2C_ENTITY_ADD, { entity: playerView(player) }, player.id);
    // Hồi sinh về làng khởi đầu: nhiệm vụ `reach` nhắm làng cũng tính là đã tới (không gửi gói riêng,
    // `sendCharacterState` ngay dưới đã gửi kèm nhật ký nhiệm vụ).
    void this.options.quests.progressReach(characterId, target.map.id);
    void this.sendCharacterState(session, characterId);
  }

  /** `C2S_PING` → `S2C_PONG` (trả lại `clientTime` để client đo độ trễ). */
  ping(session: GameSession, ping: Ping): void {
    session.send(Opcode.S2C_PONG, { clientTime: ping.clientTime, serverTime: this.now() });
  }

  /**
   * Người chơi rời thế giới: ngắt kết nối, chuyển map, hoặc bị phiên mới đẩy ra. Gọi lại nhiều lần
   * đều vô hại (idempotent) vì tầng `net/` có thể gọi cả khi chủ động đóng lẫn khi socket đóng.
   */
  leave(session: GameSession): void {
    const characterId = session.characterId;
    const mapId = session.mapId;
    session.mapId = undefined;

    if (!characterId) {
      return;
    }

    this.openShops.delete(characterId);
    this.openDialogs.delete(characterId);
    this.options.chat.forget(characterId);
    // Rời trận trước khi rời bản đồ: người chơi biến khỏi trận, quái còn sống thì hồi đầy máu.
    this.battle.leave(characterId);
    this.options.sessions.release(characterId, session);

    if (!mapId) {
      return;
    }
    const room = this.options.rooms.get(mapId);
    const player = room?.removePlayer(characterId);
    if (room && player) {
      room.broadcast(Opcode.S2C_ENTITY_REMOVE, { id: player.id });
      this.options.rooms.dropIfEmpty(room);
    }
  }

  /** `S2C_CHARACTER` + túi đồ + trang bị: trạng thái nhân vật mà HUD và trận đấu cần. */
  private async sendCharacterState(session: GameSession, characterId: string): Promise<void> {
    const record = await this.options.characters.findById(characterId);
    if (!record || session.closed) {
      return;
    }
    const bonus = await this.options.equipment.bonusFor(characterId);
    session.send(
      Opcode.S2C_CHARACTER,
      characterStatsPayload({ record, data: this.options.gameData, bonus }),
    );
    session.send(Opcode.S2C_INVENTORY_UPDATE, await this.options.inventory.toPacket(characterId));
    session.send(Opcode.S2C_EQUIPMENT, await this.options.equipment.toPacket(characterId));
    // Nhật ký nhiệm vụ đi cùng trạng thái nhân vật: vào lại giữa chừng thì nhiệm vụ đang làm vẫn còn.
    await this.sendQuestUpdate(session, characterId);
  }

  /** `S2C_CHARACTER` với chỉ số đã cộng trang bị đang mặc — HUD thấy ngay sau khi mặc/tháo/cường hóa. */
  private async sendCharacterStats(session: GameSession, characterId: string): Promise<void> {
    const record = await this.options.characters.findById(characterId);
    if (!record || session.closed) {
      return;
    }
    const bonus = await this.options.equipment.bonusFor(characterId);
    session.send(
      Opcode.S2C_CHARACTER,
      characterStatsPayload({ record, data: this.options.gameData, bonus }),
    );
  }

  /** Sau một giao dịch shop: túi đồ và yên đã đổi, kèm câu giải thích vừa làm gì. */
  private async sendAfterTrade(
    session: GameSession,
    characterId: string,
    message: string,
  ): Promise<void> {
    session.send(Opcode.S2C_INVENTORY_UPDATE, await this.options.inventory.toPacket(characterId));
    await this.sendCharacterStats(session, characterId);
    session.send(Opcode.S2C_NOTIFY, { message } satisfies Notify);
  }

  /** Gửi lại túi đồ: mặc/tháo làm món rời túi hoặc quay lại túi nên client phải thấy ngay. */
  private async sendInventory(session: GameSession, characterId: string): Promise<void> {
    session.send(Opcode.S2C_INVENTORY_UPDATE, await this.options.inventory.toPacket(characterId));
  }

  /**
   * Đang trong trận thì chặn mọi thao tác đổi trang bị / túi đồ / yên — cùng luật với dùng vật phẩm
   * ở M3: chỉ số lúc vào trận là chỉ số dùng suốt trận, không đổi giữa chừng.
   */
  private rejectWhileInBattle(session: GameSession, characterId: string): boolean {
    if (!this.battle.isBusy(characterId)) {
      return false;
    }
    session.sendError(
      ErrorCode.IN_BATTLE,
      'đang trong trận đấu, không đổi trang bị hay mua bán được',
    );
    return true;
  }

  /** Quầy của NPC mà người chơi vừa bấm vào — chỉ còn hiệu lực nếu NPC đó đang ở bản đồ hiện tại. */
  private openShop(room: Room, characterId: string): RoomNpc | undefined {
    const npcId = this.openShops.get(characterId);
    return npcId ? room.getNpc(npcId) : undefined;
  }

  private helloPayload(character: Character, mapId: string): ServerHello {
    return {
      protocolVersion: PROTOCOL_VERSION,
      tickRateMs: TICK_RATE_MS,
      characterId: character.id,
      characterName: character.name,
      mapId,
      serverTime: this.now(),
    };
  }

  /**
   * Chuyển một người chơi sang bản đồ mà cổng dẫn tới — **đường chuyển map duy nhất**, dùng chung
   * cho cả hai lối vào (client xin bằng `C2S_ENTER_MAP` và server tự phát hiện lúc đi bộ).
   */
  private transfer(room: Room, player: RoomPlayer, portal: MapPortal, session: GameSession): void {
    const target = this.options.rooms.getOrCreate(portal.toMap);
    const spawn = target?.map.spawnPosition(portal.toSpawn) ?? target?.map.defaultSpawn();
    if (!target || !spawn) {
      session.sendError(ErrorCode.UNKNOWN_MAP, `không vào được bản đồ "${portal.toMap}"`);
      return;
    }

    room.removePlayer(player.id);
    room.broadcast(Opcode.S2C_ENTITY_REMOVE, { id: player.id });
    this.options.rooms.dropIfEmpty(room);
    this.openShops.delete(player.id);
    this.openDialogs.delete(player.id);

    player.x = spawn.x;
    player.y = spawn.y;
    player.target = undefined;
    player.facing = 'none';
    target.addPlayer(player);
    session.mapId = target.map.id;

    this.sendEnterMap(session, target, player);
    target.broadcast(Opcode.S2C_ENTITY_ADD, { entity: playerView(player) }, player.id);
    // Bản đồ mới có thể là đích của một nhiệm vụ `reach` đang làm — báo sau khi client đã nhận bản đồ.
    void this.noteReach(session, player.id, target.map.id);
  }

  private sendEnterMap(session: GameSession, room: Room, player: RoomPlayer): void {
    const payload: ServerEnterMap = {
      map: room.map.toSnapshot(),
      entity: playerView(player),
      // Người vừa vào không nhận chính mình trong danh sách thực thể.
      entities: room.entityViews(player.id),
      chatBacklog: room.chatBacklog(),
    };
    session.send(Opcode.S2C_ENTER_MAP, payload);
  }

  /** Một nhân vật chỉ có một kết nối: phiên cũ bị dọn khỏi room rồi bị đóng. */
  private evictPreviousSessions(session: GameSession, characterId: string): void {
    const previous = this.options.sessions.register(characterId, session);
    if (!previous || previous === session) {
      return;
    }
    this.leave(previous);
    previous.replacedByNewLogin();
  }

  private locate(session: GameSession): { room: Room; player: RoomPlayer } | undefined {
    if (!session.characterId || !session.mapId) {
      return undefined;
    }
    const room = this.options.rooms.get(session.mapId);
    const player = room?.getPlayer(session.characterId);
    return room && player ? { room, player } : undefined;
  }

  private rejectNotInWorld(session: GameSession): void {
    session.sendError(ErrorCode.INTERNAL, 'bạn chưa vào bản đồ nào, hãy bắt tay lại');
  }
}
