# Nguồn tham khảo & bài học kỹ thuật

*Ngày viết: 2026-10-15.*

## 1. Nguồn chính thức của game gốc

| Nguồn | Dùng để tra cứu |
|---|---|
| https://ninjaschool.vn/ | Thông tin chính thức: giới thiệu, giấy phép, tin cập nhật cũ |
| https://my.teamobi.com/game/40/Ninja-School-Online-0.html | Trang cộng đồng TeaMobi: bảo trì, sự kiện đang diễn ra |
| https://play.google.com/store/apps/details?id=com.team.njonline | Mô tả bản Android |
| https://ninjaschool.fandom.com/vi/wiki/Ninja_School_Online_Wiki | Wiki cộng đồng: chiêu thức, nhiệm vụ, quái |
| https://nubagame.com/thu-vien-nso/ | Thư viện nhiệm vụ, thông tin trường học |
| https://nsopremium.com/ | Hướng dẫn chơi, nhiệm vụ phụ |

## 2. Source cộng đồng (chỉ để HỌC kiến trúc — không dùng lại)

### 2.1 Server Java (nhóm `NSO_HOIUC`)
- Nguồn: https://github.com/hieptran159/NSO_HOIUC (ghi chú "Copy right: internet")
- Cấu trúc: dự án Java NetBeans (Ant `build.xml`, `nbproject/`), chạy bằng `run.bat`, cấu hình `ninja.conf`, schema MySQL `nso_acc.sql` + `nso_data.sql`, thư mục `lib/`, `res/`.
- Mã nguồn chính chia theo thư mục: `Event`, `History`, `Item`, `ItemHandleUse`, `Menu`, `TaiXiu`, `Task`, `Upgrade`, `assembly`, `cache`, `io`, `server`, `stream`, `template`, `thiendiabang`.
- **Bài học rút ra:**
  - Server gốc là **Java + socket + MySQL**, xử lý theo "gói tin" tuần tự, module hóa theo hệ thống (nhiệm vụ, vật phẩm, nâng cấp, sự kiện, tài xỉu, xếp hạng `thiendiabang`).
  - Đặt tên module theo tính năng (Item, Task, Upgrade...) là cách tổ chức dễ hiểu; bản web của chúng ta ánh xạ 1-1 thành `server/src/modules/*` (xem `project-structure.md`).
  - Sự tồn tại của module `TaiXiu` nhắc nhở: game gốc có cờ bạc trong game — chúng ta **không** làm lại (pháp lý).

### 2.2 Bộ cài server trên Android/Termux
- Nguồn: https://github.com/KhanhNguyen9872/Ninja_Server_Termux (GPL-3.0, ~158 sao)
- Nội dung: script cài để chạy server NSO trên Termux (Android) không cần root: **OpenJDK 17 + MariaDB + ngrok/localtunnel**.
- **Bài học:** xác nhận lại stack server gốc (Java 17, MySQL/MariaDB, HTTP phụ trợ). Đồng thời cho thấy giá trị của việc đóng gói môi trường chạy bằng script/Docker — bản web của chúng ta dùng **Docker Compose** vì lý do tương tự.

### 2.3 Client PC (bản v148)
- Nguồn: https://github.com/nomi-san/nso-pc ("NinjaSchool Online PC - Assembly source")
- Nội dung: mã client C# (Unity + .NET Core). README ghi rõ: **"almost actions do in client side and then send to server"** — tức là kiến trúc tin tưởng client.
- Các lớp tiêu biểu: `Main` (nạp tài nguyên), `GameScr` (màn hình game), `Char` (nhân vật), `Mob` (mục tiêu), `Service` (gửi gói tin lên server), `Resources`, `TileMap` (bản đồ), `mFont`/`mGraphics` (vẽ).
- **Bài học (quan trọng nhất):** vì xử lý nằm ở client, người chơi có thể chế auto, tấn công tầm xa, nhặt đồ từ xa... Bản web của chúng ta chọn **server-authoritative**: client chỉ gửi ý định, server kiểm tra và quyết định (xem `network-and-data.md`, mục chống gian lận).

### 2.4 Các repo khác (để tham khảo cấu trúc)
- https://gitlab.com/tabandroidjava/ninja-school — thư mục `Assets` (tài nguyên).
- https://github.com/nguyentientungduong/ninjaschool , https://github.com/HyVong007/NinjaSchool , https://github.com/Nghiait158/Ninjaschool_game — các bản sao chép/source học tập khác.

## 3. Cảnh báo pháp lý (đọc trước khi làm bất cứ điều gì)

- Năm **2026**, tại Việt Nam, cá nhân **Nguyễn Mạnh Cần** bị khởi tố vì **sao chép game Ninja School Online**, phát hành trái phép và thu lợi bất chính **~2,48–2,5 tỷ đồng**.
  Nguồn: https://thanhnien.vn/xam-pham-quyen-tac-gia-game-online-thu-loi-gan-25-ti-dong-185260812182949445.htm , https://dantri.com.vn/phap-luat/sao-chep-game-ninja-school-online-thu-loi-hon-24-ty-dong-20260813060728658.htm , https://doisongphapluat.com.vn/he-lo-chieu-tro-cua-ke-sao-chep-game-ninja-school-online-thu-loi-bat-chinh-gan-2-5-ty-dong-a730241.html
- "Private server" của game gốc — dù phi thương mại — vẫn là hành vi xâm phạm quyền tác giả khi công khai trên mạng.
- Hình ảnh/âm thanh/cốt truyện/tên gọi là **biểu hiện sáng tạo** được bảo hộ; riêng "ý tưởng gameplay" (đánh theo lượt, chia phái, làm nhiệm vụ) nói chung là tự do tham khảo.
- Phát hành game online tại Việt Nam cần **giấy phép cung cấp dịch vụ trò chơi điện tử trên mạng** (game gốc hiển thị giấy phép G1 trên trang chủ) và phê duyệt nội dung kịch bản — **(cần xác minh văn bản pháp luật hiện hành khi làm thủ tục)**.

### Quy tắc của dự án này
1. **Không** tải, chạy, sửa hoặc phát hành mã server/private server của game gốc.
2. **Không** dùng tài nguyên (hình, âm, chữ, cốt truyện) của NSO hay game khác.
3. **Không** dùng tên "Ninja School" cho sản phẩm; đặt tên và thế giới quan **nguyên bản**.
4. **Không** làm cờ bạc trong game (Tài Xỉu...), không làm nạp tiền thật trong giai đoạn học tập.
5. Nếu sau này muốn phát hành chính thức: hỏi luật sư về bản quyền + thủ tục cấp phép game tại Việt Nam.
