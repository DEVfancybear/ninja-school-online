# client/ — Client web (Angular + Phaser)

Chạy trên trình duyệt. **Angular** lo giao diện, định tuyến, trạng thái, xác thực, biểu mẫu, HUD.
**Phaser** chỉ vẽ thế giới 2D (bản đồ, nhân vật, quái, hiệu ứng) trong một component.

Client **không phải nguồn sự thật**: không tự quyết máu, sát thương, tiền, vật phẩm — chỉ gửi yêu cầu lên server và hiển thị kết quả server trả về. Việc kiểm tra dữ liệu trên client chỉ để phản hồi nhanh cho người chơi; server luôn kiểm tra lại.

## Công nghệ

| Thành phần | Phiên bản / ghi chú |
|---|---|
| Angular | 22 (standalone component, signals, router, `ChangeDetectionStrategy.OnPush`) |
| Gọi API | `HttpClient` + `provideHttpClient(withFetch())`, đường dẫn tương đối `/api/...`; mọi yêu cầu có thời hạn 15 giây (`REQUEST_TIMEOUT_MS`) |
| Hợp đồng dữ liệu | `@ninja/shared` (schema zod dùng chung với server) |
| Render thế giới 2D | Phaser 4, nhúng trong `WorldCanvas` (lazy chunk của route `/play`) |
| Build/dev | Angular CLI (`ng serve`, `ng build`) |
| Kiểm thử | Vitest qua `ng test` (jsdom) |
| Lint | ESLint + angular-eslint (`ng lint`) |

## Cấu trúc hiện tại

```text
client/
├── angular.json            # có proxyConfig cho lệnh serve (chỉ cấu hình development)
├── proxy.conf.json         # chuyển /api → http://127.0.0.1:3000 khi chạy ng serve
├── eslint.config.js
├── tsconfig*.json
├── public/
└── src/
    ├── main.ts, index.html, styles.css
    └── app/
        ├── app.ts, app.html, app.config.ts   # provider: router + HttpClient
        ├── app.routes.ts                     # '' → Home, 'play' → WorldCanvas, 'login', 'characters'
        ├── core/                             # (M1) dịch vụ dùng chung
        │   ├── api/                          # api.service.ts, api-error.ts, endpoints.ts, schema.ts
        │   ├── auth/                         # auth.service.ts (signals) + auth.guard.ts
        │   ├── character/                    # character.service.ts
        │   └── game-labels.ts                # nhãn tiếng Việt cho trường/phái
        ├── game/                             # (M0) world-scene, game-config, world-canvas
        └── pages/
            ├── home/                         # (M0) trang chủ
            ├── login/                        # (M1) đăng nhập / đăng ký trong cùng một trang
            └── characters/                   # (M1) danh sách + tạo nhân vật
```

## Luồng M1 (tài khoản & nhân vật)

1. `/login`: một trang cho cả đăng nhập và đăng ký (chuyển bằng tab). Biểu mẫu được kiểm bằng
   `RegisterRequestSchema` / `LoginRequestSchema` của `@ninja/shared` trước khi gọi API.
2. Đăng ký/đăng nhập thành công → lưu `accessToken` + `refreshToken` vào `localStorage`
   (`ninja.accessToken`, `ninja.refreshToken`) và chuyển sang `/characters`.
3. `/characters` (có guard): hiện danh sách nhân vật và biểu mẫu tạo nhân vật; chọn trường thì
   danh sách phái chỉ còn hai phái của trường đó (`SCHOOL_CLASSES`).
4. Tải lại trang: `AuthService` khôi phục phiên từ `localStorage` và gọi `/api/auth/me`;
   token còn hạn thì vào thẳng, hết hạn thì đưa về `/login`.
5. Đăng xuất: gọi `POST /api/auth/logout` để server **thu hồi refresh token** rồi mới xoá phiên ở client.
   Nếu không gọi được server (mất mạng) thì vẫn xoá phiên ở client, nhưng khi đó token cũ chỉ hết hiệu
   lực theo thời hạn của nó — `tests/e2e` có kịch bản kiểm đúng hành vi này.
   Lưu ý: access token đã cấp vẫn dùng được tới khi hết hạn (15 phút) vì JWT không trạng thái
   (xem `server/README.md`, mục "Giới hạn đã biết").

## Lệnh

```bash
# Từ gốc repo: pnpm dev (chạy song song client + server, tự build @ninja/shared trước)
pnpm --filter @ninja/client dev            # ng serve → http://localhost:4200 (cần server ở cổng 3000)
pnpm --filter @ninja/client build          # ng build
pnpm --filter @ninja/client test           # ng test --no-watch (Vitest + jsdom)
pnpm --filter @ninja/client lint           # ng lint
pnpm --filter @ninja/client typecheck
```

Từ gốc repo: `pnpm dev` (chạy song song client + server), `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm e2e`.

Kiểm thử đầu-cuối trên trình duyệt thật nằm ở `tests/e2e` (Playwright), chạy bằng `pnpm e2e`.

## Quy ước

1. Mọi dữ liệu vào/ra đều dùng schema trong `@ninja/shared`, không tự định nghĩa lại kiểu.
2. Component dùng `ChangeDetectionStrategy.OnPush`; route nặng dùng `loadComponent`.
3. Phần vẽ nằm trong `game/`; giao diện nằm trong `pages/` và `ui/` (sẽ thêm sau).
4. State dùng signals trong service, không để logic nghiệp vụ trong component.

## Ghi chú về kiểm thử

- `game-config.spec.ts` **mock Phaser**: jsdom không cài đặt canvas 2D nên không nạp được Phaser thật.
  Vì vậy phần vẽ thật của Phaser chưa được unit test che phủ; kiểm bằng `ng build` và bằng Playwright
  khi cần (`/play` render được canvas).
- `ng serve` mặc định chỉ bind IPv6 `[::1]`. Khi cần gọi từ `127.0.0.1` (ví dụ Playwright) thì chạy
  `pnpm --filter @ninja/client dev --host 0.0.0.0`.
