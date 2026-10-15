# tests/ — Kiểm thử toàn hệ thống

Test đơn vị và tích hợp của từng gói nằm trong chính gói đó (`shared`, `server`, `client`).
Thư mục này chứa kiểm thử **xuyên hệ thống**.

## Đã có: `tests/e2e` (Playwright, trình duyệt thật)

```bash
pnpm e2e        # build shared → chạy Playwright (tự khởi động server + client)
```

- Playwright tự chạy `pnpm --filter @ninja/server dev` và `pnpm --filter @ninja/client dev`
  (xem `tests/e2e/playwright.config.ts`), nên chỉ cần PostgreSQL đang chạy và database đã migrate.
- Mỗi lần chạy sinh tên tài khoản/nhân vật ngẫu nhiên nên không cần xoá dữ liệu cũ.
- Cài trình duyệt lần đầu: `pnpm --filter @ninja/e2e exec playwright install chromium`.

### Kịch bản (giai đoạn MVP)

| # | Kịch bản | Trạng thái |
|---|---|---|
| 1 | Đăng ký tài khoản mới → tạo nhân vật → vào trang nhân vật | ✅ có test |
| 2 | Tải lại trang vẫn giữ phiên; đăng nhập lại bằng mật khẩu đã đặt | ✅ có test |
| 3 | Sai mật khẩu bị chặn; phái không thuộc trường bị chặn | ✅ có test |
| 4 | Hai client cùng bản đồ nhìn thấy nhau và chat | chưa (M2) |
| 5 | Đánh hạ quái theo lượt → nhận EXP, rơi đồ, lên cấp | chưa (M3) |

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
