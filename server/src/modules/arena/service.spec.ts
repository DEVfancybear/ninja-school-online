import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ARENA_START_RATING, Opcode } from '@ninja/shared';
import { eq } from 'drizzle-orm';
import { accounts, characterArena, characters } from '../../db/schema.js';
import { closeTestDb, getTestDb, resetDatabase } from '../../test/database.js';
import { CharacterService } from '../character/service.js';
import { EquipmentService } from '../equipment/service.js';
import { InventoryService } from '../inventory/service.js';
import { SessionRegistry } from '../../net/session-registry.js';
import type { GameSession } from '../../net/session.js';
import { loadGameData, DEFAULT_GAME_DATA_DIR } from '../../world/game-data.js';
import { TickScheduler } from '../../core/tick.js';
import { ArenaService } from './service.js';
import { WorldService } from '../../world/world-service.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

describe('Arena admission reservation', () => {
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

  it('keeps duplicate queue requests out through validation and asynchronous pairing', async () => {
    const db = await getTestDb();
    const accountsRows = await db
      .insert(accounts)
      .values([
        { username: 'arena_admission_a', passwordHash: 'test' },
        { username: 'arena_admission_b', passwordHash: 'test' },
      ])
      .returning();
    const players = await db
      .insert(characters)
      .values([
        {
          accountId: accountsRows[0]!.id,
          name: 'ArenaAdmissionA',
          school: 'haruna',
          class: 'dao',
          level: 3,
        },
        {
          accountId: accountsRows[1]!.id,
          name: 'ArenaAdmissionB',
          school: 'haruna',
          class: 'dao',
          level: 3,
        },
      ])
      .returning();
    const ids = players.map((player) => player.id);
    const inventory = new InventoryService(db, gameData);
    const characterService = new CharacterService(db, inventory, gameData);
    const equipment = new EquipmentService(gameData, characterService, inventory);
    const sessions = new SessionRegistry();
    const received = new Map<string, { op: number; payload: unknown }[]>(ids.map((id) => [id, []]));
    for (const id of ids) {
      const session: GameSession = {
        connectionId: id,
        characterId: id,
        mapId: 'lang-khoi-nguon',
        closed: false,
        send: (op, payload) => received.get(id)!.push({ op, payload }),
        sendError: () => undefined,
        replacedByNewLogin: () => undefined,
      };
      sessions.register(id, session);
    }
    const tick = new TickScheduler();
    const arena = new ArenaService(db, gameData, characterService, equipment, sessions, tick);
    await arena.queuePlayer(ids[1]!);
    const beforeCancel = received.get(ids[1]!)!.length;
    await arena.cancel(ids[1]!);
    expect(
      received
        .get(ids[1]!)!
        .slice(beforeCancel)
        .some(
          (packet) =>
            packet.op === Opcode.S2C_ARENA_STATE &&
            (packet.payload as { queued: boolean }).queued === false,
        ),
    ).toBe(true);
    for (const packets of received.values()) packets.length = 0;
    const queueGate = deferred();
    const queueStarted = deferred();
    const pairGate = deferred();
    const pairStarted = deferred();
    let phase: 'queue' | 'pair' = 'queue';
    let queueReads = 0;
    let pairReads = 0;
    const originalFindById = characterService.findById.bind(characterService);
    const findById = vi.spyOn(characterService, 'findById').mockImplementation(async (id) => {
      if (phase === 'queue') {
        queueReads += 1;
        if (queueReads === 2) queueStarted.resolve();
        await queueGate.promise;
      } else {
        pairReads += 1;
        if (pairReads === 2) pairStarted.resolve();
        await pairGate.promise;
      }
      return originalFindById(id);
    });

    try {
      const queueA = arena.queuePlayer(ids[0]!);
      await vi.waitFor(() => expect(queueReads).toBe(1));
      expect(arena.isEngaged(ids[0]!)).toBe(true);
      const blockedEngage = vi.fn();
      const world = Object.assign(Object.create(WorldService.prototype), {
        options: { arena },
        battle: { engage: blockedEngage },
        locate: () => ({ room: {}, player: { id: ids[0]! } }),
      }) as WorldService;
      world.attackMonster(sessions.get(ids[0]!)!, { targetId: 'mob:test:0' });
      expect(blockedEngage).not.toHaveBeenCalled();
      await arena.queuePlayer(ids[0]!);
      expect(queueReads).toBe(1);

      const queueB = arena.queuePlayer(ids[1]!);
      await queueStarted.promise;
      phase = 'pair';
      queueGate.resolve();
      await pairStarted.promise;
      expect(arena.isEngaged(ids[0]!)).toBe(true);
      expect(arena.isEngaged(ids[1]!)).toBe(true);

      await arena.queuePlayer(ids[0]!);
      expect(pairReads).toBe(2);
      pairGate.resolve();
      await Promise.all([queueA, queueB]);

      for (const id of ids) {
        expect(
          received.get(id)!.filter((packet) => packet.op === Opcode.S2C_BATTLE_START),
        ).toHaveLength(1);
      }
      expect(arena.isEngaged(ids[0]!)).toBe(true);
      expect(arena.isEngaged(ids[1]!)).toBe(true);
      const [rating] = await db
        .select({ rating: characterArena.rating })
        .from(characterArena)
        .where(eq(characterArena.characterId, ids[0]!));
      expect(rating?.rating).toBe(ARENA_START_RATING);
    } finally {
      queueGate.resolve();
      pairGate.resolve();
      findById.mockRestore();
      arena.dispose();
      tick.dispose();
    }
  });
});
