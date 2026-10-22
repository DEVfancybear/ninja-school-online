# M7 — bang hội, boss dã ngoại và sự kiện đầu tiên

## Quy tắc đang triển khai

- **Bang hội:** tên 3–24 ký tự chữ/số, dấu cách, `_` hoặc `-`; tên không phân biệt hoa thường; tối đa 20 thành viên và mỗi nhân vật chỉ ở một bang. Trưởng bang rời đi thì người tham gia lâu nhất còn lại kế nhiệm; bang trống bị xóa. Chat chỉ gửi tới thành viên. Mỗi chiến thắng boss cộng 25 XP cho mỗi bang có thành viên tham chiến (không nhân theo số thành viên); 100 XP lên một cấp, tối đa cấp 20.
- **Boss:** `mob-thu-vuong` xuất hiện ở `lang-khoi-nguon`. Mặc định mở từ phút `00:00` tới trước phút `15:00` của mỗi giờ UTC. Lịch có thể đổi bằng `FIELD_BOSS_INTERVAL_MINUTES`, `FIELD_BOSS_WINDOW_MINUTES` và `FIELD_BOSS_START_OFFSET_MINUTES`; offset tính từ chu kỳ UTC, `start` bao gồm và `end` không bao gồm. `FIELD_BOSS_WINDOW_MINUTES` không được dài hơn chu kỳ và offset phải nằm trong chu kỳ. Thử vào ngoài lịch trả `boss_closed`.
- **Giới hạn boss:** mỗi nhân vật nhận tối đa 1 `item-da-vun` từ boss trong một ngày UTC cho mỗi boss. Ngày khóa lấy từ UTC, đổi lúc `00:00 UTC`. Khóa duy nhất `(character_id, boss_id, utc_day)`, ghi khóa và cộng vật phẩm vào túi trong cùng transaction; concurrent settlement chỉ có một claim. Nếu túi đầy transaction rollback để người chơi có thể dọn túi và thử lại. Phần thưởng PvE cơ bản hiện có (EXP/yên) không nằm trong giới hạn vật phẩm boss.
- **Sự kiện đầu tiên:** bật mặc định; operator tắt bằng `M7_EVENT_ENABLED=false`. Đăng nhập nhận 100 yên + 1 `item-banh-bao` qua thư, một lần mỗi ngày UTC. Nhiệm vụ là hạ một quái; tiến độ chỉ đến từ quyết toán PvE thành công trên server, hoàn tất một lần và gửi 250 yên + 1 `item-tra-rung` qua thư. Khóa claim + thư và khóa nhiệm vụ + thư là idempotent; client không thể tự gửi tiến độ hay chọn phần thưởng.

## Giới hạn hiện tại

- Đây là một event đầu tiên luôn hoạt động khi được bật, không có ngày kết thúc hoặc lịch giờ riêng; ngày UTC chỉ áp dụng cho login claim. Có thể tắt bằng cấu hình môi trường.
- Boss dùng giới hạn co-op PvE hiện có (tối đa 2 người/trận). HP của boss chưa được lưu toàn cục: room rỗng có thể bị loại bỏ và tạo lại trong cùng cửa sổ mở. Điều này không reset giới hạn vật phẩm đã lưu trong DB; phần EXP/yên PvE cơ bản không bị cap ở M7.
- UI cung cấp bảng bang, kênh chat bang, trạng thái event/boss và claim đăng nhập; người chơi nhận thưởng nhiệm vụ trong hộp thư sau khi hạ quái.

## Kiểm chứng

- Unit: UTC schedule start/end, UTC day reset, cấu hình boss.
- Server integration trên `ninja_test`: guild error codes, 20-member cap/leader transfer, 3 người chat bang, XP lên cấp, login duplicate + UTC reset, event disable, quest mail idempotency, và 8 settlement đồng thời chỉ cấp 1 boss item.
- Server admission regressions: hai người cùng vào một boss trong cửa sổ; boss ngoài cửa sổ trả đúng `boss_closed` và không mở trận.
- Browser E2E M7 đã viết nhưng cần chạy trên DB/server dùng riêng; không chạy với DB dev `ninja`.
