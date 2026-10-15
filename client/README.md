# client/ — Client web (Angular + Phaser)

Chạy trên trình duyệt. **Angular** lo giao diện, định tuyến, trạng thái, chat/túi đồ/nhiệm vụ (HUD).
**Phaser** chỉ vẽ thế giới 2D (bản đồ, nhân vật, quái, hiệu ứng) trong một component.

Client **không phải nguồn sự thật**: không tự quyết máu, sát thương, tiền, vật phẩm — chỉ gửi "ý định" lên server và hiển thị kết quả server trả về.

## Công nghệ

| Thành phần | Phiên bản / ghi chú |
|---|---|
| Angular | 22 (standalone component, signals, router, `ChangeDetectionStrategy.OnPush`) |
| Render thế giới 2D | Phaser 4, nhúng trong `WorldCanvas` |
| Build/dev | Angular CLI (`ng serve`, `ng build`) |
| Kiểm thử | Vitest qua `ng test` (jsdom) |
| Lint | ESLint + angular-eslint (`ng lint`) |

Phaser nằm trong **lazy chunk** của route `/play`, nên bundle khởi tạo nhẹ (khoảng 212 kB) và chỉ tải engine khi vào thế giới.

## Cấu trúc hiện tại

```text
client/
├── angular.json
├── eslint.config.js          # cấu hình do angular-eslint sinh ra
├── tsconfig.json             # cấu hình của Angular (không kế thừa tsconfig.base.json)
├── tsconfig.app.json
├── tsconfig.spec.json
├── public/
└── src/
    ├── main.ts               # bootstrap ứng dụng
    ├── index.html
    ├── styles.css            # biến màu, nền tối dùng chung
    └── app/
        ├── app.ts            # component gốc, chỉ chứa <router-outlet />
        ├── app.html
        ├── app.routes.ts     # '' → Home, 'play' → WorldCanvas (lazy)
        ├── app.config.ts     # provider của ứng dụng
        ├── pages/home/       # trang chủ
        └── game/
            ├── world-scene.ts     # cảnh Phaser (hiện vẽ lưới gạch mẫu)
            ├── game-config.ts     # hàm dựng cấu hình Phaser (tách để kiểm thử)
            └── world-canvas/      # component bọc canvas Phaser
```

Cấu trúc đích đầy đủ (đến hết Alpha) xem `docs/02-architecture/project-structure.md` — sẽ bổ sung `net/`, `state/`, `battle/`, `ui/`, `input/`, `i18n/`.

## Lệnh

```bash
pnpm --filter @ninja/shared build   # bắt buộc một lần (và mỗi khi sửa shared)
pnpm --filter @ninja/client dev     # ng serve → http://localhost:4200
pnpm --filter @ninja/client build   # ng build
pnpm --filter @ninja/client test    # ng test --no-watch
pnpm --filter @ninja/client lint    # ng lint
pnpm --filter @ninja/client typecheck
```

Từ gốc repo có thể dùng `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm lint`.

## Quy ước

1. Mọi gói tin (khi có mạng) đều dùng định nghĩa trong `@ninja/shared` — không tự phát minh format riêng.
2. Component dùng `ChangeDetectionStrategy.OnPush`; route nặng dùng `loadComponent`.
3. Phần vẽ nằm trong `game/`; phần giao diện nằm trong `pages/` và `ui/` (thêm sau). Không trộn logic nghiệp vụ vào component.
4. Tài nguyên hình/âm chỉ lấy từ `assets/` của dự án (xem `assets/README.md`).

## Ghi chú về kiểm thử

- `game-config.spec.ts` **mock Phaser**: jsdom không cài đặt canvas 2D nên không nạp được Phaser thật trong unit test. Test này kiểm tra cấu hình (phần tử cha, cảnh, chế độ co giãn, màu nền).
- Vì vậy **việc vẽ thật của Phaser chưa được unit test che phủ**. Cách kiểm: `pnpm --filter @ninja/client build` phải thành công, và mở `ng serve` vào `/play` phải thấy lưới gạch.
- Muốn kiểm tự động phần render thì cần Playwright (e2e) — nằm trong `tests/e2e/` ở cột mốc sau.
