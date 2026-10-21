import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, Opcode } from '@ninja/shared';
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
