import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ARENA_START_RATING, Opcode } from '@ninja/shared';
import { eq, inArray, sql } from 'drizzle-orm';
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
        sendError: (code, message) =>
          received.get(id)!.push({ op: Opcode.S2C_ERROR, payload: { code, message } }),
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
    let queueGate = deferred();
    let queueStarted = deferred();
    let pairGate = deferred();
    let pairStarted = deferred();
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
      const cancelledAdmission = arena.queuePlayer(ids[0]!);
      await vi.waitFor(() => expect(queueReads).toBe(1));
      await arena.cancel(ids[0]!);
      expect(arena.isEngaged(ids[0]!)).toBe(true);
      queueGate.resolve();
      await cancelledAdmission;
      expect(arena.isEngaged(ids[0]!)).toBe(false);
      expect(
        received
          .get(ids[0]!)!
          .some(
            (packet) =>
              packet.op === Opcode.S2C_ARENA_STATE &&
              (packet.payload as { queued: boolean }).queued,
          ),
      ).toBe(false);

      for (const packets of received.values()) packets.length = 0;
      queueGate = deferred();
      queueStarted = deferred();
      pairGate = deferred();
      pairStarted = deferred();
      queueReads = 0;
      pairReads = 0;
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
      await arena.leave(ids[0]!);
      pairGate.resolve();
      await Promise.all([queueA, queueB]);
      expect(
        received.get(ids[0]!)!.filter((packet) => packet.op === Opcode.S2C_BATTLE_START),
      ).toHaveLength(0);
      expect(arena.isEngaged(ids[0]!)).toBe(false);
      expect(arena.isEngaged(ids[1]!)).toBe(true);

      phase = 'pair';
      const failPairStart = vi
        .spyOn(equipment, 'bonusFor')
        .mockRejectedValueOnce(new Error('pair setup failpoint'));
      await arena.queuePlayer(ids[0]!);
      failPairStart.mockRestore();
      for (const id of ids) {
        expect(
          received.get(id)!.filter((packet) => packet.op === Opcode.S2C_BATTLE_START),
        ).toHaveLength(0);
        expect(
          received
            .get(id)!
            .filter((packet) => packet.op === Opcode.S2C_ERROR)
            .map((packet) => packet.payload),
        ).toContainEqual(expect.objectContaining({ code: 'internal_error' }));
        expect((await arena.state(id)).queued).toBe(true);
        expect(arena.isEngaged(id)).toBe(true);
      }
      await arena.cancel(ids[0]!);
      await arena.cancel(ids[1]!);
      await arena.queuePlayer(ids[0]!);
      await arena.queuePlayer(ids[1]!);
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

      await db.execute(
        sql.raw(`CREATE FUNCTION sleep_arena_rating_write() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            PERFORM pg_sleep(0.5);
            RETURN NEW;
          END;
        $$`),
      );
      await db.execute(
        sql.raw(`CREATE TRIGGER arena_rating_test_sleep BEFORE UPDATE ON character_arena
          FOR EACH ROW EXECUTE FUNCTION sleep_arena_rating_write()`),
      );
      try {
        const settlement = arena.leave(ids[0]!);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(arena.isEngaged(ids[0]!)).toBe(true);
        expect(arena.isDueling(ids[0]!)).toBe(true);
        await settlement;
        expect(arena.isEngaged(ids[0]!)).toBe(false);
      } finally {
        await db.execute(
          sql.raw(`DROP TRIGGER IF EXISTS arena_rating_test_sleep ON character_arena`),
        );
        await db.execute(sql.raw(`DROP FUNCTION IF EXISTS sleep_arena_rating_write()`));
      }

      await arena.queuePlayer(ids[0]!);
      await arena.queuePlayer(ids[1]!);
      for (const id of ids) {
        expect(
          received.get(id)!.filter((packet) => packet.op === Opcode.S2C_BATTLE_START),
        ).toHaveLength(2);
      }

      for (const packets of received.values()) packets.length = 0;
      const ratingsBeforeFailure = await db
        .select({
          characterId: characterArena.characterId,
          rating: characterArena.rating,
          wins: characterArena.wins,
          losses: characterArena.losses,
        })
        .from(characterArena)
        .where(inArray(characterArena.characterId, ids));
      await db.execute(
        sql.raw(
          `CREATE TABLE arena_rating_test_counter (id integer PRIMARY KEY, calls integer NOT NULL)`,
        ),
      );
      await db.execute(sql.raw(`INSERT INTO arena_rating_test_counter VALUES (1, 0)`));
      await db.execute(
        sql.raw(`CREATE FUNCTION fail_second_arena_rating_write() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            UPDATE arena_rating_test_counter SET calls = calls + 1 WHERE id = 1;
            IF (SELECT calls FROM arena_rating_test_counter WHERE id = 1) = 2 THEN
              RAISE EXCEPTION 'arena settlement failpoint';
            END IF;
            RETURN NEW;
          END;
        $$`),
      );
      await db.execute(
        sql.raw(`CREATE TRIGGER arena_rating_test_failpoint BEFORE UPDATE ON character_arena
          FOR EACH ROW EXECUTE FUNCTION fail_second_arena_rating_write()`),
      );
      try {
        await expect(arena.leave(ids[0]!)).rejects.toMatchObject({
          cause: expect.objectContaining({ message: 'arena settlement failpoint' }),
        });
        expect(arena.isEngaged(ids[0]!)).toBe(true);
        expect(arena.isDueling(ids[0]!)).toBe(true);
        for (const id of ids) {
          expect(
            received.get(id)!.filter((packet) => packet.op === Opcode.S2C_ARENA_END),
          ).toHaveLength(0);
        }
        const afterFailure = await db
          .select({
            characterId: characterArena.characterId,
            rating: characterArena.rating,
            wins: characterArena.wins,
            losses: characterArena.losses,
          })
          .from(characterArena)
          .where(inArray(characterArena.characterId, ids));
        expect(afterFailure).toHaveLength(2);
        expect(afterFailure).toEqual(expect.arrayContaining(ratingsBeforeFailure));
        for (const id of ids) {
          expect(
            received.get(id)!.filter((packet) => packet.op === Opcode.S2C_ARENA_END),
          ).toHaveLength(0);
        }
      } finally {
        await db.execute(
          sql.raw(`DROP TRIGGER IF EXISTS arena_rating_test_failpoint ON character_arena`),
        );
        await db.execute(sql.raw(`DROP FUNCTION IF EXISTS fail_second_arena_rating_write()`));
        await db.execute(sql.raw(`DROP TABLE IF EXISTS arena_rating_test_counter`));
      }
    } finally {
      queueGate.resolve();
      pairGate.resolve();
      findById.mockRestore();
      arena.dispose();
      tick.dispose();
    }
  });
});
