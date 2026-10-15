# tools/ — Công cụ phát triển

## Đã có (M0): `data-validator`

```bash
pnpm validate:data                     # kiểm tra game-data/ ở gốc repo (tự build shared trước)

# Kiểm một thư mục khác (phải build shared trước nếu chưa có shared/dist)
pnpm build:shared && pnpm --filter @ninja/data-validator start -- <đường-dẫn-khác>
```

Công cụ đọc `game-data/skills/*.json` và `game-data/items/*.json`, đối chiếu với schema zod trong
`@ninja/shared`, in ra từng lỗi kèm tên file và đường dẫn trường sai, thoát với mã 1 nếu có lỗi.
CI chạy bước này trước khi build.

## Dự kiến thêm sau

```text
tools/
├── data-validator/   # (đã có) kiểm tra game-data theo schema
├── map-editor/       # cấu hình Tiled + script xuất map sang game-data/maps
├── asset-pipeline/   # đóng gói atlas, nén ảnh (WebP), nén âm thanh
└── gm-cli/           # công cụ quản trị: gửi lệnh GM, xem log, cấp vật phẩm
```

## Nguyên tắc

1. Công cụ viết bằng Node.js/TypeScript, cùng monorepo, dùng `@ninja/shared` làm nguồn schema.
2. `data-validator` chạy trong CI để chặn dữ liệu lỗi trước khi phát hành.
3. Bản đồ vẽ bằng **Tiled** (miễn phí, phổ biến) rồi xuất JSON — không tự viết editor đồ họa.
