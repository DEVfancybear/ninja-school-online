# tests/ — Kiểm thử toàn hệ thống

**Trạng thái:** trống, chưa có mã nguồn.
(Test đơn vị của từng gói nằm trong chính gói đó — `client`, `server`, `shared`.)

## Dự kiến
```text
tests/
├── e2e/     # Playwright: đăng nhập → tạo nhân vật → vào map → đánh quái → nhận thưởng
└── load/    # k6: mô phỏng 100–500 người chơi đồng thời (vào map, chat, đánh quái)
```

## Kịch bản e2e tối thiểu (theo lộ trình — kịch bản 1–3 thuộc MVP, 4–5 bổ sung ở Alpha)
1. Đăng ký tài khoản mới → tạo nhân vật → vào bản đồ đầu tiên.
2. Hai client cùng map nhìn thấy nhau và chat qua lại.
3. Đánh hạ một con quái theo lượt → nhận EXP + rơi đồ → lên cấp.
4. Nhận và hoàn thành nhiệm vụ đầu tiên.
5. Cường hóa một trang bị thành công.

## Nguyên tắc
1. e2e chạy được với môi trường dựng bằng Docker Compose.
2. Kiểm thử tải đặt mục tiêu rõ: 200 CCU ổn định, độ trễ gói tin < 200 ms trong nước.
