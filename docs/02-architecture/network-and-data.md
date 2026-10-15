# Giao thức mạng, vòng lặp server & dữ liệu

*Ngày viết: 2026-10-15.*

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
3. Client mở `wss://.../game?token=<accessToken>` → server xác thực token, đăng ký kết nối.
4. Client gửi `C2S_ENTER_WORLD` (chọn nhân vật) → server nạp nhân vật từ DB/Redis vào bộ nhớ.
5. Server gửi `S2C_ENTER_MAP` (thông tin map hiện tại, danh sách thực thể xung quanh).

## 2b. Hiện trạng đã cài đặt (M1)

Trước khi có WebSocket, phần tài khoản và nhân vật đã chạy bằng **HTTP API** dưới `/api`
(xem `server/README.md` để có bảng endpoint đầy đủ):

- `POST /api/auth/register`, `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, `GET /api/auth/me`
- `GET /api/characters`, `POST /api/characters`

Kiểu dữ liệu vào/ra của các endpoint này nằm trong `shared/src/schemas/` (zod), dùng chung cho
server và client. Khi thêm WebSocket ở M2, các bước xác thực vẫn dùng access token JWT như hiện nay:
client lấy token qua HTTP rồi đưa vào gói `C2S_HELLO` khi mở kết nối.

## 3. Định dạng gói tin

Mỗi gói tin WebSocket (nhị phân):

| Trường | Kích thước | Ý nghĩa |
|---|---|---|
| `op` | 2 byte (uint16) | opcode |
| `seq` | 4 byte (uint32) | số thứ tự tăng dần (client dùng để khớp phản hồi) |
| `len` | 2 byte (uint16) | độ dài phần thân |
| `payload` | `len` byte | MessagePack (dev có thể dùng JSON) |

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
| `C2S_HELLO` | C→S | Bắt tay: phiên bản protocol, phiên bản client |
| `S2C_HELLO` | S→C | Chấp nhận/từ chối (lệch phiên bản), nhịp tick |
| `C2S_SELECT_CHAR` | C→S | Chọn nhân vật để vào game |
| `S2C_ENTER_WORLD` | S→C | Thông tin nhân vật, vị trí, tiền, túi đồ tóm tắt |
| `C2S_ENTER_MAP` / `S2C_ENTER_MAP` | 2 chiều | Vào map (map id, danh sách thực thể) |
| `C2S_MOVE` | C→S | Ý định di chuyển (tọa độ đích) |
| `S2C_ENTITY_MOVE` | S→C | Vị trí thực thể (có thể gộp nhiều thực thể/gói) |
| `S2C_ENTITY_ADD/REMOVE` | S→C | Thực thể vào/ra tầm nhìn |
| `C2S_CHAT` / `S2C_CHAT` | 2 chiều | Chat khu vực/thế giới/hệ thống |
| `C2S_NPC_TALK` / `S2C_NPC_DIALOG` | 2 chiều | Hội thoại NPC |
| `C2S_QUEST_ACCEPT/COMPLETE` | C→S | Nhận/trả nhiệm vụ |
| `S2C_QUEST_UPDATE` | S→C | Cập nhật tiến độ nhiệm vụ |
| `C2S_ATTACK_MOB` | C→S | Chạm vào quái để bắt đầu trận |
| `S2C_BATTLE_START` | S→C | Trận bắt đầu: danh sách tham gia, thứ tự lượt |
| `S2C_BATTLE_TURN` | S→C | Đến lượt ai, đồng hồ bao nhiêu giây |
| `C2S_BATTLE_ACTION` | C→S | Hành động (đánh thường/dùng chiêu/vật phẩm/chạy) |
| `S2C_BATTLE_RESULT` | S→C | Kết quả một hành động (sát thương, hiệu ứng) |
| `S2C_BATTLE_END` | S→C | Kết thúc: EXP, Yên, rơi đồ, thay đổi cấp |
| `C2S_USE_ITEM` / `S2C_INVENTORY_UPDATE` | 2 chiều | Dùng vật phẩm, cập nhật túi |
| `C2S_UPGRADE_ITEM` / `S2C_UPGRADE_RESULT` | 2 chiều | Cường hóa trang bị |
| `S2C_LEVEL_UP` / `S2C_STATS_UPDATE` | S→C | Lên cấp, cập nhật chỉ số |
| `S2C_NOTIFY` | S→C | Thông báo hệ thống (thưởng, sự kiện, lỗi) |

## 4. Vòng lặp server (tick)

- **Tick 100 ms (10 Hz)**: cập nhật vị trí, phát hiện thực thể vào/ra tầm nhìn, đếm giờ trận đấu.
- **Room = một bản đồ (map) + kênh (channel)**: khi map quá đông, mở kênh 2, 3... để giảm tải.
- **Trận đấu (battle instance)**: chạy song song trong room, có hàng đợi lượt và **đồng hồ 30 giây/lượt**; hết giờ server tự cho "đánh thường" để không treo trận.
- **Heartbeat**: client gửi ping mỗi 5 giây; quá 30 giây không có gói tin → ngắt kết nối, nhân vật rời map (giữ nguyên dữ liệu đã lưu).
- **Một nhân vật chỉ có một kết nối** hoạt động; đăng nhập nơi khác sẽ đẩy phiên cũ ra (chống treo tài khoản).

## 5. Chống gian lận (bài học từ client PC của game gốc)

Game gốc xử lý gần hết ở client nên bị chế auto/mod dễ dàng. Quy tắc của chúng ta:

1. **Không tính toán gì quan trọng ở client**: sát thương, rơi đồ, tỷ lệ cường hóa, random → chỉ server tính.
2. **Kiểm tra di chuyển**: khoảng cách mỗi tick ≤ tốc độ tối đa; từ chối lệnh "tàng hình xuyên tường".
3. **Kiểm tra hành động**: hồi chiêu, đủ năng lượng, đúng trạng thái (đang trong trận/không), khoảng cách tới mục tiêu.
4. **Sở hữu vật phẩm**: mọi thao tác (dùng/bán/cường hóa) kiểm tra vật phẩm thuộc nhân vật đó trong DB.
5. **Rate limit**: chat 1 tin/giây; hành động chiến đấu tối đa 5 lệnh/giây; sai quá nhiều → ngắt kết nối tạm thời.
6. **Không gửi dữ liệu bí mật cho client**: bảng rơi đồ, tỷ lệ cường hóa, chỉ số quái, dữ liệu người chơi khác (chỉ gửi phần hiển thị).
7. **Audit log**: mọi thay đổi Yên/vật phẩm giá trị cao đều ghi log để đối soát.

## 6. Thiết kế dữ liệu

### 6.1 Bảng PostgreSQL (dữ liệu chạy)

| Bảng | Cột chính | Ghi chú |
|---|---|---|
| `accounts` | id, username, password_hash, email, status, created_at | 1 tài khoản nhiều nhân vật |
| `characters` | id, account_id, name, school, class, level, exp, yen, map_id, x, y, stats(jsonb), last_login | `stats` chứa chỉ số đã tính |
| `char_skills` | char_id, skill_id, skill_level | chiêu đã học |
| `items` | id, owner_id, template_id, qty, upgrade_level, bound, slot, meta(jsonb) | vật phẩm trong túi/kho/trang bị |
| `quest_progress` | char_id, quest_id, state, progress(jsonb) | nhiệm vụ |
| `friends` | char_id, friend_id, status | bạn bè |
| `guilds` | id, name, level, exp, notice, created_at | bang hội |
| `guild_members` | guild_id, char_id, rank, joined_at | thành viên |
| `mails` | id, to_char_id, from_name, title, body, attach(jsonb), is_read, expires_at | thư + quà |
| `arena_rank` | char_id, season, rating, wins, losses | Lôi Đài |
| `daily_limits` | char_id, kind, count, day | giới hạn theo ngày (boss, sự kiện) |
| `audit_logs` | id, actor, action, meta(jsonb), created_at | đối soát |
| `trade_logs` | id, kind, payload(jsonb), created_at | giao dịch quan trọng |

### 6.2 Dữ liệu nội dung (game-data, JSON)

| Loại | File ví dụ | Trường chính |
|---|---|---|
| Bản đồ | `maps/map-lang-khoi-nguon.json` | kích thước, tileset, lớp gạch, cổng dịch chuyển, điểm spawn, NPC |
| Quái | `monsters/mob-quai-xanh.json` | máu, sát thương, tốc độ, EXP, Yên, bảng rơi đồ, thời gian hồi sinh |
| Vật phẩm | `items/item-kiem-go.json` | loại, ô trang bị, chỉ số, cấp yêu cầu, giá, mốc cường hóa |
| Chiêu thức | `skills/skill-otama.json` | hệ, sát thương gốc, hệ số, năng lượng, hồi chiêu, hiệu ứng, số mục tiêu |
| Nhiệm vụ | `quests/quest-chao-lang.json` | cấp yêu cầu, các bước (nói chuyện/đánh/thu thập), thưởng |
| Trường/phái | `classes/school-haruna.json` | danh sách phái, hệ số chỉ số khi lên cấp, trang bị khởi đầu |

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

## 7. Phiên bản protocol & tương thích

- `shared/src/protocol/version.ts` chứa `PROTOCOL_VERSION` (số nguyên).
- Bắt tay `C2S_HELLO` gửi phiên bản; lệch → server từ chối kèm thông báo "hãy tải lại trang".
- Endpoint `GET /version` trả phiên bản server + client mong đợi (dùng cho màn hình bảo trì).
- Quy tắc: thay đổi protocol **chỉ** ở server hoặc client đều phải tăng `PROTOCOL_VERSION` trong cùng một lần merge.
