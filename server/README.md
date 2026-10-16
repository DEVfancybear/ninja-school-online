# server/ — Game server

**Trạng thái:** M0 (khung) + M1 (tài khoản & nhân vật) + M2 (thế giới, di chuyển, chat) + **M3 (chiến đấu theo lượt, quái, túi đồ, chỉ số nhân vật)** đã xong.

## Vai trò
Là **nguồn sự thật** của toàn bộ trò chơi: tài khoản, nhân vật, bản đồ, chiến đấu theo lượt, vật phẩm, nhiệm vụ, bang hội, xếp hạng, sự kiện.
Mọi hành động của người chơi đều được server kiểm tra hợp lệ trước khi áp dụng.

## Đã có

### HTTP API (đều nằm dưới `/api`)

| Method | Đường dẫn | Cần đăng nhập | Mô tả |
|---|---|---|---|
| GET | `/health` | không | Trạng thái server + kết nối database |
| GET | `/version` | không | Phiên bản protocol (client kiểm tra tương thích) |
| POST | `/api/auth/register` | không | Đăng ký tài khoản, trả phiên đăng nhập (201) |
| POST | `/api/auth/login` | không | Đăng nhập, trả phiên mới (200) |
| POST | `/api/auth/refresh` | không | Xoay refresh token, cấp access token mới |
| POST | `/api/auth/logout` | không | Thu hồi refresh token (204) |
| GET | `/api/auth/me` | có | Thông tin tài khoản đang đăng nhập |
| GET | `/api/characters` | có | Danh sách nhân vật của tài khoản |
| POST | `/api/characters` | có | Tạo nhân vật (201) |

- Xác thực: `Authorization: Bearer <accessToken>`. Access token là JWT (mặc định 15 phút), refresh token là chuỗi ngẫu nhiên 32 byte lưu **dạng băm SHA-256** trong database và **xoay mỗi lần dùng**.
- **Giới hạn đã biết:** access token là JWT **không trạng thái**, nên token cấp trước khi đăng xuất vẫn dùng được cho
  tới khi hết hạn (mặc định 15 phút), dù refresh token đã bị thu hồi. Mọi thao tác nhạy cảm ở các cột mốc sau
  (giao dịch, đổi mật khẩu) nên kiểm thêm trạng thái phiên trong database nếu cần chặn tuyệt đối.
- Lỗi trả về thống nhất: `{ "error": "<mã>", "message": "<mô tả tiếng Việt>" }` với mã `validation_error` (400), `unauthorized` (401), `not_found` (404), `conflict` (409), `internal_error` (500).
- Dữ liệu vào được kiểm bằng schema zod trong `@ninja/shared` — cùng bộ schema mà client dùng, nên hai bên không lệch quy tắc.

### WebSocket realtime (`/ws`)

Gateway nằm ở `net/`, gắn vào **cùng cổng HTTP** của Fastify (`new WebSocketServer({ noServer: true })` +
sự kiện `upgrade`), đường dẫn `/ws` (đường dẫn khác bị trả 404 rồi đóng socket). Mọi khung đều là
**text JSON** đúng khung của `@ninja/shared` (`{"op": <số>, "seq": <số>, "payload": {...}}`) qua
`encodePacket` / `decodeEnvelope` — server không tự đóng/mở khung riêng.

#### Bắt tay

| Bước | Gói tin | Nội dung |
|---|---|---|
| 1 | `C2S_HELLO` | `{token, protocolVersion, clientVersion?, characterId?}` — gói **đầu tiên bắt buộc**, phải tới trong 10 giây |
| 2 | `S2C_HELLO` | `{protocolVersion, tickRateMs, characterId, characterName, mapId, serverTime}` |
| 3 | `S2C_ENTER_MAP` | `{map, entity, entities, chatBacklog}`: `map` là bản đồ đầy đủ để vẽ, `entity` là chính mình, `entities` là mọi thực thể **khác** |

- Chọn nhân vật: có `characterId` thì phải **thuộc tài khoản** (sai → `bad_packet`); bỏ trống → nhân vật **tạo gần nhất**.
- Lỗi bắt tay đều `fatal: true`: server gửi `S2C_ERROR` rồi đóng kết nối (mã WebSocket 1002).

| Mã | Khi nào |
|---|---|
| `unauthorized` | token sai chữ ký hoặc đã hết hạn |
| `protocol_mismatch` | `protocolVersion` khác `PROTOCOL_VERSION` |
| `no_character` | tài khoản chưa có nhân vật — thông báo hướng sang trang tạo nhân vật |
| `bad_packet` | khung JSON sai, gói đầu tiên không phải `C2S_HELLO`, `characterId` không thuộc tài khoản, hoặc không bắt tay kịp 10 giây |
| `internal_error` | bản đồ khởi đầu thiếu điểm spawn (lỗi dữ liệu nội dung) |

#### Gói tin trong game (M2 + M3)

| Opcode | Hướng | Nội dung | Xử lý của server |
|---|---|---|---|
| `C2S_MOVE` | C→S | `{x, y}` — điểm đích tính bằng pixel | Kiểm khoảng cách/biên/ô bị chặn rồi đi dần mỗi tick |
| `S2C_ENTITY_MOVE` | S→C | `{moves: [{id, x, y, facing}]}` | **Một** gói mỗi tick cho cả room, chỉ gồm thực thể đã đổi vị trí (kể cả người vừa di chuyển) |
| `C2S_ENTER_MAP` | C→S | `{mapId, spawnId?}` | Đường chủ động (xem mục cổng bên dưới): chỉ nhận khi đang đứng trong vùng cổng dẫn tới map đó; `spawnId` client gửi **bị bỏ qua** |
| `C2S_CHAT` | C→S | `{channel: 'map', text}` | Tối đa 200 ký tự, giãn cách 1 giây mỗi người |
| `S2C_CHAT` | S→C | `{channel, fromId, fromName, text, at}` | Phát cho cả room, `at` = ms epoch của server |
| `C2S_NPC_TALK` | C→S | `{npcId}` | NPC phải có trong bản đồ hiện tại |
| `S2C_NPC_DIALOG` | S→C | `{npcId, npcName, lines}` | Toàn bộ lời thoại trong `game-data/npcs/` |
| `C2S_PING` / `S2C_PONG` | 2 chiều | `{clientTime}` / `{clientTime, serverTime}` | Trả lại `clientTime` để client đo độ trễ |
| `S2C_ENTITY_ADD` / `S2C_ENTITY_REMOVE` | S→C | `{entity}` / `{id}` | Người vào/ra map; người mới **không** nhận `ADD` của chính mình |
| `S2C_ERROR` | S→C | `{code, message, fatal}` | `fatal: false` thì kết nối vẫn dùng tiếp bình thường |
| `S2C_NOTIFY` | S→C | `{message}` | Phiên bị đẩy ra khi cùng nhân vật đăng nhập ở nơi khác |
| `C2S_ATTACK_MOB` | C→S | `{targetId}` | Quái phải còn sống, cách ≤ 96 px, người chơi chưa ở trận khác; quái đã có trận thì vào chung (tối đa 2 người) |
| `S2C_BATTLE_START` | S→C | `{battleId, roundNo, participants, actorId, turnMs, turnEndsAt}` | Mở trận, hoặc phát lại cho **mọi người** khi có người vào chung |
| `S2C_BATTLE_TURN` | S→C | `{battleId, roundNo, actorId, turnMs, turnEndsAt}` | Đổi lượt; lượt người chơi 30 giây, lượt quái ra đòn sau 800 ms |
| `C2S_BATTLE_ACTION` | C→S | `{battleId, action: 'attack'\|'skill'\|'item'\|'flee', skillId?, itemId?, targetId?}` | Kiểm đúng lượt, chiêu đã học, hồi chiêu, nội lực, quyền sở hữu vật phẩm |
| `S2C_BATTLE_RESULT` | S→C | `{battleId, roundNo, actorId, action, events, participants}` | Nhật ký từng đòn (câu tiếng Việt) + trạng thái mới của mọi người |
| `S2C_BATTLE_END` | S→C | `{battleId, outcome, monsterName, rewards, participants}` | `rewards` là **phần thưởng riêng của người nhận** (`null` khi thua/chạy thoát) |
| `C2S_USE_ITEM` | C→S | `{itemId}` | Ngoài trận; trong trận phải dùng qua `C2S_BATTLE_ACTION` để mất một lượt |
| `S2C_INVENTORY_UPDATE` | S→C | `{items, capacity}` | Gửi **cả túi** sau mỗi thay đổi (sau bắt tay, khi dùng vật phẩm, khi nhặt đồ) |
| `S2C_CHARACTER` | S→C | `{id, name, school, class, level, exp, expToNext, yen, hp, maxHp, mp, maxMp, strength…speed, skills}` | Gửi ngay sau `S2C_ENTER_MAP` và mỗi lần chỉ số đổi |
| `S2C_LEVEL_UP` | S→C | `{character, levelsGained, learnedSkills}` | Kèm chiêu vừa học được ở cấp mới |

Lỗi **không** fatal khi đang chơi: `bad_packet` (lệnh `C2S_MOVE` sai, gói tin sai định dạng),
`rate_limited` (chat quá nhanh **hoặc** quá dài), `unknown_map` (không đứng ở cổng),
`unknown_entity` (NPC không có trong map).

Lỗi chiến đấu (M3) — mỗi nguyên nhân một mã riêng để client nói đúng lý do:
`in_battle` (đang trong trận / di chuyển khi đang đánh), `battle_not_found` (trận đã kết thúc),
`not_your_turn`, `out_of_range` (quá 96 px), `monster_gone` (quái không có ở đây hoặc đã bị hạ),
`skill_not_known`, `skill_cooldown`, `not_enough_mp`, `item_not_owned`, `item_not_usable`,
`item_no_effect` (chỉ số đang đầy), `invalid_target` (trận đã đủ người).

#### Vòng lặp tick

- **Một** `setInterval(TICK_RATE_MS)` duy nhất (100 ms = 10 Hz) ở `core/tick.ts`; `core/room-manager.ts`
  dùng nhịp đó để tick mọi room, `net/` dùng để quét heartbeat — không nơi nào tự mở interval riêng.
- **Room = một bản đồ** (M2 chưa chia kênh). Room tạo khi có người đầu tiên vào, **xoá khi rỗng**
  (lịch sử chat gần nhất của room đó mất theo), NPC của map được dựng sẵn trong room.
- Mỗi tick, người chơi đang đi tiến `PLAYER_SPEED_PX_PER_SEC × 0,1 s = 16 px` về đích; tới nơi khi sai số
  < 0,5 px thì đặt **đúng** toạ độ đích. Cả room nhận một `S2C_ENTITY_MOVE` gộp.
- Quy ước toạ độ (client vẽ theo đúng quy ước này): pixel liên tục, gốc (0,0) ở góc trên-trái, trục y
  hướng xuống; điểm spawn và NPC đặt sẵn nằm ở **tâm ô** (`ô × tileSize + tileSize/2`); vùng cổng là
  `[x×tileSize, (x+width)×tileSize)` × `[y×tileSize, (y+height)×tileSize)`.
- `app.close()` đóng sạch: gỡ listener `upgrade`, đóng socket, dọn thực thể khỏi room, dừng interval.
  `main.ts` bắt SIGINT/SIGTERM nên Ctrl+C cũng thoát êm (game-data sai thì thoát với mã 1 kèm danh sách lỗi).

#### Cổng dịch chuyển

- **Cổng tự kích hoạt khi đi bộ**: mỗi nhịp tick, sau khi đẩy người chơi đi, server kiểm vùng cổng
  tại vị trí mới; vào vùng cổng dẫn sang bản đồ khác thì chuyển map **ngay**, không cần client xin
  phép. Nhờ vậy cổng là một phần của bản đồ, không phải một hành động phải gửi gói tin — và client
  **không** cần biết vùng cổng nằm ở đâu.
- Đứng yên trong vùng cổng thì không có gì xảy ra (cổng chỉ kích hoạt khi **bước vào**), và cổng
  dẫn về chính bản đồ đang đứng cũng bị bỏ qua — nên không có vòng lặp chuyển qua chuyển lại.
- Cả hai lối vào (đi bộ và `C2S_ENTER_MAP`) dùng **chung một hàm chuyển map** trong `WorldService`:
  gỡ khỏi room cũ + `S2C_ENTITY_REMOVE` cho người ở lại, đặt vị trí về `portals[].toSpawn`, gửi
  `S2C_ENTER_MAP` cho người đi, `S2C_ENTITY_ADD` cho room mới. Room rỗng bị xoá như mọi khi.
- `C2S_ENTER_MAP` vẫn giữ nguyên luật cũ (phải đang đứng trong vùng cổng). Từ khi cổng tự kích hoạt,
  đường này để dành cho tính năng sau (dịch chuyển, cắt cảnh) và cho client công cụ.

#### Chống gian lận đã cài (M2)

| Quy tắc | Cách làm |
|---|---|
| Không dịch chuyển tức thời | khoảng cách tới điểm đích ≤ `MAX_MOVE_DISTANCE_PX` (600 px) |
| Không đi ra ngoài bản đồ | điểm đích phải nằm trong `[0, width×tileSize) × [0, height×tileSize)` |
| Không đi xuyên vật cản | ô chứa điểm đích không được `blocked` (xét cả lớp ground và decor) |
| Vị trí chỉ do server quyết định | client chỉ gửi điểm đích; mọi toạ độ phát đi đều do server tính |
| Không nhảy map tuỳ ý | Chỉ chuyển map khi vị trí do server tính nằm trong vùng cổng (hoặc `C2S_ENTER_MAP` đúng luật); điểm đến lấy từ `portals[].toSpawn` |
| Chống spam chat | 1 tin/giây/người (`CHAT_MIN_INTERVAL_MS`), tối đa `CHAT_MAX_LENGTH` (200) ký tự |
| Chống treo tài khoản | một nhân vật một kết nối: kết nối mới đẩy phiên cũ ra (`S2C_NOTIFY` + đóng mã 4000) |
| Không giữ kết nối chết | không có gói tin nào trong `HEARTBEAT_TIMEOUT_MS` (30 giây) → báo lỗi rồi đóng, dọn khỏi map |

#### Giới hạn đã biết (M2)

- **Chưa lưu vị trí vào database**: mỗi lần kết nối đều vào bản đồ khởi đầu `lang-khoi-nguon` tại điểm
  spawn `default`; `characters.map_id/x/y` chưa được ghi (chiến lược flush ở mục 6.3 của
  `docs/02-architecture/network-and-data.md` sẽ áp dụng từ M3).
- Chat chỉ có kênh `map`; chưa có thế giới/nhóm/riêng, chưa lọc từ xấu.
- Room chưa chia kênh, chưa có Redis/pub-sub → chỉ chạy được một tiến trình server.
- Di chuyển chỉ kiểm **ô đích**, không kiểm đường đi (client tự vẽ đường), chưa có va chạm giữa người chơi.
- Chưa đếm số gói tin sai để "ngắt kết nối tạm thời" (mục 5 trong `network-and-data.md`).
- Hết hạn heartbeat dùng mã `bad_packet` vì `ErrorCode` trong `shared` chưa có mã riêng cho việc này.
- NPC chỉ có hội thoại tĩnh một bước (chưa nhiệm vụ/shop).
- Access token cho WebSocket dùng cùng JWT **không trạng thái** như HTTP.
- `S2C_ENTITY_MOVE` gửi hướng của bước đi vừa rồi (8 hướng); thực thể đứng yên không nằm trong gói nên
  `facing: 'none'` hiện chưa xuất hiện trên đường truyền.

#### Kiểm thử WebSocket

`server/src/net/ws.spec.ts` (28 test) chạy server thật trên **cổng 0** và nói chuyện bằng client `ws`,
gồm: sai phiên bản/ token rác/ tài khoản không nhân vật, bắt tay hợp lệ, hai client thấy nhau, đồng bộ
di chuyển (B nhận bước của A, sai số cuối ≤ 2 px), chặn di chuyển sai (quá xa/biên/ô chặn), chat +
giới hạn tần suất, ngắt kết nối → `ENTITY_REMOVE`, NPC (3 dòng và NPC lạ), chuyển map (đi bộ vào vùng
cổng tự sang bản đồ bên kia rồi quay lại; đi trong map mới mà không vào cổng thì không đổi map nữa;
gói `C2S_ENTER_MAP` sai chỗ bị từ chối), `PING`/`PONG`, bắt tay quá hạn, heartbeat quá hạn, đẩy phiên
cũ khi cùng nhân vật đăng nhập lại. Tiện ích dùng chung:
`server/src/test/game-server.ts` (server + tài khoản/nhân vật qua REST) và `server/src/test/ws-client.ts`.

### Lớp nghiệp vụ

```text
server/src/
├── main.ts              # khởi động: nạp .env, mở pool, dựng app, bắt SIGINT/SIGTERM để đóng sạch
├── app.ts               # dựng Fastify: cors, jwt, route, xử lý lỗi thống nhất
├── config/
│   ├── env.ts           # đọc/kiểm tra biến môi trường (zod)
│   └── dotenv.ts        # nạp .env ở gốc repo bằng process.loadEnvFile (không cần thư viện ngoài)
├── db/
│   ├── schema.ts        # bảng accounts, characters, refresh_tokens + ràng buộc
│   ├── client.ts        # pool PostgreSQL + Drizzle
│   ├── migrate.ts       # chạy migration (CLI: `pnpm db:migrate`)
│   └── ../drizzle/      # file SQL migration do drizzle-kit sinh ra
├── net/                 # WebSocket (M2): gateway /ws, phiên, hàng đợi gói tin, heartbeat
├── core/                # (M2) tick.ts — MỘT interval dùng chung; room-manager.ts — room theo map
├── world/               # (M2) game-data.ts (nạp + kiểm dữ liệu), map.ts, movement.ts, room.ts, world-service.ts
├── battle/              # (M3) engine.ts (công thức thuần) + service.ts (luồng trận theo lượt)
├── modules/
│   ├── account/         # service (đăng ký/đăng nhập/làm mới/đăng xuất) + route
│   ├── character/       # service (tạo/liệt kê, giới hạn, chống trùng tên) + stats.ts (chỉ số theo cấp) + route
│   ├── chat/            # (M2) giới hạn tần suất + tạo tin nhắn kênh map
│   ├── inventory/       # (M3) túi đồ: cất/lấy theo số lượng, sức chứa theo số loại
│   └── npc/             # (M2) hội thoại NPC theo game-data
├── http/                # parseRequest (kiểm dữ liệu vào) + authenticate (preHandler)
├── security/
│   ├── password.ts      # Argon2id (mặc định của @node-rs/argon2: m=19456, t=2, p=1)
│   └── tokens.ts        # cấp/xoay/thu hồi refresh token
└── test/                # globalSetup + database kiểm thử + server thật trên cổng 0 + client WebSocket
```

### Quy tắc nghiệp vụ đã cài đặt

- Tên đăng nhập: 4–20 ký tự, chỉ chữ thường, chữ số, gạch dưới; **không phân biệt hoa thường** khi kiểm trùng (unique index trên `lower(username)`).
- Mật khẩu: 8–72 ký tự, băm Argon2id; không bao giờ trả hash ra ngoài.
- Sai mật khẩu và tài khoản không tồn tại trả **cùng một thông báo** (tránh dò tài khoản); khi tài khoản không tồn tại vẫn băm mật khẩu để thời gian phản hồi tương đương.
- Tên nhân vật: 3–12 ký tự chữ/số (cho phép tiếng Việt có dấu), duy nhất toàn máy chủ, không phân biệt hoa thường.
- Phái phải thuộc trường đã chọn (kiểm ở cả `shared` schema và ràng buộc CHECK trong database).
- Tối đa 4 nhân vật mỗi tài khoản (`MAX_CHARACTERS_PER_ACCOUNT` trong `shared`).
- Chỉ số nhân vật **suy từ** `game-data/classes/`: `tấn công = 2 × sức mạnh + cấp`, `phòng thủ = nhanh nhẹn / 2`,
  `tốc độ = nhanh nhẹn + cấp`; máu/nội lực tối đa lấy từ hệ số phái theo cấp.
- Tạo nhân vật thì nhận luôn yên và đồ khởi đầu của phái (`startingYen`, `startingItems`).
- Trong trận: sát thương do server tính, hồi chiêu quy ra **vòng** (`ceil(cooldownMs / 30 giây)`), và mọi thay
  đổi (máu, nội lực, cấp, kinh nghiệm, yên, túi đồ) chỉ ghi database **khi trận kết thúc**.

## Lệnh

```bash
# Từ gốc repo (khuyến nghị — các lệnh này tự build @ninja/shared trước):
pnpm db:migrate        # chạy migration lên DATABASE_URL
pnpm db:generate       # sinh migration mới sau khi sửa db/schema.ts
pnpm dev               # chạy client + server song song
pnpm test              # vitest (server cần PostgreSQL qua TEST_DATABASE_URL)

# Trong gói server (phải chạy `pnpm build:shared` một lần trước đó):
pnpm --filter @ninja/server dev
pnpm --filter @ninja/server test
pnpm --filter @ninja/server build && pnpm --filter @ninja/server start
```

> `@ninja/shared` là thư viện đã build (`dist/` cho ESM, `dist-cjs/` cho công cụ CJS), không trỏ thẳng
> vào file nguồn. Từ máy sạch, `pnpm install` chạy script `prepare` của gói này nên `dist` đã sẵn có;
> chỉ khi sửa nguồn `shared` mới cần build lại (`pnpm build:shared`).

## Chưa làm (các cột mốc sau)

- Module còn lại: `quest`, `social`, `guild`, `arena`, `event`, `mail`, `admin`; trang bị & cường hóa (M4),
  nhiệm vụ (M5).
- Chiến đấu: trận nhiều quái (1–3 như thiết kế), hiệu ứng phụ của chiêu (độc/choáng/hồi máu), và việc lưu
  trạng thái trận xuống database khi chạy nhiều tiến trình.
- Lưu vị trí nhân vật vào database, chia kênh theo map, pub/sub qua Redis (nhiều tiến trình).
- Giới hạn tần suất chung cho mọi gói tin, khoá tài khoản sau nhiều lần sai, audit log.

## Nguyên tắc
1. Không tin client: kiểm tra vị trí, tốc độ, hồi chiêu, quyền sở hữu vật phẩm trước khi áp dụng.
2. Nghiệp vụ game nằm ở server; `shared/` chỉ chứa protocol/kiểu dữ liệu/hằng số.
3. Lưu dữ liệu theo lô (dirty flags + flush định kỳ), giao dịch (trade) dùng transaction.
4. Mọi thay đổi dữ liệu quan trọng ghi audit log.
