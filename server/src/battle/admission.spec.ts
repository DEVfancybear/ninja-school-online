import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BATTLE_MAX_PLAYERS,
  ErrorCode,
  FIELD_BOSS_ID,
  FIELD_BOSS_MAP_ID,
  FIELD_BOSS_MAX_PLAYERS,
  isFieldBossActive,
  Opcode,
} from '@ninja/shared';
import { eq } from 'drizzle-orm';
import { accounts, characters } from '../db/schema.js';
import { closeTestDb, getTestDb, resetDatabase } from '../test/database.js';
import {
  CharacterService,
  toCharacterDto,
  toCharacterRecord,
} from '../modules/character/service.js';
import { EquipmentService } from '../modules/equipment/service.js';
import { InventoryService } from '../modules/inventory/service.js';
import { SessionRegistry } from '../net/session-registry.js';
import type { GameSession } from '../net/session.js';
import { loadGameData, DEFAULT_GAME_DATA_DIR } from '../world/game-data.js';
import { RoomManager } from '../core/room-manager.js';
import { TickScheduler } from '../core/tick.js';
import { createPlayer } from '../world/room.js';
import { BattleService } from './service.js';
import { WorldService } from '../world/world-service.js';

const TRAINING_MAP_ID = 'bai-luyen-tap';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

describe('PvE admission reservation', () => {
  let gameData: Awaited<ReturnType<typeof loadGameData>>;

  beforeAll(async () => {
    gameData = await loadGameData(DEFAULT_GAME_DATA_DIR);
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it('reserves a character before database reads so a second battle cannot enter', async () => {
    const db = await getTestDb();
    const [account] = await db
      .insert(accounts)
      .values({ username: 'pve_admission', passwordHash: 'test' })
      .returning();
    const [record] = await db
      .insert(characters)
      .values({
        accountId: account!.id,
        name: 'PveAdmission',
        school: 'haruna',
        class: 'dao',
        level: 3,
      })
      .returning();
    const characterId = record!.id;
    const inventory = new InventoryService(db, gameData);
    const characterService = new CharacterService(db, inventory, gameData);
    const equipment = new EquipmentService(gameData, characterService, inventory);
    const sessions = new SessionRegistry();
    const tick = new TickScheduler();
    const rooms = new RoomManager({ gameData, tick });
    const messages: { op: number; payload: unknown }[] = [];
    const session: GameSession = {
      connectionId: 'pve-admission',
      characterId,
      mapId: TRAINING_MAP_ID,
      closed: false,
      send: (op, payload) => messages.push({ op, payload }),
      sendError: (code, message) =>
        messages.push({ op: Opcode.S2C_ERROR, payload: { code, message } }),
      replacedByNewLogin: () => undefined,
    };
    sessions.register(characterId, session);

    const room = rooms.getOrCreate(TRAINING_MAP_ID);
    expect(room).toBeDefined();
    const monster = room!.monsters()[0];
    expect(monster).toBeDefined();
    const player = createPlayer({
      character: toCharacterDto(record!),
      position: { x: monster!.x, y: monster!.y },
      channel: session,
    });
    room!.addPlayer(player);

    const battle = new BattleService({
      gameData,
      rooms,
      sessions,
      characters: characterService,
      inventory,
      equipment,
      tick,
      onDefeat: () => undefined,
    });
    let release!: () => void;
    let markStarted!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const started = new Promise<void>((resolve) => (markStarted = resolve));
    const findById = vi.spyOn(characterService, 'findById').mockImplementation(async (id) => {
      markStarted();
      await gate;
      return db
        .select()
        .from(characters)
        .where(eq(characters.id, id))
        .then(([row]) => (row ? toCharacterRecord(row) : undefined));
    });

    try {
      const firstAdmission = battle.engage({ session, room: room!, player, targetId: monster!.id });
      await started;
      expect(battle.isBusy(characterId)).toBe(true);
      const blockedQueue = vi.fn();
      const world = Object.assign(Object.create(WorldService.prototype), {
        options: { arena: { queuePlayer: blockedQueue } },
        battle,
        locate: () => ({ room: room!, player }),
      }) as WorldService;
      await world.arenaQueue(session);
      expect(blockedQueue).not.toHaveBeenCalled();
      messages.length = 0;
      await battle.engage({ session, room: room!, player, targetId: monster!.id });
      expect(
        messages.filter(
          (message) =>
            message.op === Opcode.S2C_ERROR &&
            (message.payload as { code: ErrorCode }).code === ErrorCode.IN_BATTLE,
        ),
      ).toHaveLength(1);
      release();
      await firstAdmission;
      expect(messages.filter((message) => message.op === Opcode.S2C_BATTLE_START)).toHaveLength(1);
      expect(battle.isBusy(characterId)).toBe(true);
    } finally {
      release();
      findById.mockRestore();
      battle.dispose();
      rooms.dispose();
      tick.dispose();
    }
  });

  it('rejects a field boss outside its UTC window with BOSS_CLOSED and does not begin a battle', async () => {
    const db = await getTestDb();
    const [account] = await db.insert(accounts).values({ username: 'boss_closed_window', passwordHash: 'test' }).returning();
    const [record] = await db.insert(characters).values({
      accountId: account!.id,
      name: 'BossClosedWindow',
      school: 'haruna',
      class: 'dao',
      level: 3,
    }).returning();
    const characterId = record!.id;
    const inventory = new InventoryService(db, gameData);
    const characterService = new CharacterService(db, inventory, gameData);
    const equipment = new EquipmentService(gameData, characterService, inventory);
    const sessions = new SessionRegistry();
    const tick = new TickScheduler();
    const rooms = new RoomManager({ gameData, tick, now: () => Date.parse('2026-01-01T12:00:00.000Z') });
    const messages: { op: number; payload: unknown }[] = [];
    const session: GameSession = {
      connectionId: 'boss-closed-window',
      characterId,
      mapId: FIELD_BOSS_MAP_ID,
      closed: false,
      send: (op, payload) => messages.push({ op, payload }),
      sendError: (code, message) => messages.push({ op: Opcode.S2C_ERROR, payload: { code, message } }),
      replacedByNewLogin: () => undefined,
    };
    sessions.register(characterId, session);
    const room = rooms.getOrCreate(FIELD_BOSS_MAP_ID)!;
    const boss = room.monsters().find((monster) => monster.monsterId === 'mob-thu-vuong');
    expect(boss?.alive).toBe(true);
    const player = createPlayer({ character: toCharacterDto(record!), position: { x: boss!.x, y: boss!.y }, channel: session });
    room.addPlayer(player);
    const battle = new BattleService({
      gameData,
      rooms,
      sessions,
      characters: characterService,
      inventory,
      equipment,
      tick,
      onDefeat: () => undefined,
      isFieldBossActive: () => false,
    });
    try {
      await battle.engage({ session, room, player, targetId: boss!.id });
      const errors = messages.filter((message) => message.op === Opcode.S2C_ERROR);
      expect(errors.map((message) => (message.payload as { code: ErrorCode }).code)).toEqual([ErrorCode.BOSS_CLOSED]);
      expect(errors.map((message) => (message.payload as { message: string }).message)).toEqual([
        'Thú Vương hiện không xuất hiện theo lịch; hãy quay lại trong khung giờ hoạt động',
      ]);
      expect(messages.some((message) => message.op === Opcode.S2C_BATTLE_START)).toBe(false);
    } finally {
      battle.dispose();
      rooms.dispose();
      tick.dispose();
    }
  });

  it.each([
    ['character read, new battle', 'character', false],
    ['character read, existing battle', 'character', true],
    ['equipment read, new battle', 'equipment', false],
    ['equipment read, existing battle', 'equipment', true],
  ] as const)(
    'rechecks the field-boss schedule after the %s',
    async (_scenario, delayedRead, joinExisting) => {
      const db = await getTestDb();
      const records: (typeof characters.$inferSelect)[] = [];
      for (let index = 0; index < (joinExisting ? 2 : 1); index += 1) {
        const [account] = await db
          .insert(accounts)
          .values({
            username: `boss_window_race_${index}`,
            passwordHash: 'test',
          })
          .returning();
        const [record] = await db
          .insert(characters)
          .values({
            accountId: account!.id,
            name: `BossWindowRace${index}`,
            school: 'haruna',
            class: 'dao',
            level: 3,
          })
          .returning();
        records.push(record!);
      }

      let now = Date.parse('2026-01-01T12:14:59.990Z');
      const closedAt = Date.parse('2026-01-01T12:15:00.000Z');
      const inventory = new InventoryService(db, gameData);
      const characterService = new CharacterService(db, inventory, gameData);
      let crossBoundaryDuringRead: 'character' | 'equipment' | undefined;
      const originalFindById = characterService.findById.bind(characterService);
      const findById = vi.spyOn(characterService, 'findById').mockImplementation(async (id) => {
        const character = await originalFindById(id);
        if (crossBoundaryDuringRead === 'character') now = closedAt;
        return character;
      });
      const equipment = new EquipmentService(gameData, characterService, inventory);
      const originalBonusFor = equipment.bonusFor.bind(equipment);
      const bonusFor = vi.spyOn(equipment, 'bonusFor').mockImplementation(async (id) => {
        const bonus = await originalBonusFor(id);
        if (crossBoundaryDuringRead === 'equipment') now = closedAt;
        return bonus;
      });
      const sessions = new SessionRegistry();
      const tick = new TickScheduler();
      const rooms = new RoomManager({ gameData, tick, now: () => now });
      const room = rooms.getOrCreate(FIELD_BOSS_MAP_ID)!;
      const boss = room.monsters().find((monster) => monster.monsterId === FIELD_BOSS_ID)!;
      const messagesByCharacter = new Map<string, { op: number; payload: unknown }[]>();
      const players = records.map((record, index) => {
        const messages: { op: number; payload: unknown }[] = [];
        messagesByCharacter.set(record.id, messages);
        const session: GameSession = {
          connectionId: `boss-window-race-${index}`,
          characterId: record.id,
          mapId: FIELD_BOSS_MAP_ID,
          closed: false,
          send: (op, payload) => messages.push({ op, payload }),
          sendError: (code, message) =>
            messages.push({ op: Opcode.S2C_ERROR, payload: { code, message } }),
          replacedByNewLogin: () => undefined,
        };
        sessions.register(record.id, session);
        const player = createPlayer({
          character: toCharacterDto(record),
          position: { x: boss.x, y: boss.y },
          channel: session,
        });
        room.addPlayer(player);
        return { session, player };
      });
      const battle = new BattleService({
        gameData,
        rooms,
        sessions,
        characters: characterService,
        inventory,
        equipment,
        tick,
        now: () => now,
        onDefeat: () => undefined,
        isFieldBossActive: () => isFieldBossActive(now),
      });

      try {
        expect(isFieldBossActive(now)).toBe(true);
        if (joinExisting) {
          await battle.engage({ ...players[0]!, room, targetId: boss.id });
          expect(battle.activeCount).toBe(1);
          expect(now).toBe(Date.parse('2026-01-01T12:14:59.990Z'));
        }

        const latePlayer = players.at(-1)!;
        crossBoundaryDuringRead = delayedRead;
        await battle.engage({ ...latePlayer, room, targetId: boss.id });

        const messages = messagesByCharacter.get(latePlayer.player.id)!;
        const errors = messages.filter((message) => message.op === Opcode.S2C_ERROR);
        expect(errors.map((message) => (message.payload as { code: ErrorCode }).code)).toEqual([
          ErrorCode.BOSS_CLOSED,
        ]);
        expect(messages.some((message) => message.op === Opcode.S2C_BATTLE_START)).toBe(false);
        expect(battle.activeCount).toBe(joinExisting ? 1 : 0);
        expect(battle.isBusy(latePlayer.player.id)).toBe(false);
      } finally {
        findById.mockRestore();
        bonusFor.mockRestore();
        battle.dispose();
        rooms.dispose();
        tick.dispose();
      }
    },
  );

  it('lets three players join a field-boss battle and rejects a fourth with the boss cap', async () => {
    const db = await getTestDb();
    const records: (typeof characters.$inferSelect)[] = [];
    for (let index = 0; index < FIELD_BOSS_MAX_PLAYERS + 1; index += 1) {
      const [account] = await db.insert(accounts).values({ username: `boss_coop_${index}`, passwordHash: 'test' }).returning();
      const [record] = await db.insert(characters).values({
        accountId: account!.id,
        name: `BossCoop${index}`,
        school: 'haruna',
        class: 'dao',
        level: 3,
      }).returning();
      records.push(record!);
    }
    const inventory = new InventoryService(db, gameData);
    const characterService = new CharacterService(db, inventory, gameData);
    const equipment = new EquipmentService(gameData, characterService, inventory);
    const sessions = new SessionRegistry();
    const tick = new TickScheduler();
    const rooms = new RoomManager({ gameData, tick, now: () => Date.parse('2026-01-01T12:00:00.000Z') });
    const messages = new Map<string, { op: number; payload: unknown }[]>();
    const room = rooms.getOrCreate(FIELD_BOSS_MAP_ID)!;
    const boss = room.monsters().find((monster) => monster.monsterId === FIELD_BOSS_ID)!;
    expect(boss.alive).toBe(true);
    const players = records.map((record, index) => {
      const output: { op: number; payload: unknown }[] = [];
      messages.set(record.id, output);
      const session: GameSession = {
        connectionId: `boss-coop-${index}`,
        characterId: record.id,
        mapId: FIELD_BOSS_MAP_ID,
        closed: false,
        send: (op, payload) => output.push({ op, payload }),
        sendError: (code, message) => output.push({ op: Opcode.S2C_ERROR, payload: { code, message } }),
        replacedByNewLogin: () => undefined,
      };
      sessions.register(record.id, session);
      const player = createPlayer({ character: toCharacterDto(record), position: { x: boss.x, y: boss.y }, channel: session });
      room.addPlayer(player);
      return { record, session, player };
    });
    const battle = new BattleService({
      gameData,
      rooms,
      sessions,
      characters: characterService,
      inventory,
      equipment,
      tick,
      onDefeat: () => undefined,
      isFieldBossActive: () => true,
    });
    try {
      await Promise.all(players.map((participant) =>
        battle.engage({ session: participant.session, room, player: participant.player, targetId: boss.id }),
      ));
      const admittedPlayers = players.filter((participant) => {
        const output = messages.get(participant.record.id) ?? [];
        return output.some((message) => message.op === Opcode.S2C_BATTLE_START)
          && !output.some((message) => message.op === Opcode.S2C_ERROR);
      });
      const deniedPlayers = players.filter((participant) =>
        (messages.get(participant.record.id) ?? []).some((message) => message.op === Opcode.S2C_ERROR),
      );
      expect(admittedPlayers).toHaveLength(FIELD_BOSS_MAX_PLAYERS);
      expect(deniedPlayers).toHaveLength(1);
      const startPayloads = admittedPlayers.flatMap((participant) =>
        (messages.get(participant.record.id) ?? [])
          .filter((message) => message.op === Opcode.S2C_BATTLE_START)
          .map((message) => message.payload as { battleId: string }),
      );
      expect(new Set(startPayloads.map((payload) => payload.battleId)).size).toBe(1);
      expect(battle.activeCount).toBe(1);
      const participantIds = (messages.get(admittedPlayers.at(-1)!.record.id) ?? [])
        .filter((message) => message.op === Opcode.S2C_BATTLE_START)
        .flatMap((message) => (message.payload as { participants: { id: string; kind: string }[] }).participants)
        .filter((participant) => participant.kind === 'player')
        .map((participant) => participant.id)
        .sort();
      expect(participantIds).toEqual(admittedPlayers.map((participant) => participant.record.id).sort());
      for (const participant of admittedPlayers) {
        expect(messages.get(participant.record.id)?.some((message) => message.op === Opcode.S2C_ERROR)).toBe(false);
      }
      const rejected = deniedPlayers[0]!;
      const errors = (messages.get(rejected.record.id) ?? []).filter((message) => message.op === Opcode.S2C_ERROR);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.payload).toEqual({
        code: ErrorCode.INVALID_TARGET,
        message: `trận này đã đủ ${FIELD_BOSS_MAX_PLAYERS} người, hãy tìm con quái khác`,
      });

    } finally {
      battle.dispose();
      rooms.dispose();
      tick.dispose();
    }
  });

  it('rejects a third ordinary PvE player with the two-player cap error', async () => {
    const db = await getTestDb();
    const records: (typeof characters.$inferSelect)[] = [];
    for (let index = 0; index < BATTLE_MAX_PLAYERS + 1; index += 1) {
      const [account] = await db.insert(accounts).values({ username: `pve_cap_${index}`, passwordHash: 'test' }).returning();
      const [record] = await db.insert(characters).values({
        accountId: account!.id,
        name: `PveCap${index}`,
        school: 'haruna',
        class: 'dao',
        level: 3,
      }).returning();
      records.push(record!);
    }

    const inventory = new InventoryService(db, gameData);
    const characterService = new CharacterService(db, inventory, gameData);
    const equipment = new EquipmentService(gameData, characterService, inventory);
    const sessions = new SessionRegistry();
    const tick = new TickScheduler();
    const rooms = new RoomManager({ gameData, tick });
    const room = rooms.getOrCreate(TRAINING_MAP_ID)!;
    const monster = room.monsters()[0]!;
    const messages = new Map<string, { op: number; payload: unknown }[]>();
    const players = records.map((record, index) => {
      const output: { op: number; payload: unknown }[] = [];
      messages.set(record.id, output);
      const session: GameSession = {
        connectionId: `pve-cap-${index}`,
        characterId: record.id,
        mapId: TRAINING_MAP_ID,
        closed: false,
        send: (op, payload) => output.push({ op, payload }),
        sendError: (code, message) => output.push({ op: Opcode.S2C_ERROR, payload: { code, message } }),
        replacedByNewLogin: () => undefined,
      };
      sessions.register(record.id, session);
      const player = createPlayer({
        character: toCharacterDto(record),
        position: { x: monster.x, y: monster.y },
        channel: session,
      });
      room.addPlayer(player);
      return { record, session, player };
    });
    const battle = new BattleService({
      gameData,
      rooms,
      sessions,
      characters: characterService,
      inventory,
      equipment,
      tick,
      onDefeat: () => undefined,
    });

    try {
      await Promise.all(players.map((participant) =>
        battle.engage({ session: participant.session, room, player: participant.player, targetId: monster.id }),
      ));
      const admittedPlayers = players.filter((participant) => {
        const output = messages.get(participant.record.id) ?? [];
        return output.some((message) => message.op === Opcode.S2C_BATTLE_START)
          && !output.some((message) => message.op === Opcode.S2C_ERROR);
      });
      const deniedPlayers = players.filter((participant) =>
        (messages.get(participant.record.id) ?? []).some((message) => message.op === Opcode.S2C_ERROR),
      );
      expect(admittedPlayers).toHaveLength(BATTLE_MAX_PLAYERS);
      expect(deniedPlayers).toHaveLength(1);
      const startPayloads = admittedPlayers.flatMap((participant) =>
        (messages.get(participant.record.id) ?? [])
          .filter((message) => message.op === Opcode.S2C_BATTLE_START)
          .map((message) => message.payload as { battleId: string }),
      );
      expect(new Set(startPayloads.map((payload) => payload.battleId)).size).toBe(1);
      expect(battle.activeCount).toBe(1);
      const errors = (messages.get(deniedPlayers[0]!.record.id) ?? [])
        .filter((message) => message.op === Opcode.S2C_ERROR);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.payload).toEqual({
        code: ErrorCode.INVALID_TARGET,
        message: `trận này đã đủ ${BATTLE_MAX_PLAYERS} người, hãy tìm con quái khác`,
      });
    } finally {
      battle.dispose();
      rooms.dispose();
      tick.dispose();
    }
  });

  it('keeps a PvE character busy until settlement finishes', async () => {
    const db = await getTestDb();
    const [account] = await db
      .insert(accounts)
      .values({ username: 'pve_settlement', passwordHash: 'test' })
      .returning();
    const [record] = await db
      .insert(characters)
      .values({
        accountId: account!.id,
        name: 'PveSettlement',
        school: 'haruna',
        class: 'dao',
        level: 3,
      })
      .returning();
    const characterId = record!.id;
    const inventory = new InventoryService(db, gameData);
    const characterService = new CharacterService(db, inventory, gameData);
    const equipment = new EquipmentService(gameData, characterService, inventory);
    const sessions = new SessionRegistry();
    const tick = new TickScheduler();
    const rooms = new RoomManager({ gameData, tick });
    const messages: { op: number; payload: unknown }[] = [];
    const session: GameSession = {
      connectionId: 'pve-settlement',
      characterId,
      mapId: TRAINING_MAP_ID,
      closed: false,
      send: (op, payload) => messages.push({ op, payload }),
      sendError: (code, message) =>
        messages.push({ op: Opcode.S2C_ERROR, payload: { code, message } }),
      replacedByNewLogin: () => undefined,
    };
    sessions.register(characterId, session);

    const room = rooms.getOrCreate(TRAINING_MAP_ID);
    const monster = room!.monsters()[0]!;
    const player = createPlayer({
      character: toCharacterDto(record!),
      position: { x: monster.x, y: monster.y },
      channel: session,
    });
    room!.addPlayer(player);
    const battle = new BattleService({
      gameData,
      rooms,
      sessions,
      characters: characterService,
      inventory,
      equipment,
      tick,
      onDefeat: () => undefined,
      rng: () => 0,
    });
    const arenaQueue = vi.fn();
    const world = Object.assign(Object.create(WorldService.prototype), {
      options: { arena: { queuePlayer: arenaQueue } },
      battle,
      locate: () => ({ room: room!, player }),
    }) as WorldService;
    const settlementStarted = deferred();
    const settlementGate = deferred();
    let settling = false;
    const originalFindById = characterService.findById.bind(characterService);
    const findById = vi.spyOn(characterService, 'findById').mockImplementation(async (id) => {
      if (settling && id === characterId) {
        settlementStarted.resolve();
        await settlementGate.promise;
      }
      return originalFindById(id);
    });

    try {
      await battle.engage({ session, room: room!, player, targetId: monster.id });
      const start = messages.find((message) => message.op === Opcode.S2C_BATTLE_START)!.payload as {
        battleId: string;
      };
      settling = true;
      const action = battle.action(session, { battleId: start.battleId, action: 'flee' });
      await settlementStarted.promise;
      expect(battle.isBusy(characterId)).toBe(true);
      await world.arenaQueue(session);
      expect(arenaQueue).not.toHaveBeenCalled();
      settlementGate.resolve();
      await action;
      expect(battle.isBusy(characterId)).toBe(false);
    } finally {
      settlementGate.resolve();
      findById.mockRestore();
      battle.dispose();
      rooms.dispose();
      tick.dispose();
    }
  });
});
