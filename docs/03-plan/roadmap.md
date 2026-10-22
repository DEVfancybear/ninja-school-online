# Lộ trình triển khai (M0 → M8)

*Ngày viết: 2026-10-15. Ước lượng thời gian mang tính tham khảo cho **1 lập trình viên làm toàn thời gian**, chưa tính thời gian làm tài nguyên đồ họa.*

## 1. Định nghĩa các cột mốc lớn

| Mốc | Nghĩa | Bao gồm |
|---|---|---|
| **MVP (demo chơi được)** | Chứng minh vòng lặp cốt lõi chạy thật trên web | M0 → M3 |
| **Alpha** | Đủ hệ thống chính để chơi vài giờ, còn thiếu nội dung | M4 → M6 |
| **Beta** | Đủ nội dung và hoạt động xã hội, mở cho nhóm thử | M7 → M8 |

## 2. Các cột mốc chi tiết

### M0 — Nền móng dự án (~1 tuần) — ✅ **ĐÃ XONG (2026-10-15)**
Nội dung: monorepo pnpm (`client`, `server`, `shared`, `tools/*`), tsconfig base, ESLint + Prettier, CI GitHub Actions, `docker-compose.dev.yml` (PostgreSQL + Redis), khung "hello world" (client mở trang, server trả `/health`), `tools/data-validator` chạy được.

**Đã giao:** monorepo pnpm 12 + workspace; `client` là ứng dụng Angular 22 + Phaser 4 (route `/` và `/play`); `server` Fastify có `/health` và `/version`; `shared` có `PROTOCOL_VERSION`, hằng số trường/phái, schema zod cho `skills`/`items`; `tools/data-validator` kiểm tra `game-data/` (đã có 2 file ví dụ); ESLint 10 (eslint + angular-eslint), Prettier, Vitest; `.github/workflows/ci.yml`; `infra/docker/docker-compose.dev.yml`.

**Xong khi:** `pnpm install && pnpm dev` trên máy sạch dựng được cả client và server; CI xanh; container DB/Redis chạy bằng 1 lệnh.

**Kiểm chứng đã chạy trên máy dev (Windows):**

| Lệnh | Kết quả |
|---|---|
| `pnpm install` | OK — `pnpm-workspace.yaml` có sẵn `allowBuilds` cho `@parcel/watcher`, `esbuild`, `lmdb`, `msgpackr-extract` nên không cần chấp thuận thủ công |
| `pnpm lint` | OK — 4/4 gói |
| `pnpm typecheck` | OK |
| `pnpm test` | OK — 20 test (shared 6, server 4, tools 4, client 6) |
| `pnpm build` | OK — lúc đó bundle khởi tạo 212 kB; Phaser nằm trong lazy chunk riêng |
| `pnpm validate:data` | OK — kiểm 2 file trong `game-data/` |
| Chạy `node server/dist/main.js` rồi `curl /health` | 200 `{"status":"ok","protocolVersion":1,...}` |

**Chưa kiểm chứng được:** `docker compose up` (máy dev chưa cài Docker — cần bước này trước khi làm M1), và phần vẽ thật của Phaser (chưa có test tự động, xem `client/README.md`).

**Ghi chú:** CI trên GitHub chạy lại đúng các bước trên từ **checkout sạch**. Lần chạy đầu tiên đã phát hiện một lỗi thật mà máy dev che mất: `validate:data` cần `shared` đã build (máy dev có sẵn `shared/dist`). Đã sửa bằng script gốc `build:shared`.

### M1 — Tài khoản & nhân vật (~1,5 tuần) — ✅ **ĐÃ XONG (2026-10-15)**

**Đã giao:**

- **Đăng ký / đăng nhập**: mật khẩu băm Argon2id; access token JWT 15 phút + refresh token 32 byte
  ngẫu nhiên lưu dạng băm SHA-256 và **xoay mỗi lần làm mới**; nút "Đăng xuất" gọi server để **thu hồi** refresh token.
- **Nhân vật**: tạo và liệt kê; tối đa 4 nhân vật mỗi tài khoản; tên duy nhất toàn máy chủ (không phân
  biệt hoa thường); phái phải thuộc trường đã chọn (chặn ở cả client, schema dùng chung và ràng buộc CHECK trong database).
- **Giao diện web**: trang `/login` (đăng nhập + đăng ký, kiểm dữ liệu ngay trên trình duyệt),
  trang `/characters` (danh sách + tạo nhân vật, có guard chặn khi chưa đăng nhập, giữ phiên qua `localStorage`).
- **Dữ liệu**: Drizzle ORM + PostgreSQL; bảng `accounts`, `characters`, `refresh_tokens`; migration
  đầu tiên do drizzle-kit sinh; `pnpm --filter @ninja/server db:migrate` để áp dụng.

**Xong khi:** tạo tài khoản mới trên trình duyệt, tạo được nhân vật, đăng nhập lại vẫn thấy nhân vật; mật khẩu sai bị chặn; dữ liệu nằm đúng trong PostgreSQL.

**Kiểm chứng đã chạy (máy dev, PostgreSQL 16 thật và trình duyệt thật):**

| Hạng mục | Kết quả |
|---|---|
| `pnpm test` | 119 test xanh — shared 20, server 41, client 54, tools 4 |
| `pnpm e2e` (Playwright, Chromium) | **8/8 kịch bản xanh**, gồm luồng đăng ký → tạo nhân vật → tải lại trang vẫn còn phiên và kịch bản chứng minh đăng xuất thu hồi token |
| `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm validate:data` | đều exit 0 |
| Bundle sau M1 | khởi tạo **~706,7 kB** (nén ~151,8 kB); số lệch ±0,01 kB giữa các lần build do tên file có hash. Do thêm `HttpClient` và thời hạn yêu cầu; Phaser vẫn nằm trong lazy chunk riêng (1,39 MB) |
| Gọi API thật bằng curl | đăng ký 201, `/me` 200, tạo nhân vật 201, trùng tên 409, sai mật khẩu 401, chưa đăng nhập 401 |
| Kiểm trong PostgreSQL bằng psql | tài khoản có `password_hash` dạng `$argon2id$…`, nhân vật gắn đúng `account_id`, refresh token lưu dạng băm |

**Lỗi thật đã phát hiện và sửa trong quá trình kiểm chứng:**

1. `drizzle-kit` không nạp được `@ninja/shared` (chỉ có ESM) → thêm bản CommonJS (`dist-cjs`) cho thư viện dùng chung.
2. Lỗi vi phạm ràng buộc duy nhất của PostgreSQL nằm trong `cause` do Drizzle bọc lại → `isUniqueViolation` phải đi theo chuỗi `cause`, nếu không thì trùng tên trả 500 thay vì 409.
3. Trang `/login` hỏng khi mở trực tiếp: `withComponentInputBinding` gán `undefined` cho input `redirectTo`; đồng thời lỗi điều hướng bị nuốt thành thông báo chung nên che mất nguyên nhân. Đã tách phần điều hướng khỏi `try` của lời gọi API và xử lý trường hợp thiếu tham số.
4. `ng serve` chỉ bind IPv6 `[::1]` khiến Playwright không kết nối được `127.0.0.1` → phải chạy `--host 0.0.0.0`.

**Chưa kiểm chứng được:** `docker compose up` (máy dev chưa cài Docker — PostgreSQL đang chạy trực tiếp
từ bộ binaries, xem `infra/README.md`).

### M2 — Thế giới, di chuyển, chat (~2 tuần) — ✅ **ĐÃ XONG (2026-10-15)**

Nội dung: 2 bản đồ đầu tiên (làng khởi nguồn + bãi luyện tập), tilemap hiển thị, di chuyển (bàn phím + chạm), đồng bộ người chơi giữa nhiều client, chat khu vực, NPC đầu tiên (hội thoại).
**Xong khi:** 2 người chơi ở 2 máy khác nhau cùng vào bản đồ, thấy nhau di chuyển mượt, chat qua lại; đóng trình duyệt thì nhân vật biến mất khỏi map người kia.

**Đã giao:**

- **Hợp đồng mạng (`shared`, PROTOCOL_VERSION = 2)**: khung gói tin `{op, seq, payload}` dạng text JSON;
  bảng opcode + schema zod cho từng gói (`protocol/packets.ts`); codec `encodePacket`/`decodeEnvelope`;
  schema bản đồ/NPC; hằng số thế giới (nhịp tick 100 ms, tốc độ 160 px/s, giới hạn lệnh di chuyển 600 px,
  chat 200 ký tự / 1 giây, nhịp tim 5 s / 30 s, lịch sử chat 20 tin).
- **Máy chủ (`server`)**: WebSocket gắn **cùng cổng HTTP** ở `/ws`; bắt tay `C2S_HELLO` (JWT + chọn nhân
  vật theo `characterId`); room theo bản đồ (tạo khi có người, xoá khi rỗng); **một** `setInterval` 10 Hz
  dùng chung cho cả room lẫn quét heartbeat; di chuyển **server-authoritative** (kiểm khoảng cách, biên,
  ô bị chặn — client chỉ gửi điểm đích); đồng bộ thực thể (`S2C_ENTITY_ADD/REMOVE/MOVE`); chat có giới hạn
  tần suất + lịch sử gần nhất; hội thoại NPC; **cổng dịch chuyển tự kích hoạt khi đi bộ vào vùng cổng**;
  một nhân vật một kết nối (phiên cũ bị đẩy ra); heartbeat quá hạn thì dọn khỏi map.
- **Client (`client`)**: lớp socket (`game-socket.ts` — nối lại 1→15 s, ping/đo độ trễ, hàng đợi gói chờ
  bắt tay), trạng thái thế giới bằng signals, Phaser vẽ tilemap + thực thể có **nội suy** (server 10 Hz →
  vẽ 60 fps), điều khiển WASD/mũi tên, trang `/play` có HUD, khung chat, hộp thoại NPC, lớp phủ khi mất
  kết nối.
- **Dữ liệu nội dung**: 2 bản đồ JSON (`lang-khoi-nguon` 40×30, `bai-luyen-tap` 36×28) có cổng hai chiều,
  1 NPC có hội thoại; `tools/data-validator` kiểm thêm map/NPC và kiểm chéo cổng/NPC giữa các bản đồ.

**Kiểm chứng đã chạy (máy dev, PostgreSQL 16 thật và trình duyệt thật Chromium):**

| Hạng mục | Kết quả |
|---|---|
| `pnpm test` | **281 test xanh**: shared 47, server 87, client 137, tools/data-validator 10 |
| `pnpm e2e` (Playwright) | **13/13 kịch bản xanh** — 8 kịch bản M1 + 4 kịch bản thế giới (thấy nhau, thấy nhau di chuyển, chat qua lại, đóng tab thì biến mất, hội thoại NPC) + 1 kịch bản cổng (đi bộ sang bản đồ 2 rồi quay về) |
| `pnpm validate:data` | exit 0 — 5 file hợp lệ trong `game-data/` |
| `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm format:check` | đều exit 0 |
| Bundle sau M2 (đo lại sau khi thêm đồ họa hình khối) | khởi tạo **715,87 kB** (nén 154,10 kB); Phaser + trang chơi nằm trong lazy chunk riêng `play` **1,43 MB** (nén 308,26 kB). Số lệch ±0,01 kB giữa các lần build do tên file có hash |
| `pnpm install --frozen-lockfile` | OK — lockfile khớp (thêm `ws` + `@types/ws`) |
| Kiểm thử WebSocket | `server/src/net/ws.spec.ts`: 28 test trên server thật ở cổng 0, dùng client `ws` |

**Lỗi thật đã phát hiện và sửa trong quá trình kiểm chứng:**

1. **Không đi được sang bản đồ thứ hai** (lỗi nặng nhất): `S2C_ENTER_MAP` không chứa vùng cổng nên client
   không biết cổng nằm đâu, còn server chỉ đổi bản đồ khi nhận `C2S_ENTER_MAP` — gói mà client không bao
   giờ gửi khi đi bộ. Không test nào ở cả hai phía phủ đường "đi bộ vào cổng" nên lọt. Đã sửa bằng cách
   cho server tự phát hiện vùng cổng trong nhịp tick và dùng **chung một hàm chuyển map** với `C2S_ENTER_MAP`,
   kèm 2 test tích hợp + 1 kịch bản e2e.
2. **Phaser không vẽ tilemap nếu dữ liệu thế giới tới trước `create()`** — hiệu ứng Angular chạy ngay sau
   khi dựng cảnh, nên tilemap không bao giờ được vẽ. Đã sửa cho `create()` vẽ bản đồ trước khi áp thực thể.
3. **Đóng kết nối WebSocket trong `onClose` của Fastify là quá muộn** — `app.close()` treo khi còn kết nối
   WebSocket đang mở. Đã chuyển sang hook `preClose`, có test phủ.
4. **Câu chữ sai trong giao diện**: trang `/play` ghi "tối đa hai nhân vật" trong khi luật thật là **bốn**;
   nay lấy từ hằng số `MAX_CHARACTERS_PER_ACCOUNT` dùng chung.

**Chưa kiểm chứng được:** `docker compose up` (máy dev chưa cài Docker — PostgreSQL chạy trực tiếp từ bộ
binaries, xem `infra/README.md`); nhiều tiến trình máy chủ (chưa có Redis/pub-sub nên room chỉ nằm trong
một tiến trình); chưa có test tải 10 Hz.

### M3 — Chiến đấu theo lượt PvE (~2 tuần) — ✅ **ĐÃ XONG (2026-10-16)** — *kết thúc MVP*
Nội dung: chạm quái để vào trận, trận theo lượt có đồng hồ 30 giây/lượt, 1 chiêu đánh thường + 1–2 chiêu thức, máu/sát thương/năng lượng, EXP → lên cấp, rơi Yên/vật phẩm, hồi sinh.
**Xong khi:** một người chơi đánh hạ quái, lên ít nhất 3 cấp, nhận và sử dụng được vật phẩm rơi; 2 người chơi cùng vào một trận đánh chung một quái; server từ chối lệnh bất hợp lệ (đánh xa, hồi chiêu chưa xong).

**Đã giao:**

- **Hợp đồng (protocol v3)**: gói `C2S_ATTACK_MOB`, `C2S_BATTLE_ACTION`, `C2S_USE_ITEM` và
  `S2C_BATTLE_START/TURN/RESULT/END`, `S2C_CHARACTER`, `S2C_LEVEL_UP`, `S2C_INVENTORY_UPDATE`; thực thể
  `monster` có máu và hình dáng; **12 mã lỗi chiến đấu riêng theo từng nguyên nhân** (`out_of_range`,
  `in_battle`, `not_your_turn`, `skill_cooldown`, `not_enough_mp`, `item_no_effect`…).
- **Luật chiến đấu (server quyết định hết)**: thứ tự lượt theo tốc độ (hòa thì ngẫu nhiên), đồng hồ 30
  giây/lượt hết giờ thì tự đánh thường, quái ra đòn sau 800 ms, sát thương dao động ±10% và có 5% chí mạng
  (×1,5), luôn gây ít nhất 1 sát thương, hồi chiêu tính theo **vòng**, chạy thoát 50% ± 2% mỗi điểm nhanh
  nhẹn chênh lệch (kẹp 10–90%).
- **Chỉ số & tiến trình**: `tấn công = 2 × sức mạnh + cấp`, `phòng thủ = nhanh nhẹn / 2`, `tốc độ = nhanh
  nhẹn + cấp`; đường cong kinh nghiệm `30 × cấp^1,35` (cấp 4 cần tổng 238 kinh nghiệm = **ba con bù nhìn**
  ở bãi luyện tập); lên cấp thì máu/nội lực tối đa tăng theo và được cộng luôn vào máu hiện tại.
- **Túi đồ**: bảng `inventory_items`, sức chứa 40 loại, tạo nhân vật nhận yên và đồ khởi đầu của phái;
  dùng vật phẩm ngoài trận thì tự do, **trong trận là một lượt**.
- **Quái trên bản đồ**: mỗi chỗ đặt là một con riêng có máu, hồi sinh theo `respawnMs`, thanh máu hiện trên
  bản đồ; quái còn sống hồi đầy máu khi trận kết thúc (không đánh rồi bỏ chạy để ăn dần).
- **Giao diện**: bảng trận đấu (thẻ quái + người chơi, dòng lượt kèm đồng hồ đỏ khi còn dưới 5 giây, nút
  đánh thường/chiêu/vật phẩm/bỏ chạy khoá theo lượt–nội lực–hồi chiêu, nhật ký, bảng kết trận có thưởng),
  túi đồ, HUD có thanh máu/nội lực/kinh nghiệm và số yên.
- **Dữ liệu nội dung**: 3 phái (`classes/`), 3 loại quái (`monsters/`), 7 chiêu, 4 vật phẩm, 9 chỗ đặt quái
  trên 2 bản đồ; `tools/data-validator` và server dùng **chung một bộ luật liên-file** (`checkGameData`).

**Kiểm chứng đã chạy (máy dev, PostgreSQL 16 thật và trình duyệt thật Chromium):**

| Hạng mục | Kết quả |
|---|---|
| `pnpm test` | **339 test xanh**: shared 52, server 118, client 159, tools/data-validator 10 |
| `pnpm e2e` (Playwright) | **17/17 kịch bản xanh** — 13 kịch bản M1–M2 + 4 kịch bản M3 (đánh hạ quái và nhận thưởng, ba con liên tiếp để lên ba cấp rồi dùng vật phẩm rơi, hai người chung một trận, lệnh không hợp lệ bị từ chối) |
| `pnpm validate:data` | exit 0 — 20 file hợp lệ trong `game-data/` |
| `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm format:check` | đều exit 0 |
| Bundle sau M3 | khởi tạo **722,50 kB** (nén 155,18 kB); lazy chunk `play` **1,46 MB** (nén 315,32 kB) |
| Test chiến đấu qua WebSocket | `server/src/battle/combat.spec.ts`: **18 test** trên server thật (vào trận, luật lượt, chơi chung, thưởng, thua, chạy thoát, dùng vật phẩm lúc đầy máu, ngắt kết nối giữa trận) + 11 test công thức thuần ở `server/src/battle/engine.spec.ts` |
| Migration | `0001_inventory_and_vitals`: bảng `inventory_items`, cột `characters.hp`/`mp` (`null` = đang đầy) |

**Quyết định thiết kế đã chốt ở M3 (ghi lại vì ảnh hưởng các mốc sau):**

1. **Một trận một con quái.** Bấm vào con quái nào thì mở trận với đúng con đó; người thứ hai bấm cùng con
   thì **vào chung** trận (tối đa 2 người). Trận nhiều quái để mốc sau.
2. **Chỉ số chốt lúc vào trận**, không tính lại giữa trận (M3 chưa có trang bị dùng được).
3. **Học chiêu là hàm của phái và cấp** — không có bảng "chiêu đã học" riêng, nên dữ liệu chiêu là nguồn
   sự thật duy nhất.
4. **Thắng thì mỗi người nhận đủ thưởng** (không chia đều) — đơn giản và dễ kiểm chứng; nếu thấy lạm phát
   thì đổi ở mốc sau.
5. **Thua thì hồi sinh ở làng với 50% máu, mất 10% yên**, không mất kinh nghiệm (chưa có gì để mất ở M3).

### M4 — Trang bị theo ô, shop & cường hóa (~1,5 tuần) — ✅ **ĐÃ XONG (2026-10-16)**

**Nội dung:** 4 ô trang bị (vũ khí, áo, mũ, phụ kiện) cộng chỉ số vào nhân vật; shop mua/bán đồ; cường hóa tốn yên + nguyên liệu, tỉ lệ thành công theo cấp.

**Xong khi:** mua một món ở shop rồi mặc vào thấy chỉ số tăng; bán được món trong túi; cường hóa lên cấp và chỉ số tăng theo; mọi thao tác đi qua gói tin có kiểm tra quyền sở hữu; reload vẫn giữ trang bị.

**Đã giao:**
- **Hợp đồng chung (commit `8b913ee`, `PROTOCOL_VERSION` 4):** bảy gói tin mới — `C2S_EQUIP` 0x0403, `C2S_UNEQUIP` 0x0404, `S2C_EQUIPMENT` 0x0405, `C2S_SHOP_BUY` 0x0406, `C2S_SHOP_SELL` 0x0407, `C2S_UPGRADE` 0x0408, `S2C_UPGRADE_RESULT` 0x0409; `InventoryItem` thêm `slot`, `upgradeLevel`, `stats`, `levelRequired`, `price`, `sellPrice`, `upgradeMaxLevel`, `usable`; `EQUIP_SLOTS` (4 ô), `SELL_PRICE_RATIO` 0,4, `UPGRADE_MAX_LEVEL` 5, mỗi lần thử cường hóa tốn 1 đá + yên theo cấp hiện tại của món (`UPGRADE_YEN_COST` = 50/120/260/520/1000), `upgradeMaxLevelOf()`; mã lỗi `item_not_owned`, `not_equippable`, `level_too_low`, `already_owned`, `not_enough_yen`, `not_for_sale`, `item_equipped`, `not_upgradable`, `upgrade_maxed`, `not_enough_material`.
- **Server:** `inventory_items` thêm `upgrade_level` + `equipped_slot` kèm **unique index một phần** (`character_id, equipped_slot` khi ô khác null) nên một ô chỉ giữ được một món; bảng `transactions` ghi mọi giao dịch mua/bán/cường hóa; ba dịch vụ mới `EquipmentService`, `ShopService`, `UpgradeService`; chỉ số trang bị cộng vào **gốc** trước khi suy ra tấn công/phòng thủ/tốc độ/máu tối đa nên vào trận, dùng vật phẩm, thắng/thua/lên cấp đều đúng; `spendYen` là một câu UPDATE có điều kiện `yen >= amount` (không có kẽ hở kiểm-rồi-trừ).
- **Client:** bảng trang bị 4 ô (nút **Tháo**), bảng shop (**Mua**/**Bán**, giá, yêu cầu cấp, tỉ lệ bán 40%), nút **Cường hóa** trong túi (hiện yên + tỉ lệ, tự khoá khi chạm trần), thông báo kết quả; HUD thêm nút **Trang bị**; bảng túi hiện cấp `+N`, chỉ số và giá bán.
- **Dữ liệu:** NPC `npc-thay-do` (Thầy Đồ) bán 8 món; đá vụn rơi từ quái (Bù Nhìn 40%, Chuột Đồng 70%, Heo Rừng 80%) — muốn cường hóa phải đi đánh quái lấy đá.
- **Migration:** `server/drizzle/0002_trang_bi_shop_cuong_hoa.sql`.

**Kiểm chứng đã chạy trên máy dev (Windows, PostgreSQL thật + Chromium thật):**

| Lệnh | Kết quả |
|---|---|
| `pnpm test` | ✅ **423 bài xanh** — shared 72 (5 file), server 162 (14 file), client 179 (20 file), data-validator 10 |
| `pnpm e2e` (Playwright, `NINJA_E2E_CLIENT_PORT=4300`) | ✅ **21/21** — 17 bài M1–M3 + 4 bài M4 (mua–mặc–tải lại, bán–đánh quái lấy đá–cường hóa, thiếu yên, mua lại món đã có) |
| `pnpm validate:data` | ✅ 26 file game-data hợp lệ |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` / `pnpm format:check` | ✅ exit 0 |
| Bundle client | khởi tạo **726,35 kB**, chunk `play` lazy 1,47 MB |

Riêng M4: server **44 bài** (equipment 10, shop 13, upgrade 9, WebSocket thật 12), client **+20 bài** (179 so với 159 của M3).

**Quyết định thiết kế đã chốt ở M4:**
1. **Túi = hàng `equipped_slot is null`** — mặc/tháo chỉ đổi cột trên đúng hàng cũ, không sinh hàng thứ hai nên túi đầy 40 loại vẫn mặc được (đã test).
2. **Server gửi lại `S2C_INVENTORY_UPDATE` sau mặc/tháo** — hợp đồng chỉ nêu `S2C_EQUIPMENT` + `S2C_CHARACTER`, nhưng thiếu gói túi thì client vẫn thấy món đang mặc nằm trong túi (lỗi chỉ lộ ra khi chạy e2e thật).
3. **Mua phải bấm NPC trước:** `C2S_SHOP_BUY`/`C2S_SHOP_SELL` không có `npcId`; server nhớ NPC vừa nói chuyện, nên luồng đúng là bấm NPC bán hàng rồi mới mua. Bán không cần quầy.
4. **Cường hóa trừ yên + đá trước khi gieo**; thiếu đá thì hoàn yên và **không** gọi `rng`; sổ giao dịch ghi **mọi lần thử** cường hóa — lượt gieo trượt cũng thành một hàng `transactions` vì vẫn mất yên + đá (test khẳng định cấp giữ nguyên, yên và đá đã trừ, `yenDelta` âm).
5. **Trần cường hóa theo món** qua `upgradeMaxLevelOf()` (món có thể khai trần riêng, không vượt trần chung 5).
6. **Bảng túi đồ nằm dưới thanh HUD** — trước đây nó che nút "Trang bị" trên HUD nên bấm không được.

**Ghi chú vận hành (máy dev):** sau khi sửa `shared/`, xoá `client/.angular/cache` trước khi chạy lại dev/e2e — Vite giữ bản `@ninja/shared` cũ trong cache nên trang chơi vỡ (`does not provide an export named 'EQUIP_SLOTS'`) và 13 bài e2e đỏ dù mã đúng. Chạy nhiều bộ test nặng **song song** có thể làm `pnpm test` đứng ở `server/src/battle/combat.spec.ts` (timeout của vitest không cắt được); chạy một mình thì cả bộ xanh (~143 s cho server).

**Sửa sau vòng kiểm chứng độc lập (2026-10-16):** verifier vòng 1 trả **FAIL** — CI đỏ ở `e1d05cb` (một bài `ws.spec.ts` chập chờn) và bài e2e cường hóa chập chờn (2/3 lần). Ba lỗi thật đã sửa, kèm hai chỗ tài liệu lệch mã (thiếu `already_owned`/`item_equipped` trong danh sách mã lỗi; câu về sổ giao dịch):
1. **`S2C_ENTITY_ADD` báo trễ** — gói báo người vừa vào map bị đẩy ra sau các lượt đọc database lúc bắt tay, nên người vào sau kịp nhận gói ADD của người vào trước; nay báo ngay trong cùng nhịp.
2. **`waitFor` khớp gói cũ** — bài "đi bộ vào vùng cổng" khớp nhầm gói ADD còn nằm trong bộ đệm rồi kiểm tra trước khi gói thật tới; thêm `TestGameClient.waitForSince(mark, ...)` chỉ tìm gói đến sau mốc.
3. **Bấm quái xa hơn một lệnh `C2S_MOVE` (600 px)** — client gửi đúng một lệnh nên server từ chối `too_far` và nhân vật đứng im (bài e2e farm đá vụn gặp cảnh này khi con gần nhất đã gục); nay client nối nhiều chặng ≤ 600 px cho tới khi vào tầm đánh.

### M5 — Nhiệm vụ chính tuyến chương 1 (~2 tuần) — ✅ **ĐÃ XONG (2026-10-19)**

**Nội dung:** hệ nhiệm vụ tổng quát (nhận/tiến độ/trả), 10–15 nhiệm vụ đầu (chào làng → bài học đầu tiên → bái sư), hội thoại NPC theo cây, thưởng EXP/Yên/vật phẩm, mở khóa tính năng theo mốc.

**Xong khi:** người chơi mới vào game hoàn thành được chuỗi nhiệm vụ đầu, nhận thưởng, không bị kẹt (kể cả khi thoát giữa chừng và đăng nhập lại).

**Đã giao:**
- **Hợp đồng chung (commit `c1b50a4`, `PROTOCOL_VERSION` 5):** ba gói tin mới — `C2S_QUEST_ACCEPT` 0x0601, `C2S_QUEST_COMPLETE` 0x0602, `S2C_QUEST_UPDATE` 0x0603; `C2S_NPC_TALK` thêm `optionId`, `S2C_NPC_DIALOG` thêm `nodeId`, `options[{id,text,next}]` (`next: null` = đóng hội thoại) và `quests: QuestView[]`; hằng số dùng chung `MAX_ACTIVE_QUESTS` 5, `QUEST_OBJECTIVE_KINDS` (talk/kill/reach/collect), `QUEST_VIEW_STATES` (available/active/ready/completed), `questFeatureLabel()`; tám mã lỗi nhiệm vụ (`quest_not_found`, `quest_locked`, `quest_already_active`, `quest_already_done`, `quest_too_many`, `quest_not_ready`, `quest_wrong_npc`, `dialog_not_open`); cây hội thoại trong `NpcSchema` (`when` theo nhiệm vụ/trạng thái/cấp, `next` trỏ đoạn kế trong cùng NPC); **12 nhiệm vụ** trong `game-data/quests/` (chào làng → đường tới bãi tập → bài học đầu tiên → hai nhánh Thầy Đồ và Hiệu Trưởng → bái sư) với `checkGameData` kiểm mục tiêu có thật, không vòng lặp `requiresQuests`, `next` cùng NPC.
- **Server (commit `1792fff`):** migration `0003_nhiem_vu.sql` (`character_quests` với `progress` jsonb theo thứ tự mục tiêu, unique cặp, FK cascade; `character_features`); `QuestService` (nhận/trả/trạng thái; `reach` cộng khi nhận, khi bắt tay, khi chuyển map và khi hồi sinh; `kill` cộng cho **mọi** người thắng trận; `collect` đếm lại từ túi và **không tiêu món**; thưởng exp/yên/vật phẩm; ghi cờ tính năng); `pickDialogNode` là hàm thuần chọn nhánh theo điều kiện; `WorldService` giữ hội thoại đang mở, kiểm đúng NPC, và **gửi lại `S2C_NPC_DIALOG`** sau khi nhận/trả thành công nên thẻ nhiệm vụ trong hội thoại tự cập nhật; trả nhiệm vụ khi túi đầy vẫn xong, món bị mất báo bằng `S2C_NOTIFY`.
- **Client (commit `41f0b6c`):** nhật ký nhiệm vụ trong HUD (đếm "Đã xong N … Đang làm M/5", dòng "Mở khóa: Lập nhóm, Lôi Đài", danh sách nhận được kèm tên NPC cho, dòng sẵn sàng trả kèm tên NPC), thẻ nhiệm vụ trong hội thoại (nút Nhận/Trả theo trạng thái, làm mới tại chỗ nhờ gói hội thoại gửi lại), thông báo mở khoá dùng `questFeatureLabel`.
- **Kiểm thử:** server **203** test, trong đó 25 test `QuestService` có bài chạy trọn 12 nhiệm vụ (chốt tổng thưởng 1260 exp / 1710 yên, cấp 7 với 227 exp dư, cờ `party`+`arena`, và **không nhiệm vụ nào trong game-data là không tới được**), 8 test chọn nhánh hội thoại, 8 test giao thức nhiệm vụ qua WebSocket (có bài khẳng định nhận/trả khi đang trong trận bị chặn bằng `in_battle`); client **196**; shared **92**; tools **14**; e2e **4 kịch bản M5** (người chơi mới làm hai nhiệm vụ đầu và thấy thưởng; thoát giữa chừng rồi đăng nhập lại vẫn giữ nhiệm vụ và tiến độ; hội thoại đổi nhánh theo trạng thái; nhánh Thầy Đồ trả xong mở khoá tính năng).

**Ghi chú thiết kế (đã ghi vào `docs/02-architecture/network-and-data.md` §2e):** nhận/trả chỉ khi đang mở hội thoại với đúng NPC ở bản đồ hiện tại; thứ tự lỗi khi nhận cố định (`quest_not_found` → `quest_wrong_npc` → `quest_already_active` → `quest_already_done` → `quest_locked` → `quest_too_many`) để câu báo lỗi luôn nói đúng lý do; `progress` chỉ lưu talk/kill/reach, còn `collect` đếm lại từ túi nên không có số nào để lưu; mỗi cờ tính năng chỉ ghi một hàng.

### M6 — Xã hội & PvP (~2,5 tuần) — *kết thúc Alpha*
Nội dung: bạn bè, nhóm, chat thế giới/nhóm/riêng, Lôi Đài 1v1 có xếp hàng chờ và tính điểm, bảng xếp hạng (top cấp, top Lôi Đài), thư hệ thống.
**Xong khi:** hai người chơi đấu Lôi Đài, điểm được cập nhật, bảng xếp hạng hiển thị đúng; chat thế giới có giới hạn chống spam.

**Đã giao:**
- **Hợp đồng v6:** opcode `0x0701–0x070d` cho xã hội/thư và `0x0801–0x0806` cho Arena/bảng xếp hạng; thêm `inventory_full` để claim thư khi túi đầy thất bại an toàn. Hằng số giới hạn, Elo và test hợp đồng nằm trong `shared/`.
- **Server:** migration `0004_social_arena_mail` tạo `friendships`, `character_arena`, `mails`; bạn bè kiểm trần 50 người cho cả hai phía và tuần tự hóa lời mời ngược chiều, tổ đội tối đa 4, chat theo kênh, bảng xếp hạng giới hạn 20 dòng. PvE/Arena giữ reservation trong admission và quyết toán; Elo thắng/thua cùng ghi trong một transaction. Claim thư khóa thư/nhân vật trong transaction; túi đầy giữ thư và quà chưa nhận.
- **Client:** giao diện và trạng thái bạn bè, tổ đội, chat, Arena/bảng xếp hạng và thư; dùng lại khung chiến đấu chung cho PvE/PvP.
- **Kiểm thử:** 212 server, 266 client, 116 shared, 14 data-validator (**608 test**); server có regression cho admission/cancel/disconnect, lỗi khởi tạo trận và rollback Elo, reservation lúc settlement, bạn bè ngược chiều đồng thời, party full và cooldown chat. Tổng 30 kịch bản e2e, trong đó 5 M6; M6 e2e chạy riêng 5/5 trên Chromium; bộ dò giao thức độc lập trên server thật đạt 43/43. Client build ban đầu khoảng 734,54 kB.
- **Kiểm chứng cuối tại chỗ:** `validate:data → lint → typecheck → test → build` PASS; 608 test (212 server / 266 client / 116 shared / 14 data-validator); M6 e2e 5/5; probe độc lập 43/43.
- **CI + kiểm chứng độc lập:** run [39658753709](https://github.com/DEVfancybear/ninja-school-online/actions/runs/39658753709), attempt 2, xanh trên commit `6fb961d`: 608 test, build xanh, Playwright **30/30** (5 kịch bản M6). Run [39663789185](https://github.com/DEVfancybear/ninja-school-online/actions/runs/39663789185) xanh trên SHA `da238d609b761f881e826f9558be0afe65ae3165`, gồm 608 test và Browser E2E **30/30**. CI cuối cho revision chứa mã nguồn [39666549405](https://github.com/DEVfancybear/ninja-school-online/actions/runs/39666549405) success trên đúng SHA `291781483f58380f6876009253302347953b63ed`, gồm lint, typecheck, test, build và Browser E2E; verifier `verifier-8fa5eff7` **PASS** trên cùng SHA. Sau đó, revision chỉ cập nhật roadmap `4e8dce1da4d4cda204891eb7ecd0b3920459687e` có run [39672353761](https://github.com/DEVfancybear/ninja-school-online/actions/runs/39672353761) success trên đúng SHA đó, gồm cả hai job, và verifier `verifier-976c0d16` **PASS** trên cùng revision. Revision docs-only `c93adede18f407e6d395a41458dfbe5a4b40bd7c` có run [39674588317](https://github.com/DEVfancybear/ninja-school-online/actions/runs/39674588317) success trên đúng SHA, gồm lint/typecheck/test/build và Browser E2E. Revision docs-only `1f8a740e3962f175364a5be1829a7361cd6ae140` sau đó có run [39676603199](https://github.com/DEVfancybear/ninja-school-online/actions/runs/39676603199) success trên đúng SHA (608 test, Browser E2E 30/30) và verifier `verifier-055d1622` **PASS** trên cùng SHA.

### M7 — Bang hội, boss, sự kiện (~2,5 tuần)
Nội dung: lập bang/tham gia/rời bang, chat bang, cấp bang; boss dã ngoại theo giờ có giới hạn rơi đồ/ngày; sự kiện đầu tiên (đăng nhập nhận quà + nhiệm vụ sự kiện).
**Xong khi:** lập bang 3 người, cùng đánh boss theo giờ, nhận quà sự kiện; bot/script không phá được giới hạn ngày.

**Trạng thái M7:** browser E2E cô lập trên `ninja_m7_e2e` PASS 2/2 (gồm boss victory/co-op); `pnpm run ci` PASS trên `main`. Verifier độc lập PASS trên revision `6b83edb7e01e0932d7b63c10312fa7eb7b630cd2`; M7 acceptance đã được xác minh trên checkout tích hợp.

### M8 — Hoàn thiện & triển khai (~2 tuần) — *kết thúc Beta*
Nội dung: âm thanh + hoạt ảnh đầy đủ, tối ưu mobile web (PWA), kiểm thử tải 200 CCU bằng k6, triển khai VPS (nginx + TLS + tên miền), sao lưu DB, trang trạng thái bảo trì.
**Xong khi:** triển khai công khai, 200 người chơi đồng thời ổn định, độ trễ gói tin trong nước < 200 ms, có kịch bản sao lưu/phục hồi dữ liệu.

## 3. Phạm vi MVP (chốt để không phình to)

Có trong MVP: đăng nhập, tạo nhân vật (3 trường/6 phái — chỉ số khác nhau, chiêu dùng chung khung), 2 map, NPC + chat, đấu lượt PvE, EXP/lên cấp, túi đồ cơ bản, rơi đồ.

**Không có trong MVP:** bang hội, Lôi Đài, boss, sự kiện, nhiệm vụ đầy đủ, cường hóa trên +5, thú cưỡi, áo choàng, nhiều bản đồ.

## 4. Ngoài phạm vi (chủ động không làm)

| Hạng mục | Lý do |
|---|---|
| Nạp tiền thật, cửa hàng thẻ | Ngoài mục tiêu học tập; rủi ro pháp lý/tài chính |
| Minigame cờ bạc (Tài Xỉu, đỏ đen...) | Vi phạm quy định về trò chơi có thưởng ngoài danh mục được phép |
| Hỗ trợ auto-play, API cho tool ngoài | Phá vỡ cân bằng; game gốc cũng bị vấn nạn này |
| Sao chép tài nguyên/cốt truyện của bất kỳ game nào | Bản quyền (xem `reference-sources.md`) |
| Đa máy chủ (nhóm server), liên máy chủ | Chưa cần ở quy mô demo; kiến trúc đã chừa chỗ mở rộng |

## 5. Rủi ro chính & cách giảm

| Rủi ro | Mức | Cách giảm |
|---|---|---|
| Bản quyền/thương hiệu | **Cao** | Nội dung nguyên bản 100% (không mã nguồn/tài nguyên/cốt truyện của game khác). **Tên sản phẩm hiện dùng trùng tên game gốc** — rủi ro thương hiệu, đã ghi ở `README.md` mục 6; đổi tên trước khi phát hành rộng rãi và tham vấn luật sư nếu phát hành chính thức |
| Phạm vi quá lớn (game MMO nhiều hệ thống) | **Cao** | Chốt MVP như mục 3; mỗi cột mốc phải chạy được end-to-end mới sang mốc sau |
| Gian lận (auto, mod) | Vừa | Kiến trúc server-authoritative + rate limit; không làm API hỗ trợ tool |
| Nội dung đồ họa/âm thanh | Vừa | Chọn phong cách pixel đơn giản; hoặc thuê/mua tài nguyên có license |
| Vận hành/chi phí máy chủ | Thấp | 1 VPS nhỏ cho đến khi vượt 200 CCU; dùng Redis/pub-sub để mở rộng ngang sau |
| Sai lệch protocol client/server làm hỏng phiên chơi | Thấp | `PROTOCOL_VERSION` trong `shared/`, handshake chặn lệch phiên bản |
| Bỏ dở giữa đường | Vừa | Cột mốc nhỏ, demo chạy được sớm (M0–M3 ≈ 6,5 tuần), tiến độ đo bằng "chơi được gì" |

## 6. Việc chuẩn bị (trạng thái hiện tại)
M0 đã xong, nên đây là trạng thái các việc chuẩn bị:

- [x] ~~Xác nhận stack~~ → **Angular + Phaser 4** + Node.js + PostgreSQL + Redis + Docker (chốt 2026-10-15).
- [x] ~~`git init` và commit đầu tiên~~ → đã init và đã push lên GitHub.
- [x] ~~Tên repo~~ → `ninja-school-online` (**trùng tên game gốc**; rủi ro đã ghi ở `README.md` mục 6 — còn phải quyết định có đổi tên trước khi phát hành hay không).
- [ ] Tên miền (nếu triển khai công khai).
- [ ] Chọn cách làm tài nguyên: tự làm / mua / thuê (xem `assets/README.md`).
- [ ] Chọn giấy phép mã nguồn cho repo (ví dụ MIT cho code — tài nguyên hình/âm có thể dùng license khác).

## 7. Nhật ký kiểm chứng theo cột mốc

| Cột mốc | Kiểm chứng | Bằng chứng |
|---|---|---|
| M0 | `validate:data → lint → typecheck → test → build` chạy trên **checkout sạch** (xoá hết `dist/`) | CI GitHub Actions xanh (run 38676875628, 38676965644); 20 test; bundle khởi tạo 211,86 kB |
| M1 | Chạy lại cả chuỗi CI trên cây đã xoá sạch artifact + `pnpm e2e` trên trình duyệt thật | CI xanh (run 38689008693); 119 test; 8/8 kịch bản e2e; commit `8a09cf5` |
| M2 | Chạy cả chuỗi CI + `pnpm e2e` **13 kịch bản** trên cây đã ghép hai phía (server + client) | 281 test; 13/13 kịch bản e2e; commit `c2e3aef` trên `main` |
| M2 (kiểm chứng độc lập) | Verifier riêng tự viết 6 script dùng `ws` + REST, dựng server trên cổng riêng 3120–3125, kiểm lại từng con số tài liệu và tự dựng lại các tình huống cổng/chat/chống gian lận | **VERDICT: PASS** — 20/20 + 21/21 + 19/19 kiểm tra đạt, không tìm thấy lỗi mã nguồn hay câu tài liệu nào nói sai thực tế |
| M3 | Chạy cả chuỗi CI + `pnpm e2e` **17 kịch bản** trên trình duyệt thật, có bài kiểm tra ba cấp và trận chung hai người | 339 test; 17/17 kịch bản e2e; commit `2b2ed2d` (client) + `40a9a0f` (hai lỗi thật, server 116 → 118 test) trên `main` |
| M4 | Chạy cả chuỗi CI + `pnpm e2e` **21 kịch bản** trên trình duyệt thật (trang bị theo ô, shop mua/bán, cường hóa, cổng bản đồ) | CI xanh (run 38915001066, rồi 38918946416 **không bài nào phải chạy lại**); **423 test**; 21/21 kịch bản e2e; commit `28b163e` trên `main` |
| M4 (kiểm chứng độc lập) | Ba vòng verifier riêng kiểm commit chốt: đối chiếu `git show`, chạy lại e2e M4 nhiều vòng, chạy lại `ws.spec.ts`, đối chiếu tài liệu với mã | **VERDICT: PASS** — vòng 1 (ở `e1d05cb`) FAIL vì CI đỏ + e2e chập chờn; vòng 2 (ở `165330d`) PASS, tự tìm thêm lỗi bấm quái xa hơn 600 px (sửa ở `28b163e`); vòng 3 (ở `e3e9413`) FAIL **chỉ vì tài liệu** (câu chi phí cường hóa sai, ô thứ ba ghi "giày", nit số test M3) nên mã + e2e vẫn ĐẠT; sửa ở `d779726`; vòng 4 (ở `d779726`) **PASS** — 423 test và 21/21 e2e trong CI sạch (run 38926128699, 0 bài phải chạy lại) |
| M5 | Chạy cả chuỗi CI trên commit chốt + `pnpm e2e` **25 kịch bản** (4 kịch bản nhiệm vụ) trên trình duyệt thật — cả trong CI lẫn trên máy dev | CI xanh **cả hai việc, không bài nào phải chạy lại** (run 39288510748 trên `997e6bf`): việc build **504 test** (server 202, client 196, shared 92, tools 14) và việc e2e **25/25** (4,3 phút). Lần chạy đầu trên `4fefbad` **đỏ** vì đúng một bài chat chập chờn (`server/src/net/ws.spec.ts:435` đọc gói của người gửi trước khi gói ấy tới) — sửa ở `997e6bf`, chạy lại xanh |
| M5 (kiểm chứng độc lập) | Verifier riêng kiểm commit chốt `5e334f6`: tự chạy lại shared/tools/client/`ws.spec.ts` 3 lần, `vitest list` đếm test, `playwright --list` + chạy từng kịch bản M5, rồi **tự viết script `ws`+`fetch`+`pg`** nói chuyện với server thật trên cổng riêng: 8 mã lỗi, luật gửi lại hội thoại, `collect` không tiêu món, `unlocks`, `reach` khi qua cổng, tối đa 5 nhiệm vụ, thoát rồi vào lại giữ tiến độ, DB/`character_features`; đối chiếu tài liệu ↔ mã | **VERDICT: PASS** — 24/25 điểm kiểm đạt ngay (điểm "trượt" là kỳ vọng của chính verifier sai: 30 exp của *Chào làng* đúng bằng mốc lên cấp 2 nên exp về 0); mọi con số trong mục M5 khớp số tự đo. Ba việc phải sửa, đã sửa ở `116a751`: §2e nói rõ `dialog_not_open` chỉ dành cho `optionId` (chưa mở hội thoại thì trả `quest_wrong_npc`), bỏ `game-data/shops/` không tồn tại khỏi `project-structure.md`, và thêm test khẳng định nhận/trả khi đang trong trận bị chặn bằng `in_battle` (server 203 test). CI sau khi sửa **xanh** (run 39292911665 trên `116a751`): **505 test** (server 203, client 196, shared 92, tools 14) + e2e **25/25** (5,6 phút), không bài nào phải chạy lại. Verifier không kiểm được: chạy nguyên bộ 25 e2e một lượt trên máy này (Chromium treo giữa chừng khi máy chia CPU) và chất lượng **hình ảnh** nhật ký/thẻ nhiệm vụ (không có vision) |
| M6 | CI đầy đủ, 608 test theo package, 30/30 e2e (5 M6); probe giao thức độc lập 43/43 tại chỗ; verifier độc lập PASS | [run 39663789185](https://github.com/DEVfancybear/ninja-school-online/actions/runs/39663789185): success trên `da238d6`, gồm 608 test (server 212, client 266, shared 116, data-validator 14) và 30/30 Browser E2E. CI cuối cho revision chứa mã nguồn [39666549405](https://github.com/DEVfancybear/ninja-school-online/actions/runs/39666549405) success trên đúng SHA `291781483f58380f6876009253302347953b63ed`, gồm lint/typecheck/test/build và Browser E2E; verifier `verifier-8fa5eff7` **PASS** trên đúng SHA này. Revision chỉ cập nhật roadmap `4e8dce1da4d4cda204891eb7ecd0b3920459687e` sau đó cũng được CI run [39672353761](https://github.com/DEVfancybear/ninja-school-online/actions/runs/39672353761) và verifier `verifier-976c0d16` xác nhận PASS trên cùng SHA. Revision docs-only `c93adede18f407e6d395a41458dfbe5a4b40bd7c` tiếp theo có CI run [39674588317](https://github.com/DEVfancybear/ninja-school-online/actions/runs/39674588317) success trên đúng SHA, gồm lint/typecheck/test/build và Browser E2E. Revision docs-only `1f8a740e3962f175364a5be1829a7361cd6ae140` sau đó có CI run [39676603199](https://github.com/DEVfancybear/ninja-school-online/actions/runs/39676603199) success trên đúng SHA: 608 test và Browser E2E 30/30; verifier `verifier-055d1622` PASS trên cùng SHA. Sau revision đó, bài E2E Arena kiểm thứ tự điểm giảm dần và điểm của đấu sĩ nào xuất hiện trong leaderboard toàn server (tối đa 20 dòng), không đòi cả hai đấu sĩ phải lọt top 20; kết quả/thành tích từng người được kiểm riêng qua gói kết trận. Build đầu 734,54 kB. |
