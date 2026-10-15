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
| `pnpm build` | OK — bundle khởi tạo 212 kB; Phaser nằm trong lazy chunk riêng |
| `pnpm validate:data` | OK — kiểm 2 file trong `game-data/` |
| Chạy `node server/dist/main.js` rồi `curl /health` | 200 `{"status":"ok","protocolVersion":1,...}` |

**Chưa kiểm chứng được:** `docker compose up` (máy dev chưa cài Docker — cần bước này trước khi làm M1), và phần vẽ thật của Phaser (chưa có test tự động, xem `client/README.md`).

**Ghi chú:** CI trên GitHub chạy lại đúng các bước trên từ **checkout sạch**. Lần chạy đầu tiên đã phát hiện một lỗi thật mà máy dev che mất: `validate:data` cần `shared` đã build (máy dev có sẵn `shared/dist`). Đã sửa bằng script gốc `build:shared`.

### M1 — Tài khoản & nhân vật (~1,5 tuần)
Nội dung: đăng ký/đăng nhập (argon2 + JWT), tạo nhân vật (chọn trường/phái, kiểm tra trùng tên), danh sách nhân vật; màn hình login + chọn nhân vật trên web; schema + migration ban đầu.
**Xong khi:** tạo tài khoản mới trên trình duyệt, tạo được nhân vật, đăng nhập lại vẫn thấy nhân vật; mật khẩu sai bị chặn; dữ liệu nằm đúng trong PostgreSQL.

### M2 — Thế giới, di chuyển, chat (~2 tuần)
Nội dung: 2 bản đồ đầu tiên (làng khởi nguồn + bãi luyện tập), tilemap hiển thị, di chuyển (bàn phím + chạm), đồng bộ người chơi giữa nhiều client, chat khu vực, NPC đầu tiên (hội thoại).
**Xong khi:** 2 người chơi ở 2 máy khác nhau cùng vào bản đồ, thấy nhau di chuyển mượt, chat qua lại; đóng trình duyệt thì nhân vật biến mất khỏi map người kia.

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
