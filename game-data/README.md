# game-data/ — Dữ liệu nội dung game

**Trạng thái (sau M3):** **20 file**, đủ cho phạm vi MVP — 2 bản đồ, 3 loại quái, 3 trường, 7 chiêu,
4 vật phẩm, 1 NPC. Schema nằm trong `@ninja/shared`; kiểm tra bằng `pnpm validate:data` (schema từng file
rồi tới **luật liên-file** dùng chung với server: id trùng, cổng dẫn tới đâu, chỗ đặt NPC/quái có dữ liệu
không, quà rơi và đồ khởi đầu có vật phẩm thật không, chiêu phải thuộc trường của mình).

## Vai trò
Chứa **toàn bộ nội dung game dưới dạng dữ liệu** (JSON/YAML) để thiết kế và cân bằng mà không cần sửa code:

```text
game-data/
├── maps/        # (2) bản đồ: tilemap, cổng dịch chuyển, điểm spawn, NPC, chỗ đặt quái
├── monsters/    # (3) quái: hình dáng để vẽ, chỉ số, bảng rơi đồ, thời gian hồi sinh
├── items/       # (4) vật phẩm, trang bị, nguyên liệu, hiệu ứng dùng được, mức cường hóa
├── skills/      # (7) chiêu thức: sát thương, hồi chiêu (quy ra vòng), chỉ số ăn theo
├── npcs/        # (1) hội thoại, chức năng (shop, sư phụ dạy chiêu...)
├── classes/     # (3) mỗi trường một file: chỉ số cấp 1, phần tăng mỗi cấp, yên + đồ khởi đầu
├── quests/      # nhiệm vụ: điều kiện, các bước, phần thưởng (M5)
├── shops/       # danh sách hàng bán (M4)
└── events/      # sự kiện định kỳ, quà đăng nhập (M7)
```

## Nguyên tắc
1. Chỉ **server** nạp toàn bộ `game-data/`; client chỉ nhận phần cần thiết qua mạng (tránh lộ bảng cân bằng, chống gian lận).
2. Mọi file phải qua **schema (zod) trong `shared/`** — dữ liệu sai schema thì server không khởi động.
3. Đặt tên file kebab-case, có tiền tố loại: `map-lang-khoi-nguon.json`, `item-kiem-go.json`, `skill-otama.json`.
4. Là "nguồn sự thật" của nội dung — không hard-code số liệu trong code.
5. Nội dung phải **nguyên bản**: không sao chép tên, cốt truyện, số liệu từ game gốc.
6. Dữ liệu không được hứa thứ mã nguồn chưa làm: ở M3 `targets` phải là 1 và `effects` phải rỗng (chiêu
   nhiều mục tiêu và hiệu ứng phụ chưa có) — `checkGameData` bắt lỗi này ngay khi kiểm dữ liệu.
