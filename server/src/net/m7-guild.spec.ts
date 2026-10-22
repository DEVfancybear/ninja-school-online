import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { ErrorCode, Opcode, type ServerError } from '@ninja/shared';
import { closeTestDb, getTestDb, resetDatabase } from '../test/database.js';
import { accountWithCharacter, startTestServer, type TestServer } from '../test/game-server.js';
import { TestGameClient, delay } from '../test/ws-client.js';
import { makeCharacter } from '../test/character-fixture.js';
import { bossLootClaims, eventLoginClaims, eventQuests, inventoryItems, mails } from '../db/schema.js';
import { CharacterService } from '../modules/character/service.js';
import { GuildService } from '../modules/guild/service.js';
import { InventoryService } from '../modules/inventory/service.js';
import { MailService } from '../modules/mail/service.js';
import { M7Service } from '../modules/m7/service.js';
import { SessionRegistry } from './session-registry.js';
import { DEFAULT_GAME_DATA_DIR, loadGameData, type GameData } from '../world/game-data.js';
import type { Db } from '../db/client.js';

let server: TestServer;
let db: Db;
let gameData: GameData;
let guildService: GuildService;
let inventory: InventoryService;
let m7: M7Service;
let now = Date.parse('2026-02-03T12:00:00.000Z');
let clients: TestGameClient[] = [];
let suffix = 0;

beforeAll(async () => {
  db = await getTestDb();
  gameData = await loadGameData(DEFAULT_GAME_DATA_DIR);
  server = await startTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  now = Date.parse('2026-02-03T12:00:00.000Z');
  clients = [];
  const sessions = new SessionRegistry();
  inventory = new InventoryService(db, gameData);
  const mail = new MailService(db, inventory, gameData);
  guildService = new GuildService(db, new CharacterService(db, inventory, gameData), sessions);
  m7 = new M7Service(db, inventory, sessions, gameData, mail, { now: () => now });
});

afterEach(async () => {
  await Promise.all(clients.map((client) => client.close()));
});

afterAll(async () => {
  await server.close();
  await closeTestDb();
});

async function connectPlayer(prefix: string): Promise<{ client: TestGameClient; characterId: string }> {
  suffix += 1;
  const account = await accountWithCharacter(server.app, `m7user${suffix}`, `M7${prefix[0]}${String(suffix).padStart(4, '0')}`);
  const client = await TestGameClient.connect(server.wsUrl);
  clients.push(client);
  await client.hello({ access: account.access, characterId: account.characterId });
  return { client, characterId: account.characterId };
}

describe('bang hội M7', () => {
  it('returns a distinct exact error code for invalid, duplicate, missing, already-member, and nonmember causes', async () => {
    const owner = await makeCharacter();
    const member = await makeCharacter();
    const outsider = await makeCharacter();

    expect(await guildService.create(owner, '!!')).toMatchObject({ ok: false, code: ErrorCode.GUILD_NAME_INVALID });
    expect(await guildService.create(owner, 'Bang M7')).toEqual({ ok: true });
    expect(await guildService.create(member, 'bang m7')).toMatchObject({ ok: false, code: ErrorCode.GUILD_NAME_TAKEN });
    expect(await guildService.join(member, 'Khong Ton Tai')).toMatchObject({ ok: false, code: ErrorCode.GUILD_NOT_FOUND });
    expect(await guildService.join(member, 'BANG M7')).toEqual({ ok: true });
    expect(await guildService.join(member, 'BANG KHAC')).toMatchObject({ ok: false, code: ErrorCode.GUILD_ALREADY_MEMBER });
    expect(await guildService.leave(outsider)).toMatchObject({ ok: false, code: ErrorCode.GUILD_NOT_MEMBER });
    expect(await guildService.authorizeChat(outsider)).toMatchObject({ ok: false, code: ErrorCode.GUILD_NOT_MEMBER });
  });

  it('enforces the 20-member cap and transfers leadership to the oldest remaining member', async () => {
    const ids = await Promise.all(Array.from({ length: 21 }, () => makeCharacter()));
    const [leader, successor, ...rest] = ids;
    expect(await guildService.create(leader!, 'Lua Chien')).toEqual({ ok: true });
    expect(await guildService.join(successor!, 'Lua Chien')).toEqual({ ok: true });
    for (const id of rest.slice(0, 18)) expect(await guildService.join(id!, 'Lua Chien')).toEqual({ ok: true });
    expect(await guildService.join(rest[18]!, 'Lua Chien')).toMatchObject({ ok: false, code: ErrorCode.GUILD_FULL });
    expect(await guildService.leave(leader!)).toEqual({ ok: true });
    expect((await guildService.stateOf(successor!)).guild?.leaderName).toBe((await new CharacterService(db, inventory, gameData).findById(successor!))?.name);
  });

  it('awards 25 guild XP once per represented guild per boss victory and levels at 100 XP', async () => {
    const [leader, second, third] = await Promise.all([makeCharacter(), makeCharacter(), makeCharacter()]);
    await guildService.create(leader!, 'Ba Bang');
    await guildService.join(second!, 'Ba Bang');
    await guildService.join(third!, 'Ba Bang');

    for (let i = 0; i < 3; i += 1) await guildService.awardBossVictory([leader!, second!, third!]);
    expect((await guildService.stateOf(leader!)).guild).toMatchObject({ level: 1, exp: 75, members: expect.any(Array) });
    expect((await guildService.stateOf(leader!)).guild?.members).toHaveLength(3);
    await guildService.awardBossVictory([leader!, second!, third!]);
    expect((await guildService.stateOf(leader!)).guild).toMatchObject({ level: 2, exp: 0 });
  });

  it('supports three players in the same guild chat and rejects a nonmember with GUILD_NOT_MEMBER', async () => {
    const leader = await connectPlayer('Alice');
    const second = await connectPlayer('Binh');
    const third = await connectPlayer('Chi');
    const outsider = await connectPlayer('Dung');
    const createMark = leader.client.mark();
    leader.client.send(Opcode.C2S_GUILD_CREATE, { name: 'Tam Nhan' });
    await leader.client.waitForSince(createMark, Opcode.S2C_GUILD_UPDATE, (payload) => (payload as { guild?: { name?: string } }).guild?.name === 'Tam Nhan');

    const joinSecond = second.client.mark();
    second.client.send(Opcode.C2S_GUILD_JOIN, { name: 'Tam Nhan' });
    await second.client.waitForSince(joinSecond, Opcode.S2C_GUILD_UPDATE, (payload) => (payload as { guild?: { members?: unknown[] } }).guild?.members?.length === 2);
    const joinThird = third.client.mark();
    third.client.send(Opcode.C2S_GUILD_JOIN, { name: 'Tam Nhan' });
    await third.client.waitForSince(joinThird, Opcode.S2C_GUILD_UPDATE, (payload) => (payload as { guild?: { members?: unknown[] } }).guild?.members?.length === 3);

    const text = `guild-chat-${Date.now()}`;
    const secondMark = second.client.mark();
    const thirdMark = third.client.mark();
    const outsiderMark = outsider.client.mark();
    leader.client.send(Opcode.C2S_CHAT, { channel: 'guild', text });
    await Promise.all([
      second.client.waitForSince(secondMark, Opcode.S2C_CHAT, (payload) => (payload as { text?: string }).text === text),
      third.client.waitForSince(thirdMark, Opcode.S2C_CHAT, (payload) => (payload as { text?: string }).text === text),
    ]);
    await delay(50);
    expect(outsider.client.since(outsiderMark, Opcode.S2C_CHAT).some((packet) => (packet.payload as { text?: string }).text === text)).toBe(false);

    const errorMark = outsider.client.mark();
    outsider.client.send(Opcode.C2S_CHAT, { channel: 'guild', text: 'blocked' });
    const error = await outsider.client.waitForSince<ServerError>(errorMark, Opcode.S2C_ERROR, (payload) => (payload as ServerError).code === ErrorCode.GUILD_NOT_MEMBER);
    expect(error.code).toBe(ErrorCode.GUILD_NOT_MEMBER);
    const members = await guildService.stateOf(leader.characterId);
    expect(members.guild?.members).toHaveLength(3);
  });

  it('refreshes online presence for guild members on login and disconnect', async () => {
    const leader = await connectPlayer('Lead');
    suffix += 1;
    const memberName = `M7P${String(suffix).padStart(4, '0')}`;
    const memberAccount = await accountWithCharacter(server.app, `m7presence${suffix}`, memberName);

    const createMark = leader.client.mark();
    leader.client.send(Opcode.C2S_GUILD_CREATE, { name: 'Presence Guild' });
    await leader.client.waitForSince(createMark, Opcode.S2C_GUILD_UPDATE, (payload) => (payload as { guild?: { name?: string } }).guild?.name === 'Presence Guild');

    await guildService.join(memberAccount.characterId, 'Presence Guild');

    const memberClient = await TestGameClient.connect(server.wsUrl);
    clients.push(memberClient);
    const onlineMark = leader.client.mark();
    await memberClient.hello({ access: memberAccount.access, characterId: memberAccount.characterId });
    await leader.client.waitForSince(onlineMark, Opcode.S2C_GUILD_UPDATE, (payload) =>
      (payload as { guild?: { members?: Array<{ name: string; online: boolean }> } }).guild?.members?.some((member) => member.name === memberName && member.online) === true,
    );

    const disconnectedMark = leader.client.mark();
    await memberClient.close();
    await leader.client.waitForSince(disconnectedMark, Opcode.S2C_GUILD_UPDATE, (payload) =>
      (payload as { guild?: { members?: Array<{ name: string; online: boolean }> } }).guild?.members?.some((member) => member.name === memberName && !member.online) === true,
    );
  });
});

describe('event đầu tiên và boss field M7', () => {
  it('sends one login reward per UTC day, rejects duplicates with the exact code, and resets at UTC midnight', async () => {
    const characterId = await makeCharacter();
    now = Date.parse('2026-02-03T23:59:59.999Z');
    expect((await m7.state(characterId)).event.loginClaimed).toBe(false);
    expect(await m7.claimLogin(characterId)).toEqual({ ok: true });
    expect(await m7.claimLogin(characterId)).toMatchObject({ ok: false, code: ErrorCode.EVENT_ALREADY_CLAIMED });
    expect(await db.select().from(eventLoginClaims).where(and(
      eq(eventLoginClaims.characterId, characterId),
      eq(eventLoginClaims.utcDay, '2026-02-03'),
    ))).toHaveLength(1);
    expect(await db.select().from(mails).where(and(
      eq(mails.characterId, characterId),
      eq(mails.mailKey, 'm7-login-2026-02-03'),
    ))).toHaveLength(1);

    now = Date.parse('2026-02-04T00:00:00.000Z');
    expect((await m7.state(characterId)).event.loginClaimed).toBe(false);
    expect(await m7.claimLogin(characterId)).toEqual({ ok: true });
    expect(await db.select().from(eventLoginClaims).where(eq(eventLoginClaims.characterId, characterId))).toHaveLength(2);
  });

  it('rejects disabled event claims with EVENT_DISABLED and does not insert a claim or mail', async () => {
    const characterId = await makeCharacter();
    const inventory = new InventoryService(db, gameData);
    const disabled = new M7Service(db, inventory, new SessionRegistry(), gameData, new MailService(db, inventory, gameData), {
      eventEnabled: false,
      now: () => now,
    });
    expect((await disabled.state(characterId)).event.enabled).toBe(false);
    expect(await disabled.claimLogin(characterId)).toMatchObject({ ok: false, code: ErrorCode.EVENT_DISABLED });
    expect(await db.select().from(eventLoginClaims).where(eq(eventLoginClaims.characterId, characterId))).toHaveLength(0);
    expect(await db.select().from(mails).where(eq(mails.characterId, characterId))).toHaveLength(0);
  });

  it('increments the first-monster quest only from server settlement and sends one reward mail idempotently', async () => {
    const characterId = await makeCharacter();
    const initial = await m7.state(characterId);
    expect(initial.event.quest.progress).toBe(0);
    // There is deliberately no client progress opcode; invoking this server-only hook simulates a PvE settlement.
    await m7.onMonsterKilled(characterId);
    await m7.onMonsterKilled(characterId);
    await m7.onMonsterKilled(characterId);
    expect((await m7.state(characterId)).event.quest).toMatchObject({ progress: 1, complete: true, rewarded: true });
    expect(await db.select().from(eventQuests).where(eq(eventQuests.characterId, characterId))).toHaveLength(1);
    expect(await db.select().from(mails).where(and(
      eq(mails.characterId, characterId),
      eq(mails.mailKey, 'm7-quest-first-monster'),
    ))).toHaveLength(1);
  });

  it('atomically caps concurrent boss settlements to one item and one UTC-day claim', async () => {
    const characterId = await makeCharacter();
    const results = await Promise.all(Array.from({ length: 8 }, () => m7.grantBossLoot(characterId)));
    expect(results.filter((result) => result === 'granted')).toHaveLength(1);
    expect(results.filter((result) => result === 'capped')).toHaveLength(7);
    expect(await db.select().from(bossLootClaims).where(and(
      eq(bossLootClaims.characterId, characterId),
      eq(bossLootClaims.bossId, 'mob-thu-vuong'),
      eq(bossLootClaims.utcDay, '2026-02-03'),
    ))).toHaveLength(1);
    expect(await db.select().from(inventoryItems).where(and(
      eq(inventoryItems.characterId, characterId),
      eq(inventoryItems.itemId, 'item-da-vun'),
    ))).toMatchObject([{ quantity: 1 }]);
    now = Date.parse('2026-02-04T00:00:00.000Z');
    expect(await m7.grantBossLoot(characterId)).toBe('granted');
  });
});
