# Giao thức mạng, vòng lặp server & dữ liệu

*Ngày viết: 2026-10-15. Cập nhật cùng ngày sau khi **phía server của M2** (thế giới, di chuyển, chat) chạy thật: mục 2c ghi hiện trạng, các mục 3–7 đã sửa cho khớp mã trong `server/` và `shared/`.*

## 1. Kiến trúc tổng thể

```text
┌──────────────────────────┐
│  Trình duyệt (client)    │
│  HTTP(S)  +  WebSocket   │
└───────────┬──────────────┘
            │  WSS (game)      HTTPS (login, tải map tĩnh, API phụ)
            ▼
┌──────────────────────────┐
│  nginx  (TLS, file tĩnh) │
└───────────┬──────────────┘
            ▼
┌──────────────────────────┐     ┌───────────────┐
│  Node.js game server     │────▶│  Redis        │  phiên, pub/sub, xếp hạng
│  (Fastify + ws rooms)    │     └───────────────┘
└───────────┬──────────────┘
            ▼
┌──────────────────────────┐
│  PostgreSQL              │  dữ liệu người chơi & vận hành
└──────────────────────────┘
```

- Client tải file tĩnh (JS, hình, âm) từ nginx/CDN.
- **HTTP**: đăng ký/đăng nhập, refresh token, tải bản đồ tĩnh (layout gạch, vị trí NPC — dữ liệu công khai), API phụ trợ.
- **WebSocket**: toàn bộ tương tác thời gian thực (vào map, di chuyển, chat, trận đấu, túi đồ...).

## 2. Luồng đăng nhập

1. `POST /auth/register` → tạo tài khoản (mật khẩu hash argon2).
2. `POST /auth/login` → trả `accessToken` (JWT, 15 phút) + `refreshToken` (lưu DB/Redis).
3. Client mở `wss://<host>/ws` (WebSocket dùng **chung cổng HTTP** với API) rồi gửi `C2S_HELLO` kèm access token và (tuỳ chọn) `characterId`.
4. Server xác thực token + phiên bản protocol rồi chọn nhân vật: có `characterId` thì phải thuộc tài khoản, bỏ trống thì lấy nhân vật **tạo gần nhất**; trả `S2C_HELLO`.
5. Server đưa nhân vật vào bản đồ khởi đầu và gửi `S2C_ENTER_MAP` (bản đồ đầy đủ để vẽ, chính người chơi, danh sách thực thể **khác**, lịch sử chat gần nhất).

## 2b. Hiện trạng đã cài đặt (M1)

Trước khi có WebSocket, phần tài khoản và nhân vật đã chạy bằng **HTTP API** dưới `/api`
(xem `server/README.md` để có bảng endpoint đầy đủ):

- `POST /api/auth/register`, `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, `GET /api/auth/me`
- `GET /api/characters`, `POST /api/characters`

Kiểu dữ liệu vào/ra của các endpoint này nằm trong `shared/src/schemas/` (zod), dùng chung cho
server và client. Khi thêm WebSocket ở M2, các bước xác thực vẫn dùng access token JWT như hiện nay:
client lấy token qua HTTP rồi đưa vào gói `C2S_HELLO` khi mở kết nối.

## 2c. Hiện trạng đã cài đặt (M2 — thế giới, di chuyển, chat)

Phần **server** của M2 đã chạy thật (kiểm thử tích hợp bằng client `ws` trong `server/src/net/ws.spec.ts`):

- **WebSocket gắn cùng cổng HTTP** ở đường dẫn `/ws` (`WebSocketServer({ noServer: true })` + sự kiện
  `upgrade` của Fastify); đường dẫn khác trả 404 rồi đóng socket.
- **Bắt tay**: `C2S_HELLO {token, protocolVersion, clientVersion?, characterId?}` → `S2C_HELLO` + `S2C_ENTER_MAP`.
  Token sai → `unauthorized`; lệch phiên bản → `protocol_mismatch`; nhân vật không thuộc tài khoản →
  `bad_packet`; tài khoản chưa có nhân vật → `no_character`; gói đầu tiên không phải `C2S_HELLO`, khung sai,
  hoặc quá 10 giây chưa bắt tay → `bad_packet`. Mọi lỗi bắt tay đều `fatal: true` và server đóng kết nối.
- **M2 luôn vào bản đồ khởi đầu** `lang-khoi-nguon` tại điểm spawn `default`; chưa lưu vị trí vào database (xem 6.3).
- **Một nhân vật một kết nối** (đúng mục 4): kết nối mới đẩy phiên cũ ra bằng `S2C_NOTIFY` rồi đóng mã 4000,
  thực thể cũ bị dọn khỏi room ngay để không có hai thực thể cùng id.
- **Chat** chỉ có kênh `map`, tối đa `CHAT_MAX_LENGTH` ký tự và giãn cách `CHAT_MIN_INTERVAL_MS` cho mỗi
  người (vi phạm → `rate_limited`, không fatal); room giữ `CHAT_BACKLOG_SIZE` tin gần nhất và gửi kèm
  trong `S2C_ENTER_MAP.chatBacklog`.
- **NPC**: `C2S_NPC_TALK` chỉ trả lời NPC **có trong bản đồ hiện tại**, ngược lại `unknown_entity`.
- **Quy ước toạ độ** (client vẽ theo đúng quy ước này): pixel liên tục; gốc (0,0) ở góc trên-trái, trục y
  hướng xuống; điểm spawn và NPC đặt sẵn nằm ở **tâm ô** (`ô × tileSize + tileSize/2`); vùng cổng là nửa mở
  `[x×tileSize, (x+width)×tileSize)` × `[y×tileSize, (y+height)×tileSize)`.
- **Cổng dịch chuyển tự kích hoạt** (M2, `shared` **không** gửi vùng cổng cho client): mỗi nhịp tick,
  server kiểm vùng cổng tại vị trí người chơi **sau khi đẩy bước đi**; vào vùng cổng dẫn sang bản đồ khác
  thì chuyển map ngay (`S2C_ENTER_MAP` cho người đi, `S2C_ENTITY_REMOVE`/`S2C_ENTITY_ADD` cho hai room).
  Đứng yên trong vùng cổng không kích hoạt, và cổng dẫn về chính bản đồ đang đứng bị bỏ qua ⇒ không có
  vòng lặp. `C2S_ENTER_MAP` vẫn giữ luật cũ (phải đứng trong vùng cổng) và dùng **chung một hàm chuyển
  map** với đường đi bộ.
- **Chưa làm ở M2** (ghi rõ để không hiểu nhầm là đã có): chia kênh theo map, lưu vị trí vào database,
  rate limit chung cho mọi gói tin và "sai quá nhiều thì ngắt kết nối tạm thời", chat thế giới/nhóm.
### 2c. Hiện trạng đã cài đặt (M3 — chiến đấu theo lượt)

- **Trận đấu nằm hoàn toàn ở server** (`server/src/battle/`): client chỉ gửi ý định và vẽ kết quả.
  Công thức thuần ở `engine.ts` (thuần nên kiểm thử riêng), luồng trận ở `service.ts`.
- **Mở trận**: `C2S_ATTACK_MOB` — quái phải còn sống (`monster_gone`), cách ≤ `MONSTER_ENGAGE_RANGE_PX`
  = 96 px (`out_of_range`), người chơi chưa ở trận khác (`in_battle`). Quái đã có trận thì **vào chung**
  (tối đa `BATTLE_MAX_PLAYERS` = 2 người, quá thì `invalid_target`); vào trận thì nhân vật đứng yên.
- **Lượt**: mỗi vòng xếp thứ tự theo tốc độ giảm dần, hòa thì ngẫu nhiên; lượt người chơi kéo dài
  `BATTLE_TURN_MS` = 30 s, hết giờ thì server tự đánh thường (nhật ký ghi `auto`); quái ra đòn sau
  `MONSTER_TURN_DELAY_MS` = 800 ms để client kịp thấy lượt của nó.
- **Sát thương**: `power + hệ số × chỉ số` (đánh thường: `2 + 1 × tấn công`; chiêu: `power + factor ×
  chỉ số chiêu ăn theo`), dao động ±10%, chí mạng 5% (×1,5), trừ phòng thủ mục tiêu, sàn `MIN_DAMAGE` = 1.
- **Hồi chiêu tính theo vòng** (`ceil(cooldownMs / 30 s)`) vì trận không có đồng hồ chung để đếm ms.
- **Chạy thoát**: `50% + 2% × (nhanh nhẹn người chơi − tốc độ quái)`, kẹp 10–90%; thoát thì rời trận ngay,
  trận còn người khác thì tiếp tục; hết người thì quái **hồi đầy máu** (chống đánh–chạy–đánh).
- **Kết trận**: thắng thì mỗi người nhận đủ `expReward`, yên ngẫu nhiên trong `[yenMin, yenMax]` và tự
  gieo từng món quà rơi (túi đầy thì món đó mất); lên cấp cộng thêm phần máu/nội lực tối đa tăng thêm.
  Thua thì hồi sinh ở làng với 50% máu và mất 10% yên. Mọi thay đổi chỉ ghi database **khi trận kết thúc**
  (trong trận giữ ở bộ nhớ) — mất kết nối giữa trận thì máu/nội lực đang có được ghi lại và người chơi rời trận.
- **Quái trên bản đồ** là thực thể `kind: 'monster'` trong room, mỗi chỗ đặt một con riêng có máu và hẹn giờ
  hồi sinh; máu đổi thì room phát lại `S2C_ENTITY_ADD` cùng id (client thay thế theo id, nên thanh máu trên
  bản đồ khớp với trận đang đánh).
- **Chống gian lận ở M3**: mọi con số do server tính; di chuyển bị từ chối khi đang trong trận; dùng vật
  phẩm trong trận bắt buộc đi qua lượt (không hồi máu miễn phí); quà rơi và kinh nghiệm không bao giờ gửi
  cho client trước khi trận kết thúc.
- **Chưa làm ở M3** (ghi rõ): trận nhiều quái (1–3 như thiết kế), hiệu ứng phụ của chiêu (độc/choáng),
  trang bị ảnh hưởng chỉ số, lưu vị trí vào database, và rate limit chung cho mọi gói tin.


### 2d. Hiện trạng đã cài đặt (M4 — trang bị theo ô, shop & cường hóa)

- **Trang bị theo ô:** mỗi nhân vật có 4 ô (`EQUIP_SLOTS`: `weapon`, `body`, `feet`, `accessory`).
  `inventory_items` thêm `upgrade_level` và `equipped_slot`, kèm **unique index một phần**
  `(character_id, equipped_slot) where equipped_slot is not null` nên database tự chặn cảnh hai món cùng
  một ô. **Túi = các hàng `equipped_slot is null`**, nên mặc/tháo chỉ đổi cột trên đúng hàng cũ: không
  sinh hàng thứ hai, túi đầy 40 loại vẫn mặc được.
- **Chỉ số:** `resolveStats()` nhận thêm `bonus` từ trang bị và cộng vào **gốc** trước khi suy ra tấn
  công/phòng thủ/tốc độ/máu tối đa — nên vào trận, dùng vật phẩm, thắng/thua/lên cấp đều dùng đúng chỉ số.
  Gói trang bị luôn đủ 4 ô, ô trống là `item: null`.
- **Shop:** NPC bán hàng khai trong `game-data/npcs/npc-thay-do.json`; `S2C_NPC_DIALOG` mang thêm `shop`
  (danh sách món + giá + yêu cầu cấp). Mua trừ yên bằng **một câu UPDATE có điều kiện** `yen >= amount`;
  bán nhận 40% giá gốc (`SELL_PRICE_RATIO`). Mỗi giao dịch thành công ghi **một hàng `transactions`**
  (`kind` `buy|sell|upgrade`, `yen_delta`, `detail` tiếng Việt).
- **Cường hóa:** mỗi lần thử tốn 50 yên + 1 đá vụn (`UPGRADE_MATERIAL_ID`), tỉ lệ theo cấp (cấp 0→1 =
  1.0), trần chung `UPGRADE_MAX_LEVEL` = 5 và trần riêng của món qua `upgradeMaxLevelOf()`. Trình tự:
  kiểm cấp/trần → **trừ yên** → **lấy đá** → gieo `rng`; thiếu đá thì hoàn yên và **không** gọi `rng`. Đá
  vụn rơi từ quái (Bù Nhìn 40%, Chuột Đồng 70%, Heo Rừng 80%).
- **Chống lạm dụng:** mọi thao tác mặc/tháo/mua/bán/cường hóa đều kiểm quyền sở hữu trên hàng trong
  `inventory_items` của đúng nhân vật, và bị chặn khi đang trong trận (`in_battle`).
- **Client:** bảng trang bị (4 ô + nút Tháo), bảng shop (Mua/Bán, giá, yêu cầu cấp), nút Cường hóa trong
  túi (yên + tỉ lệ, khoá khi chạm trần), thông báo kết quả; HUD thêm nút **Trang bị**; bảng túi nằm dưới
  thanh HUD và hiện cấp `+N`, chỉ số, giá bán.

## 3. Định dạng gói tin

Mỗi gói tin WebSocket là **một khung text JSON** (chưa dùng nhị phân/MessagePack; để dành khi băng thông thành vấn đề):

| Trường | Kiểu | Ý nghĩa |
|---|---|---|
| `op` | số nguyên | opcode (xem 3.1) |
| `seq` | số nguyên | số thứ tự tăng dần do **bên gửi** đặt (client dùng để khớp phản hồi) |
| `payload` | object | phần thân, kiểm bằng schema zod tương ứng với `op` |

Khung do `shared/src/protocol/codec.ts` đóng/mở: `encodePacket(op, payload, seq)` và `decodeEnvelope(raw)`.
Server **chỉ** nhận khung text — khung nhị phân bị coi là `bad_packet`.

Quy ước: `C2S_*` = client → server, `S2C_*` = server → client. Mọi gói tin có schema zod trong `shared/src/protocol`.

### 3.1 Dải opcode

| Dải | Nhóm |
|---|---|
| `0x01xx` | Xác thực & hệ thống (ping, version, thông báo) |
| `0x02xx` | Nhân vật (chỉ số, EXP, chọn nhân vật) |
| `0x03xx` | Thế giới (vào/thoát map, di chuyển, chat, NPC) |
| `0x04xx` | Túi đồ, trang bị, shop, cường hóa |
| `0x05xx` | Kỹ năng & trận đấu theo lượt |
| `0x06xx` | Nhiệm vụ |
| `0x07xx` | Xã hội (bạn, nhóm, bang hội, thư) |
| `0x08xx` | Lôi Đài, xếp hạng, sự kiện |
| `0x09xx` | GM/admin, chẩn đoán |

### 3.2 Danh sách gói tin cốt lõi (MVP → Alpha)

| Opcode | Hướng | Nội dung |
|---|---|---|
| `C2S_HELLO` | C→S | Bắt tay (M2): token, phiên bản protocol, `clientVersion`?, `characterId`? |
| `S2C_HELLO` | S→C | Chấp nhận/từ chối (lệch phiên bản), nhịp tick, nhân vật đang điều khiển, bản đồ (M2) |
| `C2S_SELECT_CHAR` | C→S | **Không dùng** — chọn nhân vật bằng `characterId` ngay trong `C2S_HELLO` |
| `S2C_ENTER_WORLD` | S→C | **Không dùng** — `S2C_HELLO` (nhân vật, nhịp tick) + `S2C_ENTER_MAP` (bản đồ, thực thể) |
| `C2S_ENTER_MAP` / `S2C_ENTER_MAP` | 2 chiều | Vào map (map id; `spawnId` bị bỏ qua; cổng đi bộ được server tự phát hiện — M2) / bản đồ đầy đủ + chính mình + thực thể khác + lịch sử chat (M2) |
| `C2S_MOVE` | C→S | Ý định di chuyển (tọa độ đích, pixel) |
| `S2C_ENTITY_MOVE` | S→C | Vị trí thực thể, gộp nhiều thực thể trong một gói mỗi tick (M2) |
| `S2C_ENTITY_ADD/REMOVE` | S→C | Thực thể vào/ra tầm nhìn (M2: vào/ra room) |
| `C2S_CHAT` / `S2C_CHAT` | 2 chiều | Chat khu vực/thế giới/hệ thống (M2 mới có kênh `map`) |
| `C2S_NPC_TALK` / `S2C_NPC_DIALOG` | 2 chiều | Hội thoại NPC (M2: trả lời NPC trong map hiện tại) |
| `C2S_PING` / `S2C_PONG` | 2 chiều | Nhịp sống (M2): `clientTime` / `clientTime` + `serverTime` (ms epoch) |
| `S2C_ERROR` | S→C | Lỗi theo mã kèm `fatal` (M2); mã trong `shared/src/protocol/opcodes.ts` |
| `C2S_QUEST_ACCEPT/COMPLETE` | C→S | Nhận/trả nhiệm vụ |
| `S2C_QUEST_UPDATE` | S→C | Cập nhật tiến độ nhiệm vụ |
| `C2S_ATTACK_MOB` | C→S | Chạm vào quái để bắt đầu trận (M3: trong tầm 96 px, quái phải còn sống) |
| `S2C_BATTLE_START` | S→C | Trận bắt đầu: danh sách tham gia, người tới lượt, hạn lượt (M3; phát lại khi có người vào chung) |
| `S2C_BATTLE_TURN` | S→C | Đến lượt ai, còn bao lâu (M3) |
| `C2S_BATTLE_ACTION` | C→S | Hành động (đánh thường/dùng chiêu/vật phẩm/chạy) — M3 kiểm lượt, hồi chiêu, nội lực, quyền sở hữu vật phẩm |
| `S2C_BATTLE_RESULT` | S→C | Kết quả một hành động: nhật ký dạng câu tiếng Việt + trạng thái mới của mọi người (M3) |
| `S2C_BATTLE_END` | S→C | Kết thúc: thắng/thua/chạy thoát kèm phần thưởng **của riêng người nhận** (M3) |
| `C2S_USE_ITEM` / `S2C_INVENTORY_UPDATE` | 2 chiều | Dùng vật phẩm ngoài trận (trong trận phải qua lượt), gửi lại cả túi mỗi lần đổi (M3) |
| `C2S_EQUIP` / `C2S_UNEQUIP` | 2 chiều | Mặc/tháo trang bị theo ô (`itemId` / `slot`) — M4 |
| `S2C_EQUIPMENT` | S→C | Đủ 4 ô trang bị (ô trống `item: null`) — M4; gửi ngay sau bắt tay/respawn và sau mỗi lần mặc/tháo/cường hóa |
| `C2S_SHOP_BUY` / `C2S_SHOP_SELL` | 2 chiều | Mua/bán ở quầy NPC — M4; server nhớ NPC vừa nói chuyện nên **phải bấm NPC bán hàng trước khi mua**, còn bán thì không cần quầy |
| `C2S_UPGRADE` / `S2C_UPGRADE_RESULT` | 2 chiều | Cường hóa trang bị — M4: tốn 50 yên + 1 đá vụn mỗi lần thử kể cả khi hỏng, tỉ lệ theo cấp (0→1 = 1.0), trần 5 |
| `S2C_LEVEL_UP` / `S2C_CHARACTER` | S→C | Lên cấp (kèm chiêu mới học) và chỉ số nhân vật — M3 gửi `S2C_CHARACTER` ngay sau bắt tay và mỗi lần chỉ số đổi; chưa có `S2C_STATS_UPDATE` riêng |
| `S2C_NOTIFY` | S→C | Thông báo hệ thống (thưởng, sự kiện, lỗi) |

## 4. Vòng lặp server (tick)

- **Tick 100 ms (10 Hz)**: cập nhật vị trí, phát hiện thực thể vào/ra tầm nhìn, đếm giờ trận đấu. M2 dùng **một** `setInterval` duy nhất (`server/src/core/tick.ts`) cho cả room lẫn quét heartbeat; mỗi tick người chơi đang đi tiến `PLAYER_SPEED_PX_PER_SEC × 0,1 s = 16 px` về đích, tới nơi khi sai số < 0,5 px, và cả room nhận **một** `S2C_ENTITY_MOVE` gộp (chỉ gồm thực thể đã đổi vị trí).
- **Room = một bản đồ (map) + kênh (channel)**: khi map quá đông, mở kênh 2, 3... để giảm tải. M2 mới có **một room cho mỗi map** (chưa chia kênh); room tạo khi có người đầu tiên vào và xoá khi rỗng.
- **Trận đấu (battle instance)**: chạy song song trong room, có hàng đợi lượt và **đồng hồ 30 giây/lượt**; hết giờ server tự cho "đánh thường" để không treo trận.
- **Heartbeat**: client gửi ping mỗi 5 giây; quá 30 giây không có gói tin → ngắt kết nối, nhân vật rời map (giữ nguyên dữ liệu đã lưu). M2 đã cài đúng vậy: quá hạn → `S2C_ERROR` `bad_packet` (`fatal: true`) rồi đóng mã 1001 và dọn khỏi room; hết hạn chờ dùng mã `bad_packet` vì `ErrorCode` chưa có mã riêng cho việc này.
- **Một nhân vật chỉ có một kết nối** hoạt động; đăng nhập nơi khác sẽ đẩy phiên cũ ra (chống treo tài khoản) — M2 đã cài (`S2C_NOTIFY` + đóng mã 4000).

## 5. Chống gian lận (bài học từ client PC của game gốc)

Game gốc xử lý gần hết ở client nên bị chế auto/mod dễ dàng. Quy tắc của chúng ta:

1. **Không tính toán gì quan trọng ở client**: sát thương, rơi đồ, tỷ lệ cường hóa, random → chỉ server tính.
2. **Kiểm tra di chuyển**: khoảng cách mỗi tick ≤ tốc độ tối đa; từ chối lệnh "tàng hình xuyên tường". M2 cài cụ thể: mỗi lệnh `C2S_MOVE` chỉ được nhắm trong `MAX_MOVE_DISTANCE_PX` (600 px), điểm đích phải nằm trong biên bản đồ và **không** thuộc ô `blocked`; đổi map chỉ hợp lệ khi đang đứng trong vùng cổng và điểm đến lấy từ `portals[].toSpawn` (bỏ qua `spawnId` client gửi).
3. **Kiểm tra hành động**: hồi chiêu, đủ năng lượng, đúng trạng thái (đang trong trận/không), khoảng cách tới mục tiêu. M3 cài đủ: `not_your_turn`, `skill_cooldown`, `not_enough_mp`, `out_of_range` (96 px), `in_battle`, `monster_gone`, `item_not_owned`, `item_not_usable`, `item_no_effect`.
4. **Sở hữu vật phẩm**: mọi thao tác (dùng/bán/cường hóa) kiểm tra vật phẩm thuộc nhân vật đó trong DB.
5. **Rate limit**: chat 1 tin/giây; hành động chiến đấu tối đa 5 lệnh/giây; sai quá nhiều → ngắt kết nối tạm thời. (M2 mới cài phần chat — 1 tin/giây/người và tối đa `CHAT_MAX_LENGTH` ký tự; M3 chặn ở tầng luật: đúng lượt, đủ nội lực, hồi chiêu đã hết, vật phẩm thuộc túi — nhưng **vẫn chưa đếm số gói sai** để ngắt kết nối.)
6. **Không gửi dữ liệu bí mật cho client**: bảng rơi đồ, tỷ lệ cường hóa, chỉ số quái, dữ liệu người chơi khác (chỉ gửi phần hiển thị).
7. **Audit log**: mọi thay đổi Yên/vật phẩm giá trị cao đều ghi log để đối soát.

## 6. Thiết kế dữ liệu

### 6.1 Bảng PostgreSQL (dữ liệu chạy)

**Trạng thái: bảng này là thiết kế đích cho cả dự án, không phải danh sách "đã có".** Sau M4, database
có `accounts`, `characters`, `refresh_tokens`, `inventory_items` (thêm `upgrade_level`, `equipped_slot`) và
`transactions` — xem `server/src/db/schema.ts` và ba migration trong `server/drizzle/`; các bảng còn lại sẽ
được tạo ở cột mốc tương ứng. Cột `map_id`, `x`, `y`, `stats`, `last_login` của `characters` **chưa có**
(M2/M3 chưa lưu vị trí — xem 6.3), nhưng đã có thêm `hp`/`mp` với quy ước `null` = đang đầy.

| Bảng | Cột chính | Ghi chú | Đã có |
|---|---|---|---|
| `accounts` | id, username, password_hash, email, status, created_at | 1 tài khoản nhiều nhân vật | ✅ M1 |
| `refresh_tokens` | id, account_id, token_hash, expires_at, revoked_at | refresh token xoay vòng, lưu dạng băm | ✅ M1 |
| `characters` | id, account_id, name, school, class, level, exp, yen, **hp, mp**, map_id, x, y, stats(jsonb), last_login | chỉ số suy từ `game-data/classes/` chứ không lưu; `hp`/`mp` là máu/nội lực **hiện tại**, `null` = đang đầy; `map_id/x/y/stats/last_login` **chưa làm** | ✅ M1 + M3 (hp/mp) |
| `inventory_items` | id, character_id, item_id, quantity, **upgrade_level, equipped_slot**, created_at | **thay cho bảng `items` dự kiến**: một hàng cho mỗi **loại** vật phẩm kèm số lượng (khớp cách túi hiển thị), sức chứa đếm theo số loại. M4 thêm cấp cường hóa và ô đang mặc, kèm unique index một phần `(character_id, equipped_slot) where equipped_slot is not null`; **túi = hàng có `equipped_slot is null`** | ✅ M3 + M4 |
| `char_skills` | char_id, skill_id, skill_level | **không dùng ở M3**: học chiêu là hàm của phái và cấp, dữ liệu chiêu là nguồn sự thật duy nhất | ❌ chưa có |
| `items` | id, owner_id, template_id, qty, upgrade_level, bound, slot, meta(jsonb) | vật phẩm có thuộc tính riêng (cường hóa, khóa, ô trang bị) — thay bằng `inventory_items` ở M3; M4 giải quyết bằng cột `upgrade_level`/`equipped_slot` trên `inventory_items` nên bảng này vẫn không cần | ❌ không cần |
| `quest_progress` | char_id, quest_id, state, progress(jsonb) | nhiệm vụ | M5 |
| `friends` | char_id, friend_id, status | bạn bè | M6 |
| `guilds` | id, name, level, exp, notice, created_at | bang hội | M7 |
| `guild_members` | guild_id, char_id, rank, joined_at | thành viên | M7 |
| `mails` | id, to_char_id, from_name, title, body, attach(jsonb), is_read, expires_at | thư + quà | M6 |
| `arena_rank` | char_id, season, rating, wins, losses | Lôi Đài | M6 |
| `daily_limits` | char_id, kind, count, day | giới hạn theo ngày (boss, sự kiện) | M7 |
| `transactions` | id, character_id, kind, item_id, quantity, yen_delta, detail, created_at | **thay cho `trade_logs` dự kiến**: sổ giao dịch mua/bán/cường hóa, ghi khi thành công (`yen_delta` âm khi mua/cường hóa, dương khi bán) | ✅ M4 |
| `audit_logs` | id, actor, action, meta(jsonb), created_at | đối soát | ❌ chưa có |

### 6.2 Dữ liệu nội dung (game-data, JSON)

| Loại | File ví dụ | Trường chính |
|---|---|---|
| Bản đồ | `maps/lang-khoi-nguon.json`, `maps/bai-luyen-tap.json` (đã có) | kích thước, tileset (id, màu, `blocked`), lớp `ground`/`decor`, cổng dịch chuyển (map + điểm spawn đích), điểm spawn, NPC đặt sẵn |
| NPC | `npcs/npc-thay-hieu-truong.json` (đã có) | tên, màu, danh sách lời thoại (người nói + nội dung) |
| Quái | `monsters/mob-bui-nhon.json`, `mob-chuot-dong.json`, `mob-heo-rung.json` (đã có ở M3) | hình dáng để vẽ, màu, cấp, máu, tấn công, phòng thủ, tốc độ, kinh nghiệm, khoảng yên, bảng rơi đồ, thời gian hồi sinh |
| Vật phẩm | `items/item-kiem-go.json`, `item-banh-bao.json`, `item-tra-rung.json`, `item-da-vun.json` (đã có) | loại, ô trang bị, chỉ số, cấp yêu cầu, giá, mốc cường hóa, **hiệu ứng dùng được** (`consumable`: hồi máu/nội lực) |
| Chiêu thức | `skills/skill-tram-co-ban.json` (đã có) | hệ, sát thương gốc, hệ số, năng lượng, hồi chiêu, hiệu ứng, số mục tiêu |
| Nhiệm vụ | `quests/quest-chao-lang.json` (sẽ tạo ở M5) | cấp yêu cầu, các bước (nói chuyện/đánh/thu thập), thưởng |
| Trường/phái | `classes/school-haruna.json`, `school-hirosaki.json`, `school-ookaza.json` (đã có ở M3) | chỉ số ở cấp 1, phần tăng mỗi cấp, yên và vật phẩm khởi đầu |

Ví dụ một chiêu (minh họa định dạng, số liệu tự đặt):

```json
{
  "id": "skill-dam-co-ban",
  "name": "Trảm Cơ Bản",
  "school": "haruna",
  "class": "dao",
  "type": "active",
  "levelRequired": 1,
  "costMp": 5,
  "cooldownMs": 0,
  "targets": 1,
  "power": 10,
  "scale": { "stat": "strength", "factor": 1.2 },
  "effects": []
}
```

### 6.3 Chiến lược lưu trữ

1. Nhân vật đang online giữ **bản làm việc trong bộ nhớ** + cờ "dirty".
2. Flush định kỳ **mỗi 60 giây** và khi thoát; các thao tác quan trọng (giao dịch, cường hóa, trả nhiệm vụ) flush **ngay**.
3. Giao dịch nhiều bước (mua/bán/đổi) dùng **transaction** của PostgreSQL.
4. Sao lưu DB định kỳ (pg_dump + lưu trữ ngoài máy chủ).
5. **M2/M3 chưa lưu vị trí nhân vật**: `characters.map_id/x/y` chưa được ghi — mỗi lần vào game đều bắt đầu
   ở `lang-khoi-nguon`/`default`; trạng thái sống của thế giới (máu quái, hồi sinh) chỉ nằm trong bộ nhớ
   tiến trình, còn thứ phải giữ thì M3 ghi **ngay khi trận kết thúc** (`characters.hp/mp/level/exp/yen` và
   `inventory_items`) chứ không chờ flush định kỳ. Bản làm việc + flush 60 giây sẽ áp dụng khi thế giới có
   trạng thái cần giữ lâu dài (vị trí, nhiệm vụ, bang hội).

## 7. Phiên bản protocol & tương thích

- `shared/src/protocol/version.ts` chứa `PROTOCOL_VERSION` (số nguyên).
- Bắt tay `C2S_HELLO` gửi phiên bản; lệch → server từ chối kèm thông báo "hãy tải lại trang".
- Endpoint `GET /version` trả phiên bản server + client mong đợi (dùng cho màn hình bảo trì).
- Phía server (M2): `C2S_HELLO` lệch `PROTOCOL_VERSION` → `S2C_ERROR` `protocol_mismatch` (`fatal: true`) rồi đóng kết nối, thông báo nhắc tải lại trang.
- `PROTOCOL_VERSION` hiện là **3** (M3 thêm gói chiến đấu, túi đồ, chỉ số nhân vật).
- Quy tắc: thay đổi protocol **chỉ** ở server hoặc client đều phải tăng `PROTOCOL_VERSION` trong cùng một lần merge.
