# server/ — Game server

**Trạng thái:** M0 (khung) + M1 (tài khoản & nhân vật) đã xong. WebSocket và các module nghiệp vụ khác sẽ thêm từ M2.

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
├── modules/
│   ├── account/         # service (đăng ký/đăng nhập/làm mới/đăng xuất) + route
│   └── character/       # service (tạo/liệt kê, giới hạn số lượng, chống trùng tên) + route
├── http/                # parseRequest (kiểm dữ liệu vào) + authenticate (preHandler)
├── security/
│   ├── password.ts      # Argon2id (mặc định của @node-rs/argon2: m=19456, t=2, p=1)
│   └── tokens.ts        # cấp/xoay/thu hồi refresh token
└── test/                # globalSetup + tiện ích database kiểm thử
```

### Quy tắc nghiệp vụ đã cài đặt

- Tên đăng nhập: 4–20 ký tự, chỉ chữ thường, chữ số, gạch dưới; **không phân biệt hoa thường** khi kiểm trùng (unique index trên `lower(username)`).
- Mật khẩu: 8–72 ký tự, băm Argon2id; không bao giờ trả hash ra ngoài.
- Sai mật khẩu và tài khoản không tồn tại trả **cùng một thông báo** (tránh dò tài khoản); khi tài khoản không tồn tại vẫn băm mật khẩu để thời gian phản hồi tương đương.
- Tên nhân vật: 3–12 ký tự chữ/số (cho phép tiếng Việt có dấu), duy nhất toàn máy chủ, không phân biệt hoa thường.
- Phái phải thuộc trường đã chọn (kiểm ở cả `shared` schema và ràng buộc CHECK trong database).
- Tối đa 4 nhân vật mỗi tài khoản (`MAX_CHARACTERS_PER_ACCOUNT` trong `shared`).

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

- WebSocket realtime, tick, room theo bản đồ (`net/`, `core/`, `world/`).
- Các module: `inventory`, `skill`, `battle`, `quest`, `npc`, `social`, `guild`, `arena`, `event`, `mail`, `admin`.
- Giới hạn tần suất (rate limit), khoá tài khoản sau nhiều lần sai, audit log.

## Nguyên tắc
1. Không tin client: kiểm tra vị trí, tốc độ, hồi chiêu, quyền sở hữu vật phẩm trước khi áp dụng.
2. Nghiệp vụ game nằm ở server; `shared/` chỉ chứa protocol/kiểu dữ liệu/hằng số.
3. Lưu dữ liệu theo lô (dirty flags + flush định kỳ), giao dịch (trade) dùng transaction.
4. Mọi thay đổi dữ liệu quan trọng ghi audit log.
