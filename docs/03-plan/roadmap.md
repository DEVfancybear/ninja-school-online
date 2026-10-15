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
| Bundle sau M2 | khởi tạo **715,87 kB** (nén 153,95 kB); Phaser + trang chơi nằm trong lazy chunk riêng `play` **1,42 MB** (nén 306,06 kB). Số lệch ±0,01 kB giữa các lần build do tên file có hash |
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

### M3 — Chiến đấu theo lượt PvE (~2 tuần) — *kết thúc MVP*
Nội dung: chạm quái để vào trận, trận theo lượt có đồng hồ 30 giây/lượt, 1 chiêu đánh thường + 1–2 chiêu thức, máu/sát thương/năng lượng, EXP → lên cấp, rơi Yên/vật phẩm, hồi sinh.
**Xong khi:** một người chơi đánh hạ quái, lên ít nhất 3 cấp, nhận và sử dụng được vật phẩm rơi; 2 người chơi cùng vào một trận đánh chung một quái; server từ chối lệnh bất hợp lệ (đánh xa, hồi chiêu chưa xong).

### M4 — Hành trang & cường hóa (~1,5 tuần)
Nội dung: túi đồ, trang bị theo ô, mặc/tháo, shop NPC mua/bán bằng Yên, cường hóa +1 → +5 với tỷ lệ thành công, thông báo kết quả, audit log giao dịch.
**Xong khi:** mua trang bị ở shop, mặc vào thấy chỉ số tăng, cường hóa thành công/thất bại đúng tỷ lệ trong dữ liệu, tải lại trang vẫn giữ nguyên trạng thái.

### M5 — Nhiệm vụ chính tuyến chương 1 (~2 tuần)
Nội dung: hệ nhiệm vụ tổng quát (nhận/tiến độ/trả), 10–15 nhiệm vụ đầu (chào làng → bài học đầu tiên → bái sư), hội thoại NPC theo cây, thưởng EXP/Yên/vật phẩm, mở khóa tính năng theo mốc.
**Xong khi:** người chơi mới vào game hoàn thành được chuỗi nhiệm vụ đầu, nhận thưởng, không bị kẹt (kể cả khi thoát giữa chừng và đăng nhập lại).

### M6 — Xã hội & PvP (~2,5 tuần) — *kết thúc Alpha*
Nội dung: bạn bè, nhóm, chat thế giới/nhóm/riêng, Lôi Đài 1v1 có xếp hàng chờ và tính điểm, bảng xếp hạng (top cấp, top Lôi Đài), thư hệ thống.
**Xong khi:** hai người chơi đấu Lôi Đài, điểm được cập nhật, bảng xếp hạng hiển thị đúng; chat thế giới có giới hạn chống spam.

### M7 — Bang hội, boss, sự kiện (~2,5 tuần)
Nội dung: lập bang/tham gia/rời bang, chat bang, cấp bang; boss dã ngoại theo giờ có giới hạn rơi đồ/ngày; sự kiện đầu tiên (đăng nhập nhận quà + nhiệm vụ sự kiện).
**Xong khi:** lập bang 3 người, cùng đánh boss theo giờ, nhận quà sự kiện; bot/script không phá được giới hạn ngày.

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
