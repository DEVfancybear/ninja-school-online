# client/ — Client web (chạy trên trình duyệt)

**Trạng thái:** trống, chưa có mã nguồn.

## Vai trò
Render thế giới 2D, nhận thao tác người chơi, gửi "ý định" (intent) lên server và hiển thị kết quả server trả về.
Client **không phải nguồn sự thật**: không tự quyết máu, sát thương, tiền, vật phẩm.

## Công nghệ dự kiến
- TypeScript (strict) + Vite
- Phaser 3 — render tilemap, nhân vật, hiệu ứng, input
- HUD/UI (túi đồ, chat, nhiệm vụ, shop) dựng bằng HTML/CSS overlay cho nhanh và dễ chỉnh
- Zustand (state client), howler.js (âm thanh), vite-plugin-pwa (cài như app)

## Cấu trúc dự kiến khi bắt đầu code
```text
client/
├── index.html
├── public/            # favicon, manifest, tài nguyên tĩnh
├── src/
│   ├── main.ts        # điểm khởi động
│   ├── core/          # bootstrap, vòng lặp, quản lý scene, nạp tài nguyên, âm thanh
│   ├── net/           # WebSocket client (reconnect, hàng đợi gói tin), REST client
│   ├── state/         # store: phiên đăng nhập, nhân vật, túi đồ, trận đấu
│   ├── scenes/        # đăng nhập, chọn nhân vật, thế giới, trận đấu, lôi đài
│   ├── world/         # render bản đồ, thực thể, camera
│   ├── battle/        # sàn đấu theo lượt (UI + hiệu ứng)
│   ├── ui/            # HUD, chat, túi, nhiệm vụ, shop, hộp thoại
│   ├── input/         # bàn phím, chạm, joystick ảo
│   └── i18n/
└── vite.config.ts
```

## Nguyên tắc
1. Mọi gói tin đều dùng định nghĩa trong `shared/` — không tự phát minh format riêng.
2. Chỉ nhận dữ liệu server gửi; không tải toàn bộ dữ liệu game về client (chống gian lận + nhẹ băng thông).
3. Tài nguyên hình/âm chỉ lấy từ `assets/` của dự án (xem `assets/README.md`).

## Tham chiếu
- `docs/02-architecture/project-structure.md`
- `docs/02-architecture/network-and-data.md`
