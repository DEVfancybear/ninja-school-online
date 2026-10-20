# Danh mục hệ thống game & mức ưu tiên cho bản web

*Mức ưu tiên dùng thang MoSCoW, gắn với lộ trình trong `docs/03-plan/roadmap.md`: **Must** = bắt buộc cho MVP (M0–M3), **Should** = có ở Alpha (M4–M6), **Could** = có thể ở Beta (M7–M8), **Won't** = chủ động không làm.*

## 1. Bảng hệ thống

| # | Hệ thống | Mô tả trong game gốc | Ưu tiên | Ghi chú cho bản web |
|---|---|---|---|---|
| 1 | Tài khoản & phiên đăng nhập | Đăng ký/đăng nhập, nhiều nhân vật | Must | JWT + refresh token; chống brute-force |
| 2 | Nhân vật & chỉ số | Tạo nhân vật, chọn trường/phái, cấp, EXP, điểm chỉ số | Must | 3 trường, 6 phái; cân bằng làm bằng dữ liệu |
| 3 | Bản đồ & di chuyển | Tilemap nhiều vùng, cổng chuyển map, điểm lưu | Must | Bắt đầu 2 map: làng + bãi luyện |
| 4 | NPC & hội thoại | NPC nhiệm vụ, shop, sư phụ dạy chiêu | Must | MVP (M2): hội thoại cơ bản; Alpha (M4–M5): shop, sư phụ dạy chiêu |
| 5 | Nhiệm vụ | Chính tuyến (bắt buộc theo cấp) + phụ tuyến | Should | Alpha (M5): chương 1 gồm 10–15 nhiệm vụ |
| 6 | Chiến đấu theo lượt (PvE) | Đánh quái dã ngoại, so tốc độ, chọn chiêu | Must | Server mô phỏng, client chỉ hiển thị |
| 7 | Kỹ năng (chiêu thức) | Chiêu cơ bản + chiêu chủ động, nâng cấp | Must | MVP (M3): đánh thường + 1–2 chiêu/phái |
| 8 | Vật phẩm & túi đồ | Trang bị, tiêu hao, nguyên liệu, kho | Must | MVP (M3): túi cơ bản, dùng vật phẩm rơi; Alpha (M4): trang bị theo ô, mặc/tháo |
| 9 | Tiền tệ | Yên (tiền chính), vật phẩm quý | Must | Chỉ Yên ở MVP |
| 10 | Cường hóa trang bị | Nâng +1 → +16, tỷ lệ thành công, Bảo hiểm giữ +14 | Should | Alpha (M4): +1 → +5; mốc +16 và bảo hiểm để sau (Could) |
| 11 | Shop NPC | Mua/bán trang bị, tiêu hao | Should | Một shop/làng |
| 12 | Chat | Chat khu vực/thế giới/nhóm/bang/riêng | Must | MVP (M2): chat khu vực; Alpha (M6): thế giới/nhóm/riêng + lọc, chống spam |
| 13 | Bạn bè & nhóm | Kết bạn, lập nhóm đánh quái | Should | Alpha (M6): nhóm chính thức (tối đa 4); MVP chỉ cần 2 người cùng vào một trận |
| 14 | Lôi Đài (PvP) | Đấu trường xếp hạng 1v1 | Should | Alpha (M6): xếp hàng chờ 1v1 từ cấp 3; điểm Elo khởi đầu 1000, K = 32, sàn 100 (`shared/src/constants/arena.ts`) |
| 15 | Bảng xếp hạng | Thiên Địa Bảng: top cấp, top lực chiến | Should | Alpha (M6): đọc PostgreSQL — top cấp và top Lôi Đài; Redis chưa dùng |
| 16 | Thư (mail) | Nhận quà hệ thống, thư người chơi | Should | Alpha (M6): hộp thư hệ thống kèm quà, mỗi thư nhận quà một lần; thư giữa người chơi để sau |
| 17 | Bang hội | Lập bang, thành viên, cấp bang, chiến bang | Could | Sau khi PvP ổn định |
| 18 | Boss dã ngoại | Boss theo giờ, giới hạn rơi đồ/ngày | Could | Kèm bảng thông báo |
| 19 | Sự kiện định kỳ | Trung thu, Tết... kèm chuỗi nhiệm vụ riêng | Could | Cơ chế: bật/tắt bằng dữ liệu |
| 20 | Thú cưỡi & tinh luyện | Thú cưỡi, trang bị thú cưỡi, tinh luyện | Could | Có thể thay bằng "linh thú" nguyên bản |
| 21 | Áo choàng & tinh luyện | Áo choàng + Tử tinh thạch | Could | Gộp vào hệ trang bị phụ |
| 22 | Trang trí/ngoại hình (skin) | Nhiều bộ ngoại hình theo sự kiện | Could | Bán bằng Yên trong game |
| 23 | Tài Xỉu (đỏ đen) | Minigame cá cược trong game gốc | **Won't** | **Cờ bạc — không tái hiện** vì pháp luật VN |
| 24 | Nạp tiền thật | Nạp thẻ/SMS | **Won't** | Ngoài phạm vi; chỉ tiền trong game |
| 25 | Auto / mod / tool ngoài | Auto đánh, mod client | **Won't** | Không cung cấp API hỗ trợ auto |

## 2. Chi tiết quan trọng cho việc triển khai

### 2.1 Chiến đấu theo lượt (hệ thống lõi)
Đề xuất mô hình để lập trình:
1. Gặp quái trên map → server tạo **trận đấu** (battle instance) giữa nhóm người chơi và 1–3 quái.
2. Xác định thứ tự lượt theo **tốc độ** (speed) của từng thực thể; hòa thì so ngẫu nhiên.
3. Mỗi lượt, người chơi chọn hành động: đánh thường / dùng chiêu / dùng vật phẩm / phòng thủ / bỏ chạy. Có **đồng hồ đếm ngược** (ví dụ 30 giây), hết giờ tự động "đánh thường" để trận không treo.
4. Server tính sát thương, hiệu ứng, hồi máu, cập nhật trạng thái rồi phát kết quả cho mọi người trong trận.
5. Kết thúc: tính EXP, Yên, bảng rơi đồ, cập nhật nhiệm vụ. Thua thì hồi sinh về điểm lưu (mất một phần EXP/nhỏ).

*Đã cài ở M3 (`docs/02-architecture/network-and-data.md` mục 2c) và khác đề xuất ở mấy chỗ:* mỗi trận
**một quái** (chưa có 1–3 quái) và **chưa có hành động "phòng thủ"**; chỉ số dùng sức mạnh/nhanh nhẹn/tinh
thần với `tấn công = 2 × sức mạnh + cấp`; thua **không mất kinh nghiệm** (mất 10% yên và hồi sinh ở làng
với 50% máu) vì M3 chưa có nhiệm vụ; đường cong kinh nghiệm để trong `shared/src/constants/battle.ts`
(cấp 4 cần tổng 238 kinh nghiệm) và số liệu quái trong `game-data/monsters/`.

### 2.2 Tiến trình cấp độ (định hướng nội dung)
- MVP (M0–M3): cấp 1 → 15 (đánh quái, lên cấp, 1–2 chiêu, dùng vật phẩm rơi).
- Alpha (M4–M6): cấp 1 → 45 (nhiệm vụ chính tuyến chương 1, trang bị + cường hóa +5, Lôi Đài, chat cộng đồng).
- Beta (M7–M8): cấp 1 → 70+ (bang hội, boss, sự kiện, nội dung cuối).
- Đường cong EXP và chỉ số sẽ để trong `game-data/classes/` (dự kiến) — chỉnh không cần build lại.

### 2.3 Kinh tế trong game
- Nguồn thu Yên: đánh quái, nhiệm vụ, bán vật phẩm, sự kiện.
- Nguồn tiêu Yên: mua trang bị/tiêu hao, cường hóa, sửa chữa (nếu có), dịch chuyển nhanh (nếu có).
- Chống lạm phát: giới hạn rơi Yên theo cấp quái; log mọi giao dịch lớn.

## 3. Điểm cần xác minh khi bắt đầu triển khai

Các chi tiết chưa chắc chắn, cần chơi thử game gốc hoặc tra wiki trước khi thiết kế số liệu:

- **(cần xác minh)** Bộ chỉ số chính xác của nhân vật (sức mạnh, thân pháp, linh hồn...) và công thức sát thương.
- **(cần xác minh)** Danh sách đầy đủ chiêu thức từng phái và yêu cầu cấp của từng chiêu.
- **(cần xác minh)** Số ô túi đồ/trang bị, các mốc cấp mặc trang bị.
- **(cần xác minh)** Chi tiết tinh luyện áo choàng, thú cưỡi (tỷ lệ, nguyên liệu).

*Lưu ý: các số liệu này chỉ dùng để tham khảo cho thiết kế nguyên bản của chúng ta — không sao chép nguyên bảng số từ game gốc.*
