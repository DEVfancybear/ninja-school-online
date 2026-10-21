import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ErrorCode,
  INVENTORY_CAPACITY,
  MAX_FRIENDS,
  PARTY_MAX_MEMBERS,
  Opcode,
  type ArenaEnd,
  type ArenaState,
  type BattleResult,
  type BattleStart,
  type BattleTurn,
  type Mail,
  type Mails,
  type PartyUpdate,
  type ServerError,
  type SocialUpdate,
} from '@ninja/shared';
import { and, eq, or } from 'drizzle-orm';
import { characters, friendships, inventoryItems, mails } from '../db/schema.js';
import { closeTestDb, getTestDb, resetDatabase } from '../test/database.js';
import { accountWithCharacter, startTestServer, type TestServer } from '../test/game-server.js';
import { TestGameClient, delay } from '../test/ws-client.js';

let server: TestServer;
let clients: TestGameClient[] = [];
let sequence = 0;

beforeAll(async () => {
  server = await startTestServer();
});
beforeEach(async () => {
  await resetDatabase();
});
afterEach(async () => {
  for (const client of clients) client.close();
  clients = [];
  await delay(50);
});
afterAll(async () => {
  await server.close();
  await closeTestDb();
});

async function enterWorld(): Promise<{
  client: TestGameClient;
  characterId: string;
  name: string;
}> {
  sequence += 1;
  const name = `M6Ninja${sequence}`;
  const { access, characterId } = await accountWithCharacter(
    server.app,
    `m6_user_${sequence}`,
    name,
  );
  const db = await getTestDb();
  await db.update(characters).set({ level: 3 }).where(eq(characters.id, characterId));
  const client = await TestGameClient.connect(server.wsUrl);
  clients.push(client);
  await client.hello({ access, characterId });
  await client.waitFor(Opcode.S2C_ARENA_STATE);
  return { client, characterId, name };
}

async function fillFriendList(characterId: string, suffix: string): Promise<void> {
  const db = await getTestDb();
  const [owner] = await db
    .select({ accountId: characters.accountId })
    .from(characters)
    .where(eq(characters.id, characterId));
  expect(owner).toBeDefined();
  const targets = await db
    .insert(characters)
    .values(
      Array.from({ length: MAX_FRIENDS }, (_, index) => ({
        accountId: owner!.accountId,
        name: `M6Cap${suffix}${index}`,
        school: 'haruna',
        class: 'dao',
      })),
    )
    .returning({ id: characters.id });
  await db.insert(friendships).values(
    targets.map((target) => ({
      requesterId: characterId,
      addresseeId: target.id,
      status: 'accepted' as const,
    })),
  );
}

describe('M6 realtime server flows', () => {
  it('handles friends, party, welcome mail and private chat errors; then queues, fights and settles arena on disconnect', async () => {
    const first = await enterWorld();
    const second = await enterWorld();

    first.client.send(Opcode.C2S_FRIEND_REQUEST, { name: second.name });
    const incoming = await second.client.waitFor<SocialUpdate>(
      Opcode.S2C_SOCIAL_UPDATE,
      (payload) => (payload as SocialUpdate).incoming.some((person) => person.name === first.name),
    );
    expect(incoming.incoming.map((person) => person.name)).toContain(first.name);
    second.client.send(Opcode.C2S_FRIEND_ACCEPT, { name: first.name });
    const friends = await first.client.waitFor<SocialUpdate>(Opcode.S2C_SOCIAL_UPDATE, (payload) =>
      (payload as SocialUpdate).friends.some((person) => person.name === second.name),
    );
    expect(friends.friends.map((person) => person.name)).toContain(second.name);

    first.client.send(Opcode.C2S_PARTY_INVITE, { name: second.name });
    const invited = await second.client.waitFor<PartyUpdate>(Opcode.S2C_PARTY_UPDATE, (payload) =>
      (payload as PartyUpdate).invites.some((invite) => invite.fromName === first.name),
    );
    expect(invited.invites[0]?.fromName).toBe(first.name);
    second.client.send(Opcode.C2S_PARTY_ACCEPT, { leaderName: first.name });
    const joined = await first.client.waitFor<PartyUpdate>(
      Opcode.S2C_PARTY_UPDATE,
      (payload) => (payload as PartyUpdate).members.length === 2,
    );
    expect(joined.members.map((member) => member.name).sort()).toEqual(
      [first.name, second.name].sort(),
    );

    const mailbox = await first.client.waitFor<Mails>(Opcode.S2C_MAILS, (payload) =>
      (payload as Mails).mails.some((mail) => mail.subject === 'Thư chào mừng'),
    );
    const welcome = mailbox.mails.find((mail: Mail) => mail.subject === 'Thư chào mừng')!;
    expect(welcome.claimed).toBe(false);
    first.client.send(Opcode.C2S_MAIL_CLAIM, { mailId: welcome.id });
    const claimed = await first.client.waitFor<Mails>(Opcode.S2C_MAILS, (payload) =>
      (payload as Mails).mails.some((mail) => mail.id === welcome.id && mail.claimed),
    );
    expect(claimed.mails.find((mail) => mail.id === welcome.id)?.claimed).toBe(true);
    first.client.send(Opcode.C2S_MAIL_CLAIM, { mailId: welcome.id });
    const alreadyClaimed = await first.client.waitFor<ServerError>(
      Opcode.S2C_ERROR,
      (payload) => (payload as ServerError).code === ErrorCode.MAIL_CLAIMED,
    );
    expect(alreadyClaimed.code).toBe(ErrorCode.MAIL_CLAIMED);

    first.client.send(Opcode.C2S_CHAT, { channel: 'private', to: 'M6Nobody', text: 'hello' });
    const missingRecipient = await first.client.waitFor<ServerError>(
      Opcode.S2C_ERROR,
      (payload) => (payload as ServerError).code === ErrorCode.CHARACTER_NOT_FOUND,
    );
    expect(missingRecipient.code).toBe(ErrorCode.CHARACTER_NOT_FOUND);

    first.client.send(Opcode.C2S_ARENA_QUEUE);
    const queued = await first.client.waitFor<ArenaState>(
      Opcode.S2C_ARENA_STATE,
      (payload) => (payload as ArenaState).queued,
    );
    expect(queued.queued).toBe(true);
    second.client.send(Opcode.C2S_ARENA_QUEUE);
    const firstStart = await first.client.waitFor<BattleStart>(Opcode.S2C_BATTLE_START);
    const secondStart = await second.client.waitFor<BattleStart>(Opcode.S2C_BATTLE_START);
    expect(firstStart.battleId).toBe(secondStart.battleId);
    expect(firstStart.participants).toHaveLength(2);

    const actor = firstStart.actorId === first.characterId ? first : second;
    const opponent = actor === first ? second : first;
    actor.client.send(Opcode.C2S_BATTLE_ACTION, {
      battleId: firstStart.battleId,
      action: 'attack',
      targetId: opponent.characterId,
    });
    const result = await actor.client.waitFor<BattleResult>(Opcode.S2C_BATTLE_RESULT);
    expect(result.actorId).toBe(actor.characterId);
    const nextTurn = await opponent.client.waitFor<BattleTurn>(Opcode.S2C_BATTLE_TURN);
    expect(nextTurn.actorId).toBe(opponent.characterId);

    opponent.client.close();
    const end = await actor.client.waitFor<ArenaEnd>(Opcode.S2C_ARENA_END);
    expect(end.outcome).toBe('win');
    expect(end.reason).toBe('opponent_left');
    expect(end.ratingAfter).toBeGreaterThanOrEqual(end.ratingBefore);
    const leaderboardMark = actor.client.mark();
    actor.client.send(Opcode.C2S_LEADERBOARD, { board: 'arena' });
    const leaderboard = await actor.client.waitForSince<{ board: string; entries: unknown[] }>(
      leaderboardMark,
      Opcode.S2C_LEADERBOARD,
    );
    expect(leaderboard.entries.length).toBeGreaterThanOrEqual(1);
  });

  it('checks friend capacity for both sides on accept and reverse auto-accept', async () => {
    const requester = await enterWorld();
    const fullTarget = await enterWorld();
    await fillFriendList(fullTarget.characterId, 'Cap');

    const db = await getTestDb();
    await db.insert(friendships).values({
      requesterId: fullTarget.characterId,
      addresseeId: requester.characterId,
    });
    requester.client.send(Opcode.C2S_FRIEND_ACCEPT, { name: fullTarget.name });
    const acceptError = await requester.client.waitFor<ServerError>(
      Opcode.S2C_ERROR,
      (payload) => (payload as ServerError).code === ErrorCode.FRIENDS_FULL,
    );
    expect(acceptError.code).toBe(ErrorCode.FRIENDS_FULL);

    requester.client.send(Opcode.C2S_FRIEND_REQUEST, { name: fullTarget.name });
    const reverseError = await requester.client.waitFor<ServerError>(
      Opcode.S2C_ERROR,
      (payload) => (payload as ServerError).code === ErrorCode.FRIENDS_FULL,
    );
    expect(reverseError.code).toBe(ErrorCode.FRIENDS_FULL);
    const pair = await db
      .select({ status: friendships.status })
      .from(friendships)
      .where(
        and(
          eq(friendships.requesterId, fullTarget.characterId),
          eq(friendships.addresseeId, requester.characterId),
        ),
      );
    expect(pair.map((row) => row.status)).toEqual(['pending']);
  });

  it('serializes simultaneous opposite friend requests into one accepted friendship', async () => {
    const first = await enterWorld();
    const second = await enterWorld();
    first.client.send(Opcode.C2S_FRIEND_REQUEST, { name: second.name });
    second.client.send(Opcode.C2S_FRIEND_REQUEST, { name: first.name });

    const firstUpdate = await first.client.waitFor<SocialUpdate>(
      Opcode.S2C_SOCIAL_UPDATE,
      (payload) => (payload as SocialUpdate).friends.some((friend) => friend.name === second.name),
    );
    const secondUpdate = await second.client.waitFor<SocialUpdate>(
      Opcode.S2C_SOCIAL_UPDATE,
      (payload) => (payload as SocialUpdate).friends.some((friend) => friend.name === first.name),
    );
    expect(firstUpdate.friends.map((friend) => friend.name)).toContain(second.name);
    expect(secondUpdate.friends.map((friend) => friend.name)).toContain(first.name);

    const db = await getTestDb();
    const pairs = await db
      .select({
        requesterId: friendships.requesterId,
        addresseeId: friendships.addresseeId,
        status: friendships.status,
      })
      .from(friendships)
      .where(
        or(
          and(
            eq(friendships.requesterId, first.characterId),
            eq(friendships.addresseeId, second.characterId),
          ),
          and(
            eq(friendships.requesterId, second.characterId),
            eq(friendships.addresseeId, first.characterId),
          ),
        ),
      );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.status).toBe('accepted');
  });

  it('enforces the exact party capacity and returns PARTY_FULL on the next invite', async () => {
    const players = await Promise.all(
      Array.from({ length: PARTY_MAX_MEMBERS + 1 }, () => enterWorld()),
    );
    const [leader, ...members] = players;
    expect(leader).toBeDefined();
    for (const [index, member] of members.slice(0, PARTY_MAX_MEMBERS - 1).entries()) {
      const inviteMark = member.client.mark();
      leader!.client.send(Opcode.C2S_PARTY_INVITE, { name: member.name });
      await member.client.waitForSince<PartyUpdate>(
        inviteMark,
        Opcode.S2C_PARTY_UPDATE,
        (payload) =>
          (payload as PartyUpdate).invites.some((invite) => invite.fromName === leader!.name),
      );
      const acceptMark = leader!.client.mark();
      member.client.send(Opcode.C2S_PARTY_ACCEPT, { leaderName: leader!.name });
      const update = await leader!.client.waitForSince<PartyUpdate>(
        acceptMark,
        Opcode.S2C_PARTY_UPDATE,
        (payload) => (payload as PartyUpdate).members.length === index + 2,
      );
      expect(update.members).toHaveLength(index + 2);
    }
    const state = await leader!.client.waitFor<PartyUpdate>(
      Opcode.S2C_PARTY_UPDATE,
      (payload) => (payload as PartyUpdate).members.length === PARTY_MAX_MEMBERS,
    );
    expect(state.members).toHaveLength(PARTY_MAX_MEMBERS);

    const fifth = members[PARTY_MAX_MEMBERS - 1]!;
    const fullMark = leader!.client.mark();
    leader!.client.send(Opcode.C2S_PARTY_INVITE, { name: fifth.name });
    const full = await leader!.client.waitForSince<ServerError>(
      fullMark,
      Opcode.S2C_ERROR,
      (payload) => (payload as ServerError).code === ErrorCode.PARTY_FULL,
    );
    expect(full.code).toBe(ErrorCode.PARTY_FULL);
  });

  it('enforces the one-second cooldown on map chat', async () => {
    const sender = await enterWorld();
    const recipient = await enterWorld();
    const recipientMark = recipient.client.mark();
    const senderMark = sender.client.mark();
    sender.client.send(Opcode.C2S_CHAT, { channel: 'map', text: 'm6-cooldown-first' });
    sender.client.send(Opcode.C2S_CHAT, { channel: 'map', text: 'm6-cooldown-too-soon' });
    const firstMessage = await recipient.client.waitForSince<{ text: string }>(
      recipientMark,
      Opcode.S2C_CHAT,
      (payload) => (payload as { text: string }).text === 'm6-cooldown-first',
    );
    expect(firstMessage.text).toBe('m6-cooldown-first');

    const limited = await sender.client.waitForSince<ServerError>(
      senderMark,
      Opcode.S2C_ERROR,
      (payload) => (payload as ServerError).code === ErrorCode.RATE_LIMITED,
    );
    expect(limited.code).toBe(ErrorCode.RATE_LIMITED);
    expect(limited.message).toContain('1 giây');
  });

  it('keeps mail rewards unclaimed when the bag is full, then accepts a retry after a slot opens', async () => {
    const player = await enterWorld();
    const db = await getTestDb();
    await db.delete(inventoryItems).where(eq(inventoryItems.characterId, player.characterId));
    const scratchItems = Array.from(
      { length: INVENTORY_CAPACITY },
      (_, index) => `m6-full-bag-${index}`,
    );
    await db
      .insert(inventoryItems)
      .values(scratchItems.map((itemId) => ({ characterId: player.characterId, itemId })));

    const [mail] = await db
      .insert(mails)
      .values({
        characterId: player.characterId,
        subject: 'Quà kiểm tra túi đầy',
        yen: 100,
        items: [{ itemId: 'item-tra-rung', qty: 1 }],
      })
      .returning();
    expect(mail).toBeDefined();

    player.client.send(Opcode.C2S_MAIL_CLAIM, { mailId: mail!.id });
    const full = await player.client.waitFor<ServerError>(
      Opcode.S2C_ERROR,
      (payload) => (payload as ServerError).code === ErrorCode.INVENTORY_FULL,
    );
    expect(full.code).toBe(ErrorCode.INVENTORY_FULL);

    const [unclaimed] = await db.select().from(mails).where(eq(mails.id, mail!.id));
    const [unchangedCharacter] = await db
      .select({ yen: characters.yen })
      .from(characters)
      .where(eq(characters.id, player.characterId));
    const [ungrantedItem] = await db
      .select({ itemId: inventoryItems.itemId })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.characterId, player.characterId),
          eq(inventoryItems.itemId, 'item-tra-rung'),
        ),
      );
    expect(unclaimed?.claimedAt).toBeNull();
    expect(unchangedCharacter?.yen).toBe(200);
    expect(ungrantedItem).toBeUndefined();

    await db
      .delete(inventoryItems)
      .where(
        and(
          eq(inventoryItems.characterId, player.characterId),
          eq(inventoryItems.itemId, scratchItems[0]!),
        ),
      );
    player.client.send(Opcode.C2S_MAIL_CLAIM, { mailId: mail!.id });
    player.client.send(Opcode.C2S_MAIL_CLAIM, { mailId: mail!.id });
    const claimed = await player.client.waitFor<Mails>(Opcode.S2C_MAILS, (payload) =>
      (payload as Mails).mails.some((row) => row.id === mail!.id && row.claimed),
    );
    const duplicateClaim = await player.client.waitFor<ServerError>(
      Opcode.S2C_ERROR,
      (payload) => (payload as ServerError).code === ErrorCode.MAIL_CLAIMED,
    );
    expect(duplicateClaim.code).toBe(ErrorCode.MAIL_CLAIMED);
    expect(claimed.mails.find((row) => row.id === mail!.id)?.claimed).toBe(true);
    const [updatedCharacter] = await db
      .select({ yen: characters.yen })
      .from(characters)
      .where(eq(characters.id, player.characterId));
    const [grantedItem] = await db
      .select({ quantity: inventoryItems.quantity })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.characterId, player.characterId),
          eq(inventoryItems.itemId, 'item-tra-rung'),
        ),
      );
    expect(updatedCharacter?.yen).toBe(300);
    expect(grantedItem?.quantity).toBe(1);
  });
});
