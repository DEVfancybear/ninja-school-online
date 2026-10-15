import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CHAT_BACKLOG_SIZE,
  CHAT_MAX_LENGTH,
  ErrorCode,
  Opcode,
  PROTOCOL_VERSION,
  TICK_RATE_MS,
  type ChatMessage,
  type Entity,
  type EntityMove,
  type NpcDialog,
  type Notify,
  type ServerEnterMap,
  type ServerError,
} from '@ninja/shared';
import { closeTestDb, resetDatabase } from '../test/database.js';
import {
  accountWithCharacter,
  createCharacter,
  registerAccount,
  startTestServer,
  type TestServer,
} from '../test/game-server.js';
import { TestGameClient, delay } from '../test/ws-client.js';

/** Bản đồ khởi đầu và điểm spawn mà server dùng cho mọi kết nối ở M2. */
const START_MAP_ID = 'lang-khoi-nguon';
const START_SPAWN = { x: 656, y: 528 };
const LAN_NPC_ID = 'npc-thay-hieu-truong';

/** Vùng cổng ở làng: ô x 35..37, y 14..17 → pixel x [1120, 1216), y [448, 576). */
const LAN_PORTAL_PIXEL = { x: 1152, y: 528 };
/** Vùng cổng ở bãi luyện tập: ô x 1..3, y 12..15 → pixel x [32, 128), y [384, 512). */
const TRAINING_PORTAL_PIXEL = { x: 127, y: 464 };
const TRAINING_SPAWN = { x: 208, y: 464 };

let server: TestServer;
const clients: TestGameClient[] = [];

async function connect(url: string = server.wsUrl): Promise<TestGameClient> {
  const client = await TestGameClient.connect(url);
  clients.push(client);
  return client;
}

/** Chờ thực thể `id` đi tới `target` (sai số `epsilon` px) và trả về bước cuối cùng. */
async function waitForArrival(
  observer: TestGameClient,
  id: string,
  target: { x: number; y: number },
  epsilon = 2,
): Promise<{ x: number; y: number; facing: string }> {
  const payload = await observer.waitFor<EntityMove>(
    Opcode.S2C_ENTITY_MOVE,
    (raw) => {
      const move = (raw as EntityMove).moves.find((step) => step.id === id);
      return move !== undefined
        ? Math.abs(move.x - target.x) <= epsilon && Math.abs(move.y - target.y) <= epsilon
        : false;
    },
    8000,
  );
  const move = payload.moves.find((step) => step.id === id);
  if (!move) {
    throw new Error(`không thấy thực thể ${id} trong gói ENTITY_MOVE`);
  }
  return move;
}

function stepsFor(client: TestGameClient, mark: number, id: string): EntityMove['moves'] {
  return client
    .since(mark, Opcode.S2C_ENTITY_MOVE)
    .flatMap((packet) => (packet.payload as EntityMove).moves.filter((step) => step.id === id));
}

beforeAll(async () => {
  server = await startTestServer();
});

beforeEach(async () => {
  await resetDatabase();
});

afterEach(async () => {
  while (clients.length > 0) {
    await clients.pop()?.close();
  }
  // Cho server xử lý sự kiện đóng socket (dọn thực thể khỏi room) trước test kế tiếp.
  await delay(20);
});

afterAll(async () => {
  await server.close();
  await closeTestDb();
});

describe('bắt tay qua WebSocket', () => {
  it('token rác → unauthorized, fatal và đóng kết nối', async () => {
    const client = await connect();
    client.sendHello({ access: 'khong-phai-token-hop-le' });

    const error = await client.waitForError();
    expect(error.code).toBe(ErrorCode.UNAUTHORIZED);
    expect(error.fatal).toBe(true);

    const closed = await client.closed;
    expect(closed.code).toBe(1002);
  });

  it('sai phiên bản giao thức → protocol_mismatch, fatal và đóng kết nối', async () => {
    const { access } = await accountWithCharacter(server.app, 'ninja_ws_ver', 'PhienBanSai');

    const client = await connect();
    client.sendHello({ access, protocolVersion: PROTOCOL_VERSION + 1 });

    const error = await client.waitForError();
    expect(error.code).toBe(ErrorCode.PROTOCOL_MISMATCH);
    expect(error.fatal).toBe(true);
    expect(error.message).toContain(`server dùng ${PROTOCOL_VERSION}`);

    expect((await client.closed).code).toBe(1002);
  });

  it('tài khoản chưa có nhân vật → no_character kèm hướng dẫn tạo nhân vật', async () => {
    const access = await registerAccount(server.app, 'ninja_ws_nochar');

    const client = await connect();
    client.sendHello({ access });

    const error = await client.waitForError();
    expect(error.code).toBe(ErrorCode.NO_CHARACTER);
    expect(error.fatal).toBe(true);
    expect(error.message).toContain('tạo nhân vật');

    expect((await client.closed).code).toBe(1002);
  });

  it('nhân vật không thuộc tài khoản → bad_packet, fatal', async () => {
    const owner = await accountWithCharacter(server.app, 'ninja_ws_owner', 'ChuSoHuu');
    const other = await accountWithCharacter(server.app, 'ninja_ws_other', 'NguoiKhac');

    const client = await connect();
    client.sendHello({ access: other.access, characterId: owner.characterId });

    const error = await client.waitForError();
    expect(error.code).toBe(ErrorCode.BAD_PACKET);
    expect(error.fatal).toBe(true);
    expect(error.message).toContain('không thuộc tài khoản');
  });

  it('gửi gói khác trước khi bắt tay → bad_packet, fatal', async () => {
    const client = await connect();
    client.send(Opcode.C2S_PING, { clientTime: Date.now() });

    const error = await client.waitForError();
    expect(error.code).toBe(ErrorCode.BAD_PACKET);
    expect(error.fatal).toBe(true);
    expect(error.message).toContain('C2S_HELLO');
  });

  it('HELLO hợp lệ → S2C_HELLO + S2C_ENTER_MAP đúng bản đồ, đúng nhân vật và điểm spawn', async () => {
    const { access, characterId } = await accountWithCharacter(
      server.app,
      'ninja_ws_ok',
      'HoaLong',
    );

    const client = await connect();
    const { hello, enterMap } = await client.hello({ access });

    expect(hello).toMatchObject({
      protocolVersion: PROTOCOL_VERSION,
      tickRateMs: TICK_RATE_MS,
      characterId,
      characterName: 'HoaLong',
      mapId: START_MAP_ID,
    });
    expect(typeof hello.serverTime).toBe('number');

    expect(enterMap.map.id).toBe(START_MAP_ID);
    expect(enterMap.map.name).toBe('Làng Khởi Nguồn');
    expect(enterMap.map.width).toBe(40);
    expect(enterMap.map.height).toBe(30);
    expect(enterMap.map.tileSize).toBe(32);
    expect(enterMap.map.ground).toHaveLength(30);
    expect(enterMap.map.decor).toHaveLength(30);
    expect(enterMap.map.tiles.length).toBeGreaterThan(0);

    // Thực thể của chính mình: đứng đúng tâm ô spawn `default` (20, 16).
    expect(enterMap.entity).toMatchObject({
      id: characterId,
      kind: 'player',
      name: 'HoaLong',
      x: START_SPAWN.x,
      y: START_SPAWN.y,
      level: 1,
    });
    // Người mới chỉ thấy NPC của làng, không thấy chính mình trong danh sách.
    expect(enterMap.entities.map((entity) => entity.id)).toContain(LAN_NPC_ID);
    expect(enterMap.entities.some((entity) => entity.id === characterId)).toBe(false);
    expect(enterMap.chatBacklog).toEqual([]);
  });

  it('chọn nhân vật theo characterId, bỏ trống thì lấy nhân vật tạo gần nhất', async () => {
    const access = await registerAccount(server.app, 'ninja_ws_two');
    const older = await createCharacter(server.app, access, 'NhanVatCu');
    // Chờ một nhịp để `created_at` của hai nhân vật chắc chắn khác nhau.
    await delay(20);
    const newer = await createCharacter(server.app, access, 'NhanVatMoi');

    const picked = await connect();
    const { hello } = await picked.hello({ access, characterId: older });
    expect(hello.characterId).toBe(older);
    expect(hello.characterName).toBe('NhanVatCu');

    const latest = await connect();
    const fallback = await latest.hello({ access });
    expect(fallback.hello.characterId).toBe(newer);
  });

  it('một cổng duy nhất phục vụ cả REST API và WebSocket', async () => {
    const client = await connect();
    const response = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { protocolVersion: number }).protocolVersion).toBe(
      PROTOCOL_VERSION,
    );
    void client;
  });

  it('yêu cầu upgrade ở đường dẫn khác bị từ chối', async () => {
    const wrongUrl = `${server.wsUrl.replace(/\/ws$/, '')}/khong-phai-duong-dan-ws`;
    await expect(
      Promise.race([
        TestGameClient.connect(wrongUrl),
        delay(3000).then(() => {
          throw new Error('kết nối sai đường dẫn không bị từ chối');
        }),
      ]),
    ).rejects.toThrow();
  });
});

describe('vào map và thấy nhau', () => {
  it('hai người chơi thấy nhau: mỗi bên nhận ENTITY_ADD của bên kia, entities không chứa chính mình', async () => {
    const a = await accountWithCharacter(server.app, 'ninja_seen_a', 'NguoiA');
    const b = await accountWithCharacter(server.app, 'ninja_seen_b', 'NguoiB');

    const clientA = await connect();
    await clientA.hello({ access: a.access });
    const markA = clientA.mark();

    const clientB = await connect();
    const { enterMap } = await clientB.hello({ access: b.access });

    const visible = enterMap.entities.map((entity) => entity.id);
    expect(visible).toContain(a.characterId);
    expect(visible).toContain(LAN_NPC_ID);
    expect(visible).not.toContain(b.characterId);
    expect(enterMap.entity.id).toBe(b.characterId);

    const added = await clientA.waitFor<{ entity: Entity }>(
      Opcode.S2C_ENTITY_ADD,
      (raw) => (raw as { entity: Entity }).entity.id === b.characterId,
    );
    expect(added.entity).toMatchObject({
      id: b.characterId,
      kind: 'player',
      name: 'NguoiB',
      x: START_SPAWN.x,
      y: START_SPAWN.y,
    });
    expect(clientA.since(markA, Opcode.S2C_ENTITY_ADD)).toHaveLength(1);
  });

  it('người chơi ngắt kết nối → người còn lại nhận ENTITY_REMOVE', async () => {
    const a = await accountWithCharacter(server.app, 'ninja_leave_a', 'DiRa');
    const b = await accountWithCharacter(server.app, 'ninja_leave_b', 'OLai');

    const clientA = await connect();
    await clientA.hello({ access: a.access });
    const clientB = await connect();
    await clientB.hello({ access: b.access });
    // Đồng bộ: A (người đã ở trong map) nhận thông báo có B vào.
    await clientA.waitFor<{ entity: Entity }>(
      Opcode.S2C_ENTITY_ADD,
      (raw) => (raw as { entity: Entity }).entity.id === b.characterId,
    );

    await clientA.close();

    const removed = await clientB.waitFor<{ id: string }>(
      Opcode.S2C_ENTITY_REMOVE,
      (raw) => (raw as { id: string }).id === a.characterId,
    );
    expect(removed.id).toBe(a.characterId);
  });

  it('cùng nhân vật mở kết nối mới → phiên cũ bị đẩy ra, không có thực thể trùng', async () => {
    const a = await accountWithCharacter(server.app, 'ninja_dup', 'DangNhapLai');

    const first = await connect();
    await first.hello({ access: a.access });

    const second = await connect();
    const { enterMap } = await second.hello({ access: a.access, characterId: a.characterId });

    const notice = await first.waitFor<Notify>(Opcode.S2C_NOTIFY);
    expect(notice.message).toContain('đăng nhập');
    expect((await first.closed).code).toBe(4000);
    expect(enterMap.entities.filter((entity) => entity.id === a.characterId)).toHaveLength(0);
  });
});

describe('di chuyển', () => {
  it('B nhận các bước của A, toạ độ tiến dần rồi dừng đúng đích (sai số ≤ 2 px)', async () => {
    const a = await accountWithCharacter(server.app, 'ninja_move_a', 'NguoiDi');
    const b = await accountWithCharacter(server.app, 'ninja_move_b', 'NguoiXem');

    const clientA = await connect();
    await clientA.hello({ access: a.access });
    const clientB = await connect();
    await clientB.hello({ access: b.access });
    await clientA.waitFor<{ entity: Entity }>(
      Opcode.S2C_ENTITY_ADD,
      (raw) => (raw as { entity: Entity }).entity.id === b.characterId,
    );

    const markA = clientA.mark();
    const markB = clientB.mark();
    const target = { x: START_SPAWN.x + 160, y: START_SPAWN.y };
    clientA.send(Opcode.C2S_MOVE, target);

    const final = await waitForArrival(clientB, a.characterId, target);
    expect(final.x).toBeCloseTo(target.x, 5);
    expect(final.facing).toBe('e');

    const steps = stepsFor(clientB, markB, a.characterId);
    expect(steps.length).toBeGreaterThanOrEqual(5);
    for (let index = 1; index < steps.length; index += 1) {
      const previous = steps[index - 1];
      const current = steps[index];
      if (!previous || !current) {
        continue;
      }
      // Đi dần đều về phía đông, mỗi nhịp không vượt quá 16 px (160 px/s × 0,1 s).
      expect(current.x).toBeGreaterThanOrEqual(previous.x);
      expect(current.x - previous.x).toBeLessThanOrEqual(16);
    }

    // Người vừa di chuyển cũng nhận vị trí do server xác nhận, cùng số gói như người xem.
    const ownSteps = stepsFor(clientA, markA, a.characterId);
    expect(ownSteps.length).toBe(steps.length);
    expect(ownSteps[ownSteps.length - 1]?.x).toBeCloseTo(target.x, 5);
    expect(clientA.since(markA, Opcode.S2C_ENTITY_MOVE)).toHaveLength(steps.length);
  });

  it('từ chối di chuyển quá xa, ra ngoài biên, vào ô bị chặn — và không đổi vị trí', async () => {
    const a = await accountWithCharacter(server.app, 'ninja_bad_move', 'DiSai');
    const client = await connect();
    await client.hello({ access: a.access });

    const mark = client.mark();
    client.send(Opcode.C2S_MOVE, { x: 1264, y: 528 }); // 608 px > MAX_MOVE_DISTANCE_PX (600)
    client.send(Opcode.C2S_MOVE, { x: 656, y: 960 }); // y = chiều cao bản đồ → ngoài biên
    client.send(Opcode.C2S_MOVE, { x: 688, y: 560 }); // ô (21,17) bị chặn

    const tooFar = await client.waitForError();
    const outOfBounds = await client.waitForError();
    const blocked = await client.waitForError();

    expect([tooFar, outOfBounds, blocked].map((error) => error.code)).toEqual([
      ErrorCode.BAD_PACKET,
      ErrorCode.BAD_PACKET,
      ErrorCode.BAD_PACKET,
    ]);
    expect([tooFar, outOfBounds, blocked].every((error) => error.fatal === false)).toBe(true);
    expect(tooFar.message).toContain('600 px');
    expect(outOfBounds.message).toContain('ngoài bản đồ');
    expect(blocked.message).toContain('bị chặn');

    // Không có gói di chuyển nào được phát, và vị trí vẫn là điểm spawn.
    expect(client.since(mark, Opcode.S2C_ENTITY_MOVE)).toHaveLength(0);

    const markValid = client.mark();
    client.send(Opcode.C2S_MOVE, { x: START_SPAWN.x + 64, y: START_SPAWN.y });
    await waitForArrival(client, a.characterId, { x: START_SPAWN.x + 64, y: START_SPAWN.y });

    const steps = stepsFor(client, markValid, a.characterId);
    expect(steps[0]?.x).toBe(START_SPAWN.x + 16);
    expect(steps[steps.length - 1]?.x).toBe(START_SPAWN.x + 64);
  });

  it('đứng yên thì server không phát gói di chuyển nào', async () => {
    const a = await accountWithCharacter(server.app, 'ninja_idle', 'DungYen');
    const client = await connect();
    await client.hello({ access: a.access });

    const mark = client.mark();
    await delay(300);
    expect(client.since(mark, Opcode.S2C_ENTITY_MOVE)).toHaveLength(0);
  });
});

describe('chat', () => {
  it('A gửi tin → cả room nhận đúng nội dung, tin thứ hai trong cùng giây bị rate_limited', async () => {
    const a = await accountWithCharacter(server.app, 'ninja_chat_a', 'NguoiNoi');
    const b = await accountWithCharacter(server.app, 'ninja_chat_b', 'NguoiNghe');

    const clientA = await connect();
    await clientA.hello({ access: a.access });
    const clientB = await connect();
    await clientB.hello({ access: b.access });
    // Đồng bộ: A (người đã ở trong map) nhận thông báo có B vào.
    await clientA.waitFor<{ entity: Entity }>(
      Opcode.S2C_ENTITY_ADD,
      (raw) => (raw as { entity: Entity }).entity.id === b.characterId,
    );

    const markA = clientA.mark();
    const markB = clientB.mark();
    const before = Date.now();
    clientA.send(Opcode.C2S_CHAT, { channel: 'map', text: 'chào cả làng' });

    const spoken = await clientB.waitFor<ChatMessage>(Opcode.S2C_CHAT);
    expect(spoken).toMatchObject({
      channel: 'map',
      fromId: a.characterId,
      fromName: 'NguoiNoi',
      text: 'chào cả làng',
    });
    expect(spoken.at).toBeGreaterThanOrEqual(before);
    // Người gửi cũng thấy tin của mình.
    expect(clientA.since(markA, Opcode.S2C_CHAT)).toHaveLength(1);

    // Tin thứ hai ngay sau đó: bị chặn vì giãn cách tối thiểu 1 giây.
    clientA.send(Opcode.C2S_CHAT, { channel: 'map', text: 'tin thứ hai' });
    const limited = await clientA.waitForError();
    expect(limited.code).toBe(ErrorCode.RATE_LIMITED);
    expect(limited.fatal).toBe(false);

    await delay(300);
    expect(clientB.since(markB, Opcode.S2C_CHAT)).toHaveLength(1);

    // Sau khi hết giãn cách thì gửi lại được.
    await delay(800);
    clientA.send(Opcode.C2S_CHAT, { channel: 'map', text: 'tin thứ ba' });
    const third = await clientB.waitFor<ChatMessage>(
      Opcode.S2C_CHAT,
      (raw) => (raw as ChatMessage).text === 'tin thứ ba',
    );
    expect(third.text).toBe('tin thứ ba');
  });

  it('tin dài quá giới hạn cũng bị chặn bằng rate_limited (không fatal)', async () => {
    const a = await accountWithCharacter(server.app, 'ninja_chat_long', 'NoiDai');
    const client = await connect();
    await client.hello({ access: a.access });

    const mark = client.mark();
    client.send(Opcode.C2S_CHAT, { channel: 'map', text: 'x'.repeat(CHAT_MAX_LENGTH + 1) });

    const error = await client.waitForError();
    expect(error.code).toBe(ErrorCode.RATE_LIMITED);
    expect(error.fatal).toBe(false);
    expect(error.message).toContain(String(CHAT_MAX_LENGTH));
    expect(client.since(mark, Opcode.S2C_CHAT)).toHaveLength(0);
  });

  it('người vào sau nhận lịch sử chat gần nhất của room', async () => {
    const a = await accountWithCharacter(server.app, 'ninja_backlog_a', 'NoiTruoc');
    const b = await accountWithCharacter(server.app, 'ninja_backlog_b', 'VaoSau');

    const clientA = await connect();
    await clientA.hello({ access: a.access });
    clientA.send(Opcode.C2S_CHAT, { channel: 'map', text: 'có ai ở đây không?' });
    await clientA.waitFor<ChatMessage>(Opcode.S2C_CHAT);

    const clientB = await connect();
    const { enterMap } = await clientB.hello({ access: b.access });
    expect(enterMap.chatBacklog).toHaveLength(1);
    expect(enterMap.chatBacklog[0]).toMatchObject({
      channel: 'map',
      fromName: 'NoiTruoc',
      text: 'có ai ở đây không?',
    });
    expect(CHAT_BACKLOG_SIZE).toBeGreaterThan(0);
  });
});

describe('NPC', () => {
  it('nói chuyện với NPC trong map → S2C_NPC_DIALOG đủ 3 dòng', async () => {
    const a = await accountWithCharacter(server.app, 'ninja_npc', 'HocTro');
    const client = await connect();
    await client.hello({ access: a.access });

    client.send(Opcode.C2S_NPC_TALK, { npcId: LAN_NPC_ID });
    const dialog = await client.waitFor<NpcDialog>(Opcode.S2C_NPC_DIALOG);

    expect(dialog.npcId).toBe(LAN_NPC_ID);
    expect(dialog.npcName).toBe('Thầy Hiệu Trưởng');
    expect(dialog.lines).toHaveLength(3);
    expect(dialog.lines[0]?.speaker).toBe('Thầy Hiệu Trưởng');
    expect(dialog.lines[0]?.text).toContain('Làng Khởi Nguồn');
  });

  it('NPC không có trong map hiện tại → unknown_entity (không fatal)', async () => {
    const a = await accountWithCharacter(server.app, 'ninja_npc_bad', 'HoiLinhTinh');
    const client = await connect();
    await client.hello({ access: a.access });

    client.send(Opcode.C2S_NPC_TALK, { npcId: 'npc-khong-ton-tai' });
    const error = await client.waitForError();
    expect(error.code).toBe(ErrorCode.UNKNOWN_ENTITY);
    expect(error.fatal).toBe(false);

    // Kết nối vẫn dùng được sau lỗi không fatal.
    client.send(Opcode.C2S_PING, { clientTime: 1234 });
    const pong = await client.waitFor<{ clientTime: number; serverTime: number }>(Opcode.S2C_PONG);
    expect(pong.clientTime).toBe(1234);
    expect(pong.serverTime).toBeGreaterThan(0);
  });
});

describe('chuyển map', () => {
  it('không đứng ở cổng → unknown_map (không fatal)', async () => {
    const a = await accountWithCharacter(server.app, 'ninja_map_bad', 'SaiCong');
    const client = await connect();
    await client.hello({ access: a.access });

    client.send(Opcode.C2S_ENTER_MAP, { mapId: 'bai-luyen-tap' });
    const error = await client.waitForError();
    expect(error.code).toBe(ErrorCode.UNKNOWN_MAP);
    expect(error.fatal).toBe(false);

    client.send(Opcode.C2S_ENTER_MAP, { mapId: 'ban-do-khong-ton-tai' });
    const unknown = await client.waitForError();
    expect(unknown.code).toBe(ErrorCode.UNKNOWN_MAP);
    expect(client.packets(Opcode.S2C_ENTER_MAP)).toHaveLength(1);
  });

  it('đi bộ vào vùng cổng → tự sang bãi luyện tập, người ở lại thấy rời đi', async () => {
    const a = await accountWithCharacter(server.app, 'ninja_map_a', 'KhachDuLich');
    const b = await accountWithCharacter(server.app, 'ninja_map_b', 'NguoiOLai');

    const clientA = await connect();
    await clientA.hello({ access: a.access });
    const clientB = await connect();
    await clientB.hello({ access: b.access });
    await clientA.waitFor<{ entity: Entity }>(
      Opcode.S2C_ENTITY_ADD,
      (raw) => (raw as { entity: Entity }).entity.id === b.characterId,
    );

    // Đi sang phía đông của làng, vào hẳn vùng cổng (ô x 35..37). Không gửi C2S_ENTER_MAP:
    // cổng phải tự kích hoạt.
    const markB = clientB.mark();
    clientA.send(Opcode.C2S_MOVE, LAN_PORTAL_PIXEL);

    const arrived = await clientA.waitFor<ServerEnterMap>(Opcode.S2C_ENTER_MAP, (raw) => {
      return (raw as ServerEnterMap).map.id === 'bai-luyen-tap';
    });

    expect(arrived.map.id).toBe('bai-luyen-tap');
    expect(arrived.entity).toMatchObject({
      id: a.characterId,
      x: TRAINING_SPAWN.x,
      y: TRAINING_SPAWN.y,
    });
    // Người vừa vào không nhận chính mình trong danh sách thực thể.
    expect(arrived.entities.some((entity) => entity.id === a.characterId)).toBe(false);

    // Room cũ nhận ENTITY_REMOVE của người vừa đi, và không thấy thêm thực thể nào.
    const removed = await clientB.waitFor<{ id: string }>(
      Opcode.S2C_ENTITY_REMOVE,
      (raw) => (raw as { id: string }).id === a.characterId,
    );
    expect(removed.id).toBe(a.characterId);
    expect(clientB.since(markB, Opcode.S2C_ENTITY_ADD)).toHaveLength(0);

    // Đi ngược lại vào vùng cổng phía tây của bãi luyện tập → về làng ở điểm spawn mặc định.
    const markBBack = clientB.mark();
    clientA.send(Opcode.C2S_MOVE, TRAINING_PORTAL_PIXEL);

    const back = await clientA.waitFor<ServerEnterMap>(Opcode.S2C_ENTER_MAP, (raw) => {
      return (raw as ServerEnterMap).map.id === START_MAP_ID;
    });
    expect(back.entity).toMatchObject({ x: START_SPAWN.x, y: START_SPAWN.y });

    const addedBack = await clientB.waitFor<{ entity: Entity }>(
      Opcode.S2C_ENTITY_ADD,
      (raw) => (raw as { entity: Entity }).entity.id === a.characterId,
    );
    expect(addedBack.entity).toMatchObject({ x: START_SPAWN.x, y: START_SPAWN.y });
    expect(clientB.since(markBBack, Opcode.S2C_ENTITY_ADD)).toHaveLength(1);
  });

  it('đi trong bãi luyện tập mà không vào cổng thì không đổi bản đồ lần nữa', async () => {
    const a = await accountWithCharacter(server.app, 'ninja_portal_stay', 'DiQuanh');

    const client = await connect();
    await client.hello({ access: a.access });
    client.send(Opcode.C2S_MOVE, LAN_PORTAL_PIXEL);
    await client.waitFor<ServerEnterMap>(Opcode.S2C_ENTER_MAP, (raw) => {
      return (raw as ServerEnterMap).map.id === 'bai-luyen-tap';
    });

    // Đi về phía đông (xa cổng phía tây) rồi đứng yên: không được có S2C_ENTER_MAP nào nữa.
    const mark = client.mark();
    client.send(Opcode.C2S_MOVE, { x: TRAINING_SPAWN.x + 96, y: TRAINING_SPAWN.y });
    await waitForArrival(client, a.characterId, { x: TRAINING_SPAWN.x + 96, y: TRAINING_SPAWN.y });
    await delay(400);

    expect(client.since(mark, Opcode.S2C_ENTER_MAP)).toHaveLength(0);
  });
});

describe('nhịp sống', () => {
  it('C2S_PING → S2C_PONG trả lại clientTime và serverTime', async () => {
    const a = await accountWithCharacter(server.app, 'ninja_ping', 'DoNhip');
    const client = await connect();
    await client.hello({ access: a.access });

    const clientTime = Date.now() - 5;
    client.send(Opcode.C2S_PING, { clientTime });
    const pong = await client.waitFor<{ clientTime: number; serverTime: number }>(Opcode.S2C_PONG);
    expect(pong.clientTime).toBe(clientTime);
    expect(Math.abs(pong.serverTime - Date.now())).toBeLessThan(5000);
  });

  it('gói tin sai định dạng (không phải JSON) → bad_packet, fatal', async () => {
    const client = await connect();
    client.sendRaw('day khong phai json');

    const error = await client.waitForError();
    expect(error.code).toBe(ErrorCode.BAD_PACKET);
    expect(error.fatal).toBe(true);
  });
});

describe('đóng server', () => {
  it('app.close() đóng kết nối WebSocket đang mở và không bị treo', async () => {
    const closingServer = await startTestServer();
    const account = await accountWithCharacter(closingServer.app, 'ninja_close', 'DongServer');
    const client = await TestGameClient.connect(closingServer.wsUrl);

    try {
      await client.hello({ access: account.access });

      await Promise.race([
        closingServer.close(),
        delay(8000).then(() => {
          throw new Error('app.close() không kết thúc khi còn kết nối WebSocket đang mở');
        }),
      ]);

      // Socket phía client phải đóng (server không để kết nối treo).
      const closed = await client.closed;
      expect(typeof closed.code).toBe('number');
    } finally {
      await client.close();
    }
  });
});

describe('giới hạn thời gian (server riêng, thời gian chờ ngắn)', () => {
  let handshakeServer: TestServer;
  let heartbeatServer: TestServer;

  beforeAll(async () => {
    handshakeServer = await startTestServer({
      handshakeTimeoutMs: 300,
      heartbeatTimeoutMs: 10_000,
    });
    heartbeatServer = await startTestServer({ handshakeTimeoutMs: 5000, heartbeatTimeoutMs: 1200 });
  });

  afterAll(async () => {
    await handshakeServer.close();
    await heartbeatServer.close();
  });

  it('không gửi HELLO trong thời gian cho phép → bad_packet, fatal', async () => {
    const client = await TestGameClient.connect(handshakeServer.wsUrl);
    try {
      const error = await client.waitForError(undefined, 4000);
      expect(error.code).toBe(ErrorCode.BAD_PACKET);
      expect(error.fatal).toBe(true);
      expect(error.message).toContain('C2S_HELLO');
      expect((await client.closed).code).toBe(1002);
    } finally {
      await client.close();
    }
  });

  it('không nhận gói nào trong HEARTBEAT_TIMEOUT → server đóng kết nối và dọn khỏi map', async () => {
    const a = await accountWithCharacter(heartbeatServer.app, 'ninja_hb_a', 'ImLang');
    const b = await accountWithCharacter(heartbeatServer.app, 'ninja_hb_b', 'GiuNhip');

    const clientA = await TestGameClient.connect(heartbeatServer.wsUrl);
    const clientB = await TestGameClient.connect(heartbeatServer.wsUrl);
    // B giữ nhịp sống từ đầu để không bị đóng trong lúc chờ A hết hạn heartbeat.
    const keepAlive = setInterval(() => {
      clientB.send(Opcode.C2S_PING, { clientTime: Date.now() });
    }, 150);

    try {
      await clientA.hello({ access: a.access });
      await clientB.hello({ access: b.access });
      await clientA.waitFor<{ entity: Entity }>(
        Opcode.S2C_ENTITY_ADD,
        (raw) => (raw as { entity: Entity }).entity.id === b.characterId,
      );

      const removed = await clientB.waitFor<{ id: string }>(
        Opcode.S2C_ENTITY_REMOVE,
        (raw) => (raw as { id: string }).id === a.characterId,
        8000,
      );
      expect(removed.id).toBe(a.characterId);

      const error: ServerError = await clientA.waitForError();
      expect(error.code).toBe(ErrorCode.BAD_PACKET);
      expect(error.fatal).toBe(true);
      expect((await clientA.closed).code).toBe(1001);
    } finally {
      clearInterval(keepAlive);
      await clientA.close();
      await clientB.close();
    }
  });
});
