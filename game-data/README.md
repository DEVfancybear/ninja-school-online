# game-data/ — Dữ liệu nội dung game

**Trạng thái:** đã có 2 file ví dụ (`skills/skill-tram-co-ban.json`, `items/item-kiem-go.json`) và schema tương ứng trong `@ninja/shared`. Kiểm tra bằng `pnpm validate:data`.

## Vai trò
Chứa **toàn bộ nội dung game dưới dạng dữ liệu** (JSON/YAML) để thiết kế và cân bằng mà không cần sửa code:

```text
game-data/
├── maps/        # bản đồ: tilemap, cổng dịch chuyển, điểm spawn, NPC
├── monsters/    # quái: chỉ số, chiêu, bảng rơi đồ, thời gian hồi sinh
├── items/       # vật phẩm, trang bị, nguyên liệu, mức cường hóa
├── skills/      # chiêu thức: sát thương, hồi chiêu, hiệu ứng
├── quests/      # nhiệm vụ: điều kiện, các bước, phần thưởng
├── npcs/        # hội thoại, chức năng (shop, sư phụ dạy chiêu...)
├── classes/     # 3 trường, 6 phái, hệ số chỉ số khi lên cấp
├── shops/       # danh sách hàng bán
└── events/      # sự kiện định kỳ, quà đăng nhập
```

## Nguyên tắc
1. Chỉ **server** nạp toàn bộ `game-data/`; client chỉ nhận phần cần thiết qua mạng (tránh lộ bảng cân bằng, chống gian lận).
2. Mọi file phải qua **schema (zod) trong `shared/`** — dữ liệu sai schema thì server không khởi động.
3. Đặt tên file kebab-case, có tiền tố loại: `map-lang-khoi-nguon.json`, `item-kiem-go.json`, `skill-otama.json`.
4. Là "nguồn sự thật" của nội dung — không hard-code số liệu trong code.
5. Nội dung phải **nguyên bản**: không sao chép tên, cốt truyện, số liệu từ game gốc.
