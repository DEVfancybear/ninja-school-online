# tests/ — Kiểm thử toàn hệ thống

Test đơn vị và tích hợp của từng gói nằm trong chính gói đó (`shared`, `server`, `client`).
Thư mục này chứa kiểm thử **xuyên hệ thống**.

## Đã có: `tests/e2e` (Playwright, trình duyệt thật)

```bash
pnpm e2e                    # build shared → chạy Playwright (tự khởi động server + client)
pnpm --filter @ninja/e2e exec playwright install chromium   # cài trình duyệt (lần đầu)
```

Playwright tự chạy server (`pnpm --filter @ninja/server dev`) và client
(`pnpm --filter @ninja/client dev --host 0.0.0.0` — cần cờ này vì `ng serve` mặc định chỉ bind IPv6
`[::1]`, xem `tests/e2e/playwright.config.ts`), nên chỉ cần PostgreSQL đang chạy và database đã migrate.
Mỗi lần chạy sinh tên tài khoản/nhân vật ngẫu nhiên nên không cần xoá dữ liệu cũ.

### Kịch bản trong `src/auth-character-flow.spec.ts` (8 kịch bản)

| # | Kịch bản | Thuộc |
|---|---|---|
| 1 | Đăng ký → tạo nhân vật → tải lại trang vẫn còn phiên và còn nhân vật | M1 ✅ |
| 2 | Đăng xuất rồi đăng nhập lại bằng mật khẩu đã đặt thì thấy nhân vật cũ | M1 ✅ |
| 3 | Sai mật khẩu bị chặn, hiện thông báo, không rời trang đăng nhập | M1 ✅ |
| 4 | Biểu mẫu sai thì báo lỗi ngay trên trình duyệt và **không** gọi API | M1 ✅ |
| 5 | Chọn trường thì danh sách phái chỉ còn hai phái của trường đó | M1 ✅ |
| 6 | Tên nhân vật trùng (khác hoa thường, tài khoản khác) bị máy chủ từ chối | M1 ✅ |
| 7 | Tên nhân vật quá 12 ký tự bị chặn ngay trên trình duyệt | M1 ✅ |
| 8 | Đăng xuất thu hồi refresh token ở máy chủ: token cũ không dùng lại được | M1 ✅ |

Kịch bản thuộc các cột mốc sau (chưa có test): hai người chơi cùng bản đồ nhìn thấy nhau và chat (M2),
đánh hạ quái theo lượt rồi nhận EXP/rơi đồ/lên cấp (M3).

## Dự kiến thêm sau

```text
tests/
├── e2e/     # Playwright (đã có)
└── load/    # k6: mô phỏng 100–500 người chơi đồng thời — làm ở M8
```

## Nguyên tắc

1. e2e chạy được với môi trường dựng bằng Docker Compose hoặc PostgreSQL chạy sẵn trên máy.
2. Kiểm thử tải đặt mục tiêu rõ: 200 CCU ổn định, độ trễ gói tin trong nước < 200 ms.
3. e2e **không** chạy trong `pnpm test` (test đơn vị phải nhanh); chạy riêng bằng `pnpm e2e`.
   Gói `tests/e2e` cố tình không có script `test` để `pnpm -r test` bỏ qua nó.
