# M7 — bang hội, boss dã ngoại và sự kiện đầu tiên

## Quy tắc đang triển khai

- **Bang hội:** tên 3–24 ký tự chữ/số, dấu cách, `_` hoặc `-`; tên không phân biệt hoa thường; tối đa 20 thành viên và mỗi nhân vật chỉ ở một bang. Trưởng bang rời đi thì người tham gia lâu nhất còn lại kế nhiệm; bang trống bị xóa. Chat chỉ gửi tới thành viên. Mỗi chiến thắng boss cộng 25 XP cho mỗi bang có thành viên tham chiến (không nhân theo số thành viên); 100 XP lên một cấp, tối đa cấp 20.
- **Boss:** `mob-thu-vuong` xuất hiện ở `lang-khoi-nguon`. Mặc định mở từ phút `00:00` tới trước phút `15:00` của mỗi giờ UTC. Lịch có thể đổi bằng `FIELD_BOSS_INTERVAL_MINUTES`, `FIELD_BOSS_WINDOW_MINUTES` và `FIELD_BOSS_START_OFFSET_MINUTES`; offset tính từ chu kỳ UTC, `start` bao gồm và `end` không bao gồm. `FIELD_BOSS_WINDOW_MINUTES` không được dài hơn chu kỳ và offset phải nằm trong chu kỳ. Thử vào ngoài lịch trả `boss_closed`. Trận boss cho tối đa 3 người; PvE thường vẫn chỉ cho 2.
- **Giới hạn boss:** mỗi nhân vật nhận tối đa 1 `item-da-vun` từ boss trong một ngày UTC cho mỗi boss. Ngày khóa lấy từ UTC, đổi lúc `00:00 UTC`. Khóa duy nhất `(character_id, boss_id, utc_day)`, ghi khóa và cộng vật phẩm vào túi trong cùng transaction; concurrent settlement chỉ có một claim. Nếu túi đầy transaction rollback để người chơi có thể dọn túi và thử lại. Phần thưởng PvE cơ bản hiện có (EXP/yên) không nằm trong giới hạn vật phẩm boss.
- **Sự kiện đầu tiên:** bật mặc định; operator tắt bằng `M7_EVENT_ENABLED=false`. Đăng nhập nhận 100 yên + 1 `item-banh-bao` qua thư, một lần mỗi ngày UTC. Nhiệm vụ là hạ một quái; tiến độ chỉ đến từ quyết toán PvE thành công trên server, hoàn tất một lần và gửi 250 yên + 1 `item-tra-rung` qua thư. Khóa claim + thư và khóa nhiệm vụ + thư là idempotent; client không thể tự gửi tiến độ hay chọn phần thưởng.

## Giới hạn hiện tại

- Đây là một event đầu tiên luôn hoạt động khi được bật, không có ngày kết thúc hoặc lịch giờ riêng; ngày UTC chỉ áp dụng cho login claim. Có thể tắt bằng cấu hình môi trường.
- Boss hỗ trợ tối đa 3 người; PvE thường giữ giới hạn 2 người. HP của boss chưa được lưu toàn cục: room rỗng có thể bị loại bỏ và tạo lại trong cùng cửa sổ mở. Điều này không reset giới hạn vật phẩm đã lưu trong DB; phần EXP/yên PvE cơ bản không bị cap ở M7.
- UI cung cấp bảng bang, kênh chat bang, trạng thái event/boss và claim đăng nhập; người chơi nhận thưởng nhiệm vụ trong hộp thư sau khi hạ quái.

## Kiểm chứng

- Unit: UTC schedule start/end, UTC day reset, cấu hình boss.
- Server integration trên `ninja_test`: guild error codes, 20-member cap/leader transfer, 3 người chat bang, XP lên cấp, login duplicate + UTC reset, event disable, quest mail idempotency, và 8 settlement đồng thời chỉ cấp 1 boss item.
- Server admission regressions: concurrent join xác nhận đúng 3 người vào boss và người thứ tư bị `invalid_target`; ordinary PvE concurrent join vẫn đúng 2 người, người thứ ba nhận `invalid_target`; boss ngoài cửa sổ trả đúng `boss_closed` và không mở trận.
- Browser E2E được báo cáo đã chạy trên DB disposable `ninja_m7_e2e` sau khi migration áp dụng tường minh. Fixture chỉ đặt nhân vật test lên cấp 60 và HP/MP đầy trong DB này; mọi tấn công/đánh lượt diễn ra qua browser. Dedicated Playwright config buộc đúng tên DB, dùng cổng riêng (3307/4307 mặc định) và lịch boss 1/1 phút chỉ trên server E2E. Báo cáo trên nhánh coder: `pnpm --filter @ninja/e2e e2e --grep "M7:" --trace=off --workers=1 --reporter=line --timeout=120000` — 2/2 passed; gồm thắng trận, một `item-da-vun` mỗi nhân vật/ngày, 25 XP cho bang, hoàn tất nhiệm vụ tiến độ 1 và đúng một thư thưởng nhiệm vụ mỗi người. Đây là kết quả được báo cáo trên nhánh, chưa được xác minh độc lập trên revision tích hợp; E2E không chạy lại cho delta safety hiện tại và CI/verifier vẫn pending. Không dùng DB dev `ninja` hoặc cổng 3000/4200.

### DB disposable cho browser E2E (PowerShell)

Chỉ dùng PostgreSQL loopback `127.0.0.1:5432` và database có tên chính xác `ninja_m7_e2e`. Trước khi tạo, migrate, chạy hoặc xóa, xác nhận host/cổng và tên DB bằng lệnh bên dưới; nếu kết quả không khớp, dừng lại. Không chạy lệnh xóa trên database `ninja`, `ninja_test` hay bất kỳ DB nào khác. Mật khẩu ở ví dụ là giá trị dev trong `infra/README.md`; thay bằng mật khẩu local của bạn nếu khác.

```powershell
$env:PGPASSWORD = 'ninja_dev_password'
# Xác nhận đúng PostgreSQL loopback trước khi tạo DB:
psql -h 127.0.0.1 -p 5432 -U ninja -d postgres -c 'SELECT current_database(), inet_server_addr(), inet_server_port();'
# Chỉ chạy nếu ninja_m7_e2e chưa tồn tại; nếu đã tồn tại, bỏ qua lệnh này và kiểm tra DB bên dưới (không xóa/tạo lại):
createdb -h 127.0.0.1 -p 5432 -U ninja ninja_m7_e2e
$env:NINJA_E2E_DATABASE_URL = 'postgresql://ninja:ninja_dev_password@127.0.0.1:5432/ninja_m7_e2e'
$env:DATABASE_URL = $env:NINJA_E2E_DATABASE_URL
# Trước khi migrate, xác nhận đích chính xác; nếu sai database/host/cổng, dừng:
psql -h 127.0.0.1 -p 5432 -U ninja -d ninja_m7_e2e -c 'SELECT current_database(), inet_server_addr(), inet_server_port();'
pnpm db:migrate
# Xác nhận lại đích sau migration rồi chạy E2E; Playwright dùng riêng cổng 3307/4307 và không tái sử dụng server:
psql -h 127.0.0.1 -p 5432 -U ninja -d ninja_m7_e2e -c 'SELECT current_database(), inet_server_addr(), inet_server_port();'
pnpm --filter @ninja/e2e e2e --grep 'M7:' --trace=off --workers=1 --reporter=line --timeout=120000
```

Để dọn DB, trước hết dừng hẳn Playwright/E2E và mọi server E2E; xác nhận lại đúng `ninja_m7_e2e` trên `127.0.0.1:5432`, rồi chỉ chạy lệnh `dropdb` hard-code tên dedicated dưới đây. Không thay tên DB trong lệnh bằng `ninja` và không xóa DB khi E2E còn chạy.

```powershell
psql -h 127.0.0.1 -p 5432 -U ninja -d ninja_m7_e2e -c 'SELECT current_database(), inet_server_addr(), inet_server_port();'
# Chỉ chạy nếu kết quả xác nhận chính xác ninja_m7_e2e / 127.0.0.1 / 5432:
dropdb -h 127.0.0.1 -p 5432 -U ninja ninja_m7_e2e
Remove-Item Env:NINJA_E2E_DATABASE_URL, Env:DATABASE_URL, Env:PGPASSWORD
```
