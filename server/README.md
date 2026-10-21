# server/ — Game server

**Trạng thái:** Đã triển khai M0–M6 (M6 kết thúc Alpha). Kết quả CI và kiểm chứng độc lập được theo dõi cùng roadmap. Server có tài khoản/nhân vật, thế giới, PvE, trang bị/shop/cường hóa, nhiệm vụ, bạn bè/tổ đội/chat theo kênh, Lôi Đài/Elo, bảng xếp hạng và thư hệ thống.

## Vai trò

Là **nguồn sự thật** của toàn bộ trò chơi: tài khoản, nhân vật, bản đồ, chiến đấu theo lượt, vật phẩm, nhiệm vụ, bang hội, xếp hạng, sự kiện.
Mọi hành động của người chơi đều được server kiểm tra hợp lệ trước khi áp dụng.

## Đã có

### HTTP API (đều nằm dưới `/api`)

| Method | Đường dẫn            | Cần đăng nhập | Mô tả                                            |
| ------ | -------------------- | ------------- | ------------------------------------------------ |
| GET    | `/health`            | không         | Trạng thái server + kết nối database             |
| GET    | `/version`           | không         | Phiên bản protocol (client kiểm tra tương thích) |
| POST   | `/api/auth/register` | không         | Đăng ký tài khoản, trả phiên đăng nhập (201)     |
| POST   | `/api/auth/login`    | không         | Đăng nhập, trả phiên mới (200)                   |
| POST   | `/api/auth/refresh`  | không         | Xoay refresh token, cấp access token mới         |
| POST   | `/api/auth/logout`   | không         | Thu hồi refresh token (204)                      |
| GET    | `/api/auth/me`       | có            | Thông tin tài khoản đang đăng nhập               |
| GET    | `/api/characters`    | có            | Danh sách nhân vật của tài khoản                 |
| POST   | `/api/characters`    | có            | Tạo nhân vật (201)                               |

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

| Bước | Gói tin         | Nội dung                                                                                                                          |
| ---- | --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `C2S_HELLO`     | `{token, protocolVersion, clientVersion?, characterId?}` — gói **đầu tiên bắt buộc**, phải tới trong 10 giây                      |
| 2    | `S2C_HELLO`     | `{protocolVersion, tickRateMs, characterId, characterName, mapId, serverTime}`                                                    |
| 3    | `S2C_ENTER_MAP` | `{map, entity, entities, chatBacklog}`: `map` là bản đồ đầy đủ để vẽ, `entity` là chính mình, `entities` là mọi thực thể **khác** |

- Chọn nhân vật: có `characterId` thì phải **thuộc tài khoản** (sai → `bad_packet`); bỏ trống → nhân vật **tạo gần nhất**.
- Lỗi bắt tay đều `fatal: true`: server gửi `S2C_ERROR` rồi đóng kết nối (mã WebSocket 1002).

| Mã                  | Khi nào                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `unauthorized`      | token sai chữ ký hoặc đã hết hạn                                                                                         |
| `protocol_mismatch` | `protocolVersion` khác `PROTOCOL_VERSION`                                                                                |
| `no_character`      | tài khoản chưa có nhân vật — thông báo hướng sang trang tạo nhân vật                                                     |
| `bad_packet`        | khung JSON sai, gói đầu tiên không phải `C2S_HELLO`, `characterId` không thuộc tài khoản, hoặc không bắt tay kịp 10 giây |
| `internal_error`    | lỗi dữ liệu nội dung hoặc không tạo được trận Arena (trạng thái queue được giữ để thử lại)                                |

#### Gói tin trong game (M2–M6)

| Opcode                                                       | Hướng   | Nội dung                                                                                                               | Xử lý của server                                                                                                                  |
| ------------------------------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `C2S_MOVE`                                                   | C→S     | `{x, y}` — điểm đích tính bằng pixel                                                                                   | Kiểm khoảng cách/biên/ô bị chặn rồi đi dần mỗi tick                                                                               |
| `S2C_ENTITY_MOVE`                                            | S→C     | `{moves: [{id, x, y, facing}]}`                                                                                        | **Một** gói mỗi tick cho cả room, chỉ gồm thực thể đã đổi vị trí (kể cả người vừa di chuyển)                                      |
| `C2S_ENTER_MAP`                                              | C→S     | `{mapId, spawnId?}`                                                                                                    | Đường chủ động (xem mục cổng bên dưới): chỉ nhận khi đang đứng trong vùng cổng dẫn tới map đó; `spawnId` client gửi **bị bỏ qua** |
| `C2S_CHAT`                                                   | C→S     | `{channel?: 'map'\|'world'\|'party'\|'private', text, to?}`                                                            | Thiếu `channel` = `map`; tối đa 200 ký tự; cooldown 1 giây, riêng `world` là 5 giây                                               |
| `S2C_CHAT`                                                   | S→C     | `{channel, fromId, fromName, text, at, toName?}`                                                                       | Phát theo kênh; tin riêng chỉ gửi hai bên; `at` = ms epoch của server                                                             |
| `C2S_NPC_TALK`                                               | C→S     | `{npcId}`                                                                                                              | NPC phải có trong bản đồ hiện tại                                                                                                 |
| `S2C_NPC_DIALOG`                                             | S→C     | `{npcId, npcName, lines}`                                                                                              | Toàn bộ lời thoại trong `game-data/npcs/`                                                                                         |
| `C2S_PING` / `S2C_PONG`                                      | 2 chiều | `{clientTime}` / `{clientTime, serverTime}`                                                                            | Trả lại `clientTime` để client đo độ trễ                                                                                          |
| `S2C_ENTITY_ADD` / `S2C_ENTITY_REMOVE`                       | S→C     | `{entity}` / `{id}`                                                                                                    | Người vào/ra map; người mới **không** nhận `ADD` của chính mình                                                                   |
| `S2C_ERROR`                                                  | S→C     | `{code, message, fatal}`                                                                                               | `fatal: false` thì kết nối vẫn dùng tiếp bình thường                                                                              |
| `S2C_NOTIFY`                                                 | S→C     | `{message}`                                                                                                            | Phiên bị đẩy ra khi cùng nhân vật đăng nhập ở nơi khác                                                                            |
| `C2S_ATTACK_MOB`                                             | C→S     | `{targetId}`                                                                                                           | Quái phải còn sống, cách ≤ 96 px, người chơi chưa ở trận khác; quái đã có trận thì vào chung (tối đa 2 người)                     |
| `S2C_BATTLE_START`                                           | S→C     | `{battleId, roundNo, participants, actorId, turnMs, turnEndsAt, mode?}`                                                       | Mở trận, hoặc phát lại cho **mọi người** khi có người vào chung                                                                   |
| `S2C_BATTLE_TURN`                                            | S→C     | `{battleId, roundNo, actorId, turnMs, turnEndsAt}`                                                                     | Đổi lượt; lượt người chơi 30 giây, lượt quái ra đòn sau 800 ms                                                                    |
| `C2S_BATTLE_ACTION`                                          | C→S     | `{battleId, action: 'attack'\|'skill'\|'item'\|'flee', skillId?, itemId?, targetId?}`                                  | Kiểm đúng lượt, chiêu đã học, hồi chiêu, nội lực, quyền sở hữu vật phẩm                                                           |
| `S2C_BATTLE_RESULT`                                          | S→C     | `{battleId, roundNo, actorId, action, events, participants}`                                                           | Nhật ký từng đòn (câu tiếng Việt) + trạng thái mới của mọi người                                                                  |
| `S2C_BATTLE_END`                                             | S→C     | `{battleId, outcome, monsterName, rewards, participants}`                                                              | `rewards` là **phần thưởng riêng của người nhận** (`null` khi thua/chạy thoát)                                                    |
| `C2S_USE_ITEM`                                               | C→S     | `{itemId}`                                                                                                             | Ngoài trận; trong trận phải dùng qua `C2S_BATTLE_ACTION` để mất một lượt                                                          |
| `S2C_INVENTORY_UPDATE`                                       | S→C     | `{items, capacity}`                                                                                                    | Gửi **cả túi** sau mỗi thay đổi (sau bắt tay, khi dùng vật phẩm, khi nhặt đồ)                                                     |
| `S2C_CHARACTER`                                              | S→C     | `{id, name, school, class, level, exp, expToNext, yen, hp, maxHp, mp, maxMp, strength…speed, skills}`                  | Gửi ngay sau `S2C_ENTER_MAP` và mỗi lần chỉ số đổi                                                                                |
| `S2C_LEVEL_UP`                                               | S→C     | `{character, levelsGained, learnedSkills}`                                                                             | Kèm chiêu vừa học được ở cấp mới                                                                                                  |
| `C2S_FRIEND_REQUEST` / `C2S_FRIEND_ACCEPT` / `C2S_FRIEND_DECLINE` / `C2S_FRIEND_REMOVE` | C→S     | `{name}`                                                                                                               | Bạn bè theo tên; gửi lời mời ngược chiều sẽ chấp nhận hàng đang chờ, không tạo hàng trùng                                         |
| `S2C_SOCIAL_UPDATE`                                          | S→C     | `{friends, incoming, outgoing, maxFriends}`                                                                            | Trạng thái bạn bè và lời mời, kèm online/cấp/trường/phái                                                                          |
| `C2S_PARTY_INVITE` / `C2S_PARTY_ACCEPT` / `C2S_PARTY_DECLINE` / `C2S_PARTY_LEAVE` / `C2S_PARTY_KICK` | C→S     | Theo hành động; mời/đồng ý dùng tên đội trưởng hoặc thành viên                                                         | Tổ đội tối đa `PARTY_MAX_MEMBERS` thành viên                                                                                      |
| `S2C_PARTY_UPDATE`                                           | S→C     | `{partyId, leaderId, members, invites}`                                                                                | Đồng bộ cả đội và lời mời cho người liên quan                                                                                     |
| `S2C_MAILS` / `C2S_MAIL_CLAIM`                               | 2 chiều | Danh sách thư / `{mailId}`                                                                                             | Claim quà một lần trong transaction; túi đầy trả `inventory_full`, thư còn để nhận lại                                            |
| `C2S_ARENA_QUEUE` / `C2S_ARENA_CANCEL`                       | C→S     | `{}`                                                                                                                   | Xếp hàng/rời hàng; yêu cầu cấp ≥ `ARENA_MIN_LEVEL`, không thể đồng thời PvE                                                       |
| `S2C_ARENA_STATE`                                            | S→C     | `{queued, queueSize, rating, wins, losses}`                                                                            | Trạng thái hàng chờ và điểm của người nhận                                                                                        |
| `C2S_BATTLE_ACTION` / `S2C_BATTLE_START` / `TURN` / `RESULT` | 2 chiều | Khung trận dùng chung PvE/PvP; `mode: 'arena'`                                                                         | PvP cấm chạy và dùng vật phẩm; server định đoạt sát thương/thứ tự lượt                                                            |
| `S2C_ARENA_END`                                              | S→C     | `{battleId, outcome, reason, ratingBefore, ratingAfter, ratingDelta, opponentName, opponentRatingAfter, wins, losses}` | Elo và hai kết quả được ghi atomically trước khi báo kết trận                                                                     |
| `C2S_LEADERBOARD` / `S2C_LEADERBOARD`                        | 2 chiều | `{board: 'level'\|'arena'}` / `{board, entries}`                                                                       | Bảng cấp độ hoặc Arena, tối đa `LEADERBOARD_PAGE_SIZE` dòng                                                                       |

Lỗi **không** fatal khi đang chơi: `bad_packet` (gói sai định dạng), `rate_limited` (chat quá nhanh/quá dài),
`unknown_map` (không đứng ở cổng), `unknown_entity` (NPC không có trong map). Luật chat: map/party/private
cùng dùng `CHAT_MIN_INTERVAL_MS` (1 giây); world dùng `WORLD_CHAT_MIN_INTERVAL_MS` (5 giây).

Lỗi chiến đấu PvE (M3): `in_battle`, `battle_not_found`, `not_your_turn`, `out_of_range`, `monster_gone`,
`skill_not_known`, `skill_cooldown`, `not_enough_mp`, `item_not_owned`, `item_not_usable`, `item_no_effect`, `invalid_target`.
Arena (M6): `arena_level_low`, `arena_not_queued`, `arena_queued`, `arena_no_flee`; nếu không tạo được trận,
`internal_error` được gửi và người chơi chưa bị hủy khỏi hàng chờ. Lỗi bạn bè/tổ đội/thư gồm `character_not_found`,
`friend_self`, `friend_already`, `friend_not_found`, `friends_full`, `party_self`, `party_full`, `party_not_leader`,
`party_already_member`, `party_not_invited`, `not_in_party`, `mail_not_found`, `mail_claimed`, `inventory_full`.

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

| Quy tắc                         | Cách làm                                                                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Không dịch chuyển tức thời      | khoảng cách tới điểm đích ≤ `MAX_MOVE_DISTANCE_PX` (600 px)                                                                        |
| Không đi ra ngoài bản đồ        | điểm đích phải nằm trong `[0, width×tileSize) × [0, height×tileSize)`                                                              |
| Không đi xuyên vật cản          | ô chứa điểm đích không được `blocked` (xét cả lớp ground và decor)                                                                 |
| Vị trí chỉ do server quyết định | client chỉ gửi điểm đích; mọi toạ độ phát đi đều do server tính                                                                    |
| Không nhảy map tuỳ ý            | Chỉ chuyển map khi vị trí do server tính nằm trong vùng cổng (hoặc `C2S_ENTER_MAP` đúng luật); điểm đến lấy từ `portals[].toSpawn` |
| Chống spam chat                 | Map/tổ đội/riêng: 1 tin/giây; thế giới: 1 tin/5 giây; tối đa `CHAT_MAX_LENGTH` (200) ký tự                                         |
| Chống treo tài khoản            | một nhân vật một kết nối: kết nối mới đẩy phiên cũ ra (`S2C_NOTIFY` + đóng mã 4000)                                                |
| Không giữ kết nối chết          | không có gói tin nào trong `HEARTBEAT_TIMEOUT_MS` (30 giây) → báo lỗi rồi đóng, dọn khỏi map                                       |

#### Giới hạn đã biết (M2)

- **Chưa lưu vị trí vào database**: mỗi lần kết nối đều vào bản đồ khởi đầu `lang-khoi-nguon` tại điểm
  spawn `default`; `characters.map_id/x/y` chưa được ghi (chiến lược flush ở mục 6.3 của
  `docs/02-architecture/network-and-data.md` sẽ áp dụng từ M3).
- Chat chưa lọc từ xấu. Kênh map/thế giới/tổ đội/riêng đã có ở M6; thế giới dùng cooldown 5 giây, các kênh còn lại 1 giây.
- Room là một map (không chia instance/kênh), chat thế giới chỉ phát trong tiến trình hiện tại và chưa có Redis/pub-sub → chỉ chạy được một tiến trình server.
- Di chuyển chỉ kiểm **ô đích**, không kiểm đường đi (client tự vẽ đường), chưa có va chạm giữa người chơi.
- Chưa đếm số gói tin sai để "ngắt kết nối tạm thời" (mục 5 trong `network-and-data.md`).
- Hết hạn heartbeat dùng mã `bad_packet` vì `ErrorCode` trong `shared` chưa có mã riêng cho việc này.
- Tổ đội, hàng chờ và trận Arena đang chạy chỉ lưu trong bộ nhớ tiến trình; khởi động lại server sẽ xóa đội/hàng chờ/trận chưa quyết toán. Điểm Elo đã quyết toán và quan hệ xã hội/thư đã lưu trong PostgreSQL.
- Access token cho WebSocket dùng cùng JWT **không trạng thái** như HTTP.
- `S2C_ENTITY_MOVE` gửi hướng của bước đi vừa rồi (8 hướng); thực thể đứng yên không nằm trong gói nên
  `facing: 'none'` hiện chưa xuất hiện trên đường truyền.

#### Kiểm thử WebSocket

`server/src/net/ws.spec.ts` chạy server thật trên **cổng 0** và nói chuyện bằng client `ws`,
gồm: sai phiên bản/ token rác/ tài khoản không nhân vật, bắt tay hợp lệ, hai client thấy nhau, đồng bộ
di chuyển (B nhận bước của A, sai số cuối ≤ 2 px), chặn di chuyển sai (quá xa/biên/ô chặn), chat +
giới hạn tần suất, ngắt kết nối → `ENTITY_REMOVE`, NPC (3 dòng và NPC lạ), chuyển map (đi bộ vào vùng
cổng tự sang bản đồ bên kia rồi quay lại; đi trong map mới mà không vào cổng thì không đổi map nữa;
gói `C2S_ENTER_MAP` sai chỗ bị từ chối), `PING`/`PONG`, bắt tay quá hạn, heartbeat quá hạn, đẩy phiên
cũ khi cùng nhân vật đăng nhập lại. Tiện ích dùng chung:
`server/src/net/m6-social-arena.spec.ts` kiểm luồng xã hội/thư/Arena, gồm giới hạn thành viên, cooldown, hai lời mời bạn ngược chiều đồng thời; `server/src/modules/arena/service.spec.ts` kiểm reservation, hủy/ngắt kết nối và rollback Elo; `server/src/battle/admission.spec.ts` kiểm loại trừ PvE/Arena cả lúc admission và settlement. Tiện ích dùng chung: `server/src/test/game-server.ts` (server + tài khoản/nhân vật qua REST) và `server/src/test/ws-client.ts`.

### Lớp nghiệp vụ

```text
server/src/
├── main.ts              # khởi động: nạp .env, mở pool, dựng app, bắt SIGINT/SIGTERM để đóng sạch
├── app.ts               # dựng Fastify: cors, jwt, route, xử lý lỗi thống nhất
├── config/
│   ├── env.ts           # đọc/kiểm tra biến môi trường (zod)
│   └── dotenv.ts        # nạp .env ở gốc repo bằng process.loadEnvFile (không cần thư viện ngoài)
├── db/
│   ├── schema.ts        # bảng PostgreSQL cho tài khoản, nhân vật, game state, xã hội, Arena và thư
│   ├── client.ts        # pool PostgreSQL + Drizzle
│   ├── migrate.ts       # chạy migration (CLI: `pnpm db:migrate`)
│   └── ../drizzle/      # file SQL migration do drizzle-kit sinh ra
├── net/                 # WebSocket: gateway /ws, phiên, hàng đợi gói tin, heartbeat
├── core/                # tick.ts — MỘT interval dùng chung; room-manager.ts — room theo map
├── world/               # game-data.ts, map.ts, movement.ts, room.ts, world-service.ts; glue PvE/PvP
├── battle/              # engine.ts (công thức thuần) + service.ts (luồng trận PvE theo lượt)
├── modules/
│   ├── account/         # đăng ký/đăng nhập/làm mới/đăng xuất + route
│   ├── arena/           # hàng chờ, đấu 1v1, Elo, kết quả và trạng thái trận
│   ├── character/       # tạo/liệt kê, chống trùng tên, chỉ số theo cấp + route
│   ├── chat/            # kênh map/world/party/private và giới hạn tần suất
│   ├── inventory/       # túi đồ: cất/lấy theo số lượng, sức chứa theo số loại
│   ├── leaderboard/     # bảng xếp hạng cấp độ và Arena
│   ├── mail/            # thư hệ thống, claim quà nguyên tử
│   ├── npc/             # hội thoại NPC theo game-data
│   ├── party/           # tổ đội, mời/rời/đuổi và giới hạn thành viên
│   ├── quest/           # nhiệm vụ tuyến chương 1
│   └── social/          # lời mời bạn, chấp nhận/từ chối/xóa

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
- Trong trận: sát thương do server tính, hồi chiêu quy ra **vòng** (`ceil(cooldownMs / 30 giây)`), và PvE giữ reservation nhân vật đến khi ghi thưởng/trạng thái + phát gói kết trận xong.
- Arena: một người chơi chỉ được admission/xếp hàng/ghép trận/settlement ở một trạng thái tại một thời điểm; điểm và thắng/thua của cả hai đấu thủ được cập nhật trong cùng transaction, chỉ gửi `S2C_ARENA_END` sau commit.

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

- Module M7+: bang hội (`guild`), sự kiện (`event`) và công cụ quản trị (`admin`). M4 trang bị/shop/cường hóa,
  M5 nhiệm vụ và M6 bạn bè/tổ đội/Arena/thư đã triển khai.
- Chiến đấu: trận nhiều quái (1–3 như thiết kế), hiệu ứng phụ của chiêu (độc/choáng/hồi máu), và lưu trạng thái
  trận đang chạy qua database khi vận hành nhiều tiến trình.
- Lưu vị trí nhân vật vào database, chia kênh theo map, pub/sub qua Redis (nhiều tiến trình).
- Giới hạn tần suất chung cho mọi gói tin, khoá tài khoản sau nhiều lần sai, audit log.

## Nguyên tắc

1. Không tin client: kiểm tra vị trí, tốc độ, hồi chiêu, quyền sở hữu vật phẩm trước khi áp dụng.
2. Nghiệp vụ game nằm ở server; `shared/` chỉ chứa protocol/kiểu dữ liệu/hằng số.
3. Lưu dữ liệu theo lô (dirty flags + flush định kỳ), giao dịch (trade) dùng transaction.
4. Mọi thay đổi dữ liệu quan trọng ghi audit log.
