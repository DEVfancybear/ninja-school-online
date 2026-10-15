# tools/ — Công cụ phát triển

**Trạng thái:** trống, chưa có mã nguồn.

## Các công cụ dự kiến
```text
tools/
├── data-validator/   # kiểm tra game-data/ đúng schema trước khi build/chạy server
├── map-editor/       # cấu hình Tiled + script xuất map sang game-data/maps
├── asset-pipeline/   # đóng gói atlas, nén ảnh (WebP), nén âm thanh
└── gm-cli/           # công cụ quản trị: gửi lệnh GM, xem log, cấp vật phẩm
```

## Nguyên tắc
1. Công cụ chạy bằng Node.js/TypeScript đồng bộ với phần còn lại của monorepo.
2. `data-validator` phải chạy được trong CI để chặn dữ liệu lỗi trước khi phát hành.
3. Bản đồ vẽ bằng **Tiled** (miễn phí, phổ biến) rồi xuất JSON — không tự viết editor đồ họa.
