# server/ — Game server

**Trạng thái:** đã có khung (M0): `main.ts`, `app.ts` (`/health`, `/version`), `config/env.ts`. WebSocket và các module nghiệp vụ sẽ thêm ở M1 trở đi.

## Vai trò
Là **nguồn sự thật** của toàn bộ trò chơi: tài khoản, nhân vật, bản đồ, chiến đấu theo lượt, vật phẩm, nhiệm vụ, bang hội, xếp hạng, sự kiện.
Mọi hành động của người chơi đều được server kiểm tra hợp lệ trước khi áp dụng.

## Công nghệ dự kiến
- Node.js 20 LTS + TypeScript
- Fastify — HTTP API (đăng ký/đăng nhập, API phụ trợ, webhook)
- `ws` — WebSocket cho thời gian thực; tự quản room theo bản đồ và tick nội bộ
- zod — kiểm tra dữ liệu vào/ra; msgpackr — mã hóa gói tin
- PostgreSQL + Drizzle ORM (dữ liệu người chơi), Redis (phiên, pub/sub, bảng xếp hạng)
- pino (log), vitest (test)

## Cấu trúc dự kiến khi bắt đầu code
```text
server/
├── src/
│   ├── main.ts        # khởi động, nạp cấu hình, mở cổng HTTP + WS
│   ├── config/        # biến môi trường, nạp game-data, feature flags
│   ├── net/           # WS server, quản lý kết nối, mã hóa gói tin, xác thực
│   ├── core/          # tick scheduler, event bus, room manager, sinh ID
│   ├── world/         # thể hiện bản đồ, spawn quái, kiểm tra di chuyển, tầm nhìn
│   ├── modules/       # nghiệp vụ theo hệ thống (xem danh sách dưới)
│   ├── db/            # schema, migrations, repository
│   └── security/      # rate-limit, chống gian lận, audit log
└── package.json
```

Các module nghiệp vụ dự kiến trong `modules/`:
`account` (tài khoản), `character` (nhân vật, chỉ số, cấp), `inventory` (túi, trang bị, cường hóa), `skill` (chiêu thức), `battle` (đấu theo lượt, AI quái, rơi đồ), `quest` (nhiệm vụ), `npc` (hội thoại, shop), `social` (chat, bạn, nhóm), `guild` (bang hội), `arena` (lôi đài, xếp hạng), `event`, `mail`, `admin` (lệnh GM).

Ánh xạ chi tiết xem `docs/02-architecture/project-structure.md`.

## Nguyên tắc
1. Không tin client: kiểm tra vị trí, tốc độ, hồi chiêu, quyền sở hữu vật phẩm trước khi áp dụng.
2. Nghiệp vụ game nằm ở server; `shared/` chỉ chứa protocol/kiểu dữ liệu/hằng số.
3. Lưu dữ liệu theo lô (dirty flags + flush định kỳ), giao dịch (trade) dùng transaction.
4. Mọi thay đổi dữ liệu quan trọng ghi audit log.
