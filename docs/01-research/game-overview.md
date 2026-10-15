# Nghiên cứu: Ninja School Online là gì?

*Ngày viết: 2026-10-15. Mọi thông tin về game gốc đều kèm nguồn ở mục 11.*

## 1. Tóm tắt nhanh

| Hạng mục | Thông tin |
|---|---|
| Tên game | Ninja School Online (NSO), tên hiển thị "Thiếu Niên Anh Hùng – Ninja School" |
| Thể loại | MMORPG 2D nhập vai, **chiến đấu theo lượt**, chủ đề học viện ninja cổ trang |
| Nhà phát triển | **TeaMobi** (Việt Nam) |
| Phát hành | Gomobi (giấy phép G1 số 358/GP-BTTTT cấp 28/9/2023; quyết định nội dung số 288/QĐ-PTTH&TTĐT cấp 26/06/2025 — theo chân trang chủ) |
| Nền tảng gốc | Điện thoại: Java (J2ME), Android (`com.team.njonline`), iOS, Windows Phone; sau có bản PC |
| Thời điểm | Giới thiệu năm 2013, máy chủ đầu (Kunai) mở 20/3/2014, **vẫn vận hành tới nay (2026)** |
| Nhân vật | 3 ngôi trường, 6 phái (lớp nhân vật) |
| Đặc trưng | Ký ức tuổi thơ của thế hệ 8x/9x Việt Nam; nhẹ, chơi được trên máy yếu; cập nhật sự kiện đều đặn |

## 2. Bối cảnh và lịch sử

- **2013** — TeaMobi giới thiệu "Ninja School Online" bằng trailer demo trên nền tảng di động (video "Ninja School Online Game on Mobile 2013"), hướng tới người chơi phổ thông dùng điện thoại phổ thông (feature phone) và smartphone giá rẻ.
- **20/3/2014** — Mở máy chủ **Kunai** kèm sự kiện đua top (phần thưởng Bát bảo, Rương bạc, tiền Yên).
- **29–30/10/2014** — Bản cập nhật lớn: bảo hiểm nâng cấp trang bị (thất bại ở +16 không rớt về +14), hệ thống Cổ lệnh đi tới "làng truyền thuyết", Áo choàng + Tử tinh thạch tinh luyện qua NPC Kagai, chiến trường kẹo, giới hạn rơi đồ của boss vùng đất truyền thuyết 2 lần/ngày.
- **2023–2025** — Giấy phép phát hành G1 và quyết định phê duyệt nội dung được cấp cho đơn vị phát hành (Gomobi).
- **2026** — Game vẫn ra sự kiện định kỳ (ví dụ sự kiện Trung thu 22/9 – 15/10/2026 trên trang cộng đồng TeaMobi) và có **rất nhiều server cộng đồng/private** cùng các bản "H5/PC" do cộng đồng tự làm. Việc này có rủi ro pháp lý cao (xem `reference-sources.md`).

## 3. Nền tảng và các bản chơi

Theo trang tải chính thức (năm 2014), game có các bản: **Java (J2ME)** cho Nokia phổ thông, **Android** (APK và Google Play), **Windows Phone**, **PC (Windows XP–7)** và **iPhone**.
Điểm quan trọng cho dự án của chúng ta: game gốc được thiết kế cho **màn hình nhỏ, máy yếu, dung lượng thấp** — triết lý nhẹ và tối giản này rất phù hợp để tái hiện bằng **web (HTML5)**.

## 4. Gameplay cốt lõi (vòng lặp chính)

1. **Tạo tài khoản → tạo nhân vật → chọn trường và phái.**
2. **Nhập vai học viện**: chuỗi nhiệm vụ nhập môn (Nhiệm vụ chào làng → Bài học đầu tiên → nhiệm vụ vào trường ở Lv.8) dẫn người chơi vào thế giới.
3. **Cày cấp**: đánh quái theo lượt, làm nhiệm vụ chính tuyến (bắt buộc theo cấp) và phụ tuyến.
4. **Mạnh lên**: học/nâng chiêu thức, mua và cường hóa trang bị, tinh luyện áo choàng/thú cưỡi.
5. **Chơi cùng cộng đồng**: kết bạn, lập nhóm, bang hội, săn boss, leo bảng xếp hạng, sự kiện lễ hội.

Chuỗi nhiệm vụ chính tuyến gắn chặt với cấp độ: ví dụ tên nhiệm vụ theo yêu cầu cấp Lv.8, Lv.11, Lv.51, Lv.67, Lv.70 (dẫn chứng từ thư viện nhiệm vụ NSO), cho thấy nội dung game trải rộng tới **ít nhất cấp 70+**.

## 5. Ba ngôi trường và sáu phái

| Trường | Hai phái | Vùng nội dung |
|---|---|---|
| Trường **Haruna** | Đao, Quạt | chuỗi nhiệm vụ cấp 11–19 |
| Trường **Hirosaki** | Kiếm, Phi Tiêu | chuỗi nhiệm vụ cấp 11–19 |
| Trường **Ookaza** | Kunai, Cung | chuỗi nhiệm vụ cấp 11–19 |

Mỗi phái có bộ chiêu thức riêng; người chơi chọn phái ngay từ đầu và gắn bó với phong cách chiến đấu đó (cận chiến / tầm xa / hỗ trợ).

## 6. Chiến đấu và kỹ năng

- Chiến đấu **theo lượt**: chọn chiêu, so tốc độ để quyết định thứ tự, tính sát thương, hiệu ứng trạng thái.
- Hệ kỹ năng gồm **chiêu cơ bản** và **chiêu chủ động sử dụng**, cùng kỹ năng chủ động/bị động; người chơi nâng cấp chiêu theo cấp (wiki cộng đồng liệt kê ví dụ: Otama, Uzubatan, Yokobatan, Akaiame, Itotama, Hiyoko, Enchokuto, Uzusa, Ouchia...).
- Hai chế độ chính: **PvE** (đánh quái dã ngoại, boss) và **PvP** (Lôi Đài — đấu trường xếp hạng, PK vùng tranh chấp).

## 7. Kinh tế và trang bị

- Đơn vị tiền chính: **Yên**; kèm các loại quà/phần thưởng giá trị như **Bát bảo**, **Rương bạc**.
- **Cường hóa trang bị** đến +16, có **Bảo hiểm** giữ mốc +14 khi thất bại — cơ chế gây nghiện kinh điển.
- **Áo choàng** tinh luyện bằng **Tử tinh thạch** (qua NPC Kagai).
- **Thú cưỡi** và trang bị cho thú cưỡi có tinh luyện riêng.

## 8. Hoạt động cộng đồng và cạnh tranh

- Chat thế giới/khu vực/bang hội/nhóm, kết bạn.
- **Bang hội**: lập bang, hoạt động chung, săn boss bang.
- **Boss dã ngoại** theo khung giờ, giới hạn rơi đồ (2 lần/ngày với boss vùng đất truyền thuyết).
- **Lôi Đài** — đấu trường PvP xếp hạng; nhiều người chơi coi đây là "end-game".
- **Bảng xếp hạng Thiên Địa Bảng** (top cấp, top lực chiến...).
- **Sự kiện lễ hội** quanh năm (Trung thu, Tết, quốc khánh...) kèm chuỗi nhiệm vụ riêng.

## 9. Vì sao game gốc sống lâu (quan sát để học hỏi)

- Yêu cầu cấu hình cực thấp, phù hợp điện thoại phổ thông thời 2013–2016.
- Vòng lặp "nhiệm vụ → lên cấp → mạnh hơn → hoạt động cộng đồng" rõ ràng, không cần hướng dẫn phức tạp.
- Cập nhật sự kiện đều đặn + cộng đồng bang hội mạnh giữ người chơi lâu năm.
- Ký ức tuổi thơ: nhiều thế hệ 8x/9x gắn bó, tạo làn sóng server cộng đồng khi game chậm cập nhật.

## 10. Chúng ta học gì — và KHÔNG sao chép gì

**Học được (ý tưởng, không được bảo hộ độc quyền):**
- Vòng lặp gameplay, cấu trúc hệ thống, cách chia trường/phái, cách gắn nhiệm vụ với cấp độ.
- Triết lý thiết kế: nhẹ, thao tác đơn giản, chạy tốt trên thiết bị yếu.

**Không được sao chép (có thể vi phạm bản quyền/thương hiệu):**
- Mã nguồn game gốc hoặc mã nguồn rò rỉ/private server.
- Hình ảnh, âm thanh, cốt truyện, hội thoại, tên nhân vật, tên chiêu thức của NSO. (Về tên sản phẩm, xem ghi chú ở `README.md` mục 6.)
- Toàn bộ danh mục nội dung (bảng cân bằng, bản đồ) sao y bản chính.

## 11. Nguồn tham khảo

| Nội dung | Nguồn |
|---|---|
| Giới thiệu game, giấy phép, cập nhật 2014 | https://ninjaschool.vn/ |
| Trang cộng đồng TeaMobi (sự kiện, bảo trì) | https://my.teamobi.com/game/40/Ninja-School-Online-0.html |
| Bản Android chính thức | https://play.google.com/store/apps/details?id=com.team.njonline |
| Wiki cộng đồng (chiêu thức, nhiệm vụ) | https://ninjaschool.fandom.com/vi/wiki/Ninja_School_Online_Wiki |
| Ba trường và chuỗi nhiệm vụ 11–19 | https://nubagame.com/bai-viet/truong-ookaza-ninja-school-online/ , .../truong-hirosaki-ninja-school-online/ , https://nsopremium.com/truong-haruna.html |
| Hướng dẫn tổng quan cách chơi | https://nsopremium.com/ninja-school-online-huong-dan-chi-tiet-va-cach-choi-hieu-qua.html |
| Thư viện nhiệm vụ (mốc cấp 8/11/51/67/70) | https://nubagame.com/thu-vien-nso/nhiem-vu/ |
| Trailer 2013 | https://www.youtube.com/watch?v=U6B-ZslkIyc |
