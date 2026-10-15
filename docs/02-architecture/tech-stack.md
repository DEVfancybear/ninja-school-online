# Bộ công nghệ (web-first)

*Ngày viết: 2026-10-15. Nền tảng đã chốt: **chơi trên web** (trình duyệt desktop + mobile web).*

## 1. Yêu cầu kỹ thuật rút ra từ nghiên cứu

| Yêu cầu | Chi tiết |
|---|---|
| Chạy trên web | Mở link là chơi; không cần tải app; chạy trên điện thoại yếu |
| 2D, chiến đấu theo lượt | Render 2D tilemap + sprite; logic trận đấu theo lượt (không cần vật lý phức tạp) |
| Nhiều người chơi | Đồng bộ vị trí/chat theo thời gian thực; nhiều bản đồ; vài trăm người chơi đồng thời ban đầu |
| Dữ liệu nội dung lớn | Nhiều bản đồ, quái, vật phẩm, chiêu, nhiệm vụ → phải **data-driven**, chỉnh không cần build lại |
| Chống gian lận | Server là nguồn sự thật (bài học từ client PC của game gốc) |
| Vận hành rẻ | Chạy được trên 1 VPS Linux; mở rộng sau |

## 2. Stack đề xuất (mặc định)

### 2.1 Tổng quan
- **Ngôn ngữ:** TypeScript (strict) cho cả client, server, shared → một ngôn ngữ, một bộ kiểu, ít lỗi giao tiếp.
- **Monorepo:** pnpm workspaces (client, server, shared cùng repo, cùng version protocol).

### 2.2 Client (trình duyệt)
| Thành phần | Chọn | Lý do |
|---|---|---|
| Framework giao diện & ứng dụng | **Angular 22** (standalone component, signals, router) | Lo toàn bộ UI/HUD, định tuyến, trạng thái, DI; khuôn mẫu rõ ràng, hệ sinh thái ổn định |
| Render thế giới 2D | **Phaser 4**, nhúng trong một component Angular | Có sẵn tilemap, sprite, hoạt ảnh, camera; chỉ dùng cho phần vẽ thế giới |
| UI/HUD (túi, chat, nhiệm vụ) | **Template + CSS của Angular** phủ trên canvas | Dễ làm, dễ chỉnh, hiển thị tiếng Việt tốt; không phí công dựng UI trong engine |
| State client | **Angular signals + services** | Có sẵn trong framework, không cần thư viện ngoài |
| Build/dev | **Angular CLI** (`ng serve`, `ng build`) | HMR sẵn, cấu hình chuẩn của framework |
| Kiểm thử client | **Vitest qua `ng test`** (Angular 22 dùng sẵn) | Không phải dựng thêm cấu hình test |
| Âm thanh | howler.js (thêm khi cần) | Chuẩn web, dễ quản lý nhạc nền/hiệu ứng |
| PWA | `@angular/pwa` (thêm khi cần) | Cài lên điện thoại như app, cache tài nguyên |
| Điều khiển | Bàn phím (desktop) + joystick ảo + nút chiêu (touch) | Chơi được cả hai nền tảng |

### 2.3 Server (Node.js)
| Thành phần | Chọn | Lý do |
|---|---|---|
| Runtime | Node.js 22 LTS trở lên (đang dùng 24) + TypeScript 6.0 | Khớp ngôn ngữ với client; hệ sinh thái lớn |
| HTTP API | Fastify + zod | Nhanh, schema validation sẵn |
| Realtime | **ws** (WebSocket thuần), tự quản room + tick | Kiểm soát hoàn toàn luồng gói tin như server Java gốc; không "phép thuật" ẩn |
| Mã hóa gói tin | JSON (dev) → **MessagePack** (msgpackr) khi phát hành | Nhẹ băng thông, dễ debug khi phát triển |
| Xác thực | JWT (access ngắn hạn) + refresh token trong DB/Redis | Chuẩn web |
| Bảo mật mật khẩu | argon2/bcrypt | Bắt buộc |
| Log | pino (log có cấu trúc) | Truy vết lỗi và gian lận |

### 2.4 Dữ liệu
| Thành phần | Chọn | Lý do |
|---|---|---|
| CSDL chính | **PostgreSQL 16** | Tin cậy, transaction tốt cho giao dịch vật phẩm/tiền |
| ORM/migration | Drizzle ORM + drizzle-kit | Kiểu TypeScript đầy đủ, migration đơn giản |
| Cache/phiên/pub-sub | **Redis** | Phiên đăng nhập, chống spam, bảng xếp hạng (sorted set), pub/sub khi chạy nhiều tiến trình server |
| Dữ liệu nội dung game | JSON trong `game-data/`, validate bằng zod trong `shared/` | Chỉnh nội dung không cần build; dễ review qua git |

### 2.5 Hạ tầng & công cụ
| Mục | Chọn |
|---|---|
| Dev local | Docker Compose (PostgreSQL, Redis) + pnpm dev |
| Triển khai | VPS Ubuntu: nginx (TLS + file tĩnh + proxy WS) → Node.js server (systemd/PM2) + PostgreSQL + Redis |
| CI | GitHub Actions: lint → typecheck → test → build |
| Kiểm thử | Vitest (đơn vị), Playwright (e2e), k6 (tải) |
| Chất lượng code | ESLint + Prettier, TypeScript strict, commit theo Conventional Commits |

## 3. Phương án thay thế (nếu muốn đổi)

| Phương án | Khi nào nên chọn | Đánh đổi |
|---|---|---|
| **Angular thuần + Canvas 2D tự viết** | Muốn kiểm soát render mức thấp, không phụ thuộc engine nào | Phải tự làm tilemap, camera, hoạt ảnh — tốn nhiều thời gian hơn |
| **Angular thuần + DOM/CSS** | Chỉ cần bản đồ nhỏ, ít hiệu ứng | Khó mở rộng, hiệu năng kém khi đông người chơi |
| **React/Vue + Phaser** thay Angular | Đội đã quen framework khác | Angular đã được chọn nên chỉ cân nhắc khi đổi hướng |
| **Cocos Creator 3** (client) | Muốn dựng cảnh/hoạt ảnh bằng editor, xuất web + mobile nhanh, phổ biến ở VN | Phụ thuộc editor; khó cho quy trình code/agent hơn |
| **PixiJS** (client) | Muốn kiểm soát render mức thấp, cần engine rất nhẹ | Phải tự làm tilemap/input/scene nhiều hơn |
| **Java 17 + Netty** (server) | Muốn bám sát kiến trúc server gốc để học | Hai ngôn ngữ, hai hệ sinh thái; chậm hơn cho đội nhỏ |
| **Colyseus** (server) | Muốn framework room/state sync làm sẵn, giảm việc tự viết | Luồng dữ liệu bị framework chi phối, khó tùy biến sâu |
| **Unity WebGL** | Muốn 3D hoặc tái dùng kỹ năng Unity | Build nặng, tải chậm trên web — **không khuyến nghị** cho game 2D theo lượt |

> Ghi chú: các phương án đều **giữ nguyên client web**; chỉ thay phần công nghệ tương ứng.
> **Đã chốt (2026-10-15):** client dùng **Angular + Phaser** — Angular là framework chính, Phaser chỉ vẽ thế giới 2D.

## 4. Môi trường phát triển (máy Windows)

1. Cài **Node.js 22 LTS trở lên** (khuyến nghị qua `fnm` hoặc `nvm-windows`).
2. Cài **pnpm** (`npm install -g pnpm`), **Git**, **VS Code**.
3. Cài **Docker Desktop** (chạy PostgreSQL + Redis cho máy dev).
4. Công cụ đồ họa gợi ý: **Aseprite** (pixel art), **Tiled** (bản đồ), **Audacity** (âm thanh).
5. Công cụ AI hỗ trợ không bắt buộc.

## 5. Việc cần bạn xác nhận trước khi code

- [x] **Angular + Phaser + Node.js + PostgreSQL + Redis + Docker** — đã chốt ngày 2026-10-15.
- [ ] Đồng ý dùng **MessagePack** cho gói tin khi phát hành (dev vẫn JSON để dễ debug)?
- [ ] Có cần hỗ trợ **PWA** (cài lên điện thoại) ngay từ MVP không?
