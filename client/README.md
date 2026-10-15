# client/ — Client web (Angular + Phaser)

Chạy trên trình duyệt. **Angular** lo giao diện, định tuyến, trạng thái, xác thực, biểu mẫu, HUD.
**Phaser** chỉ vẽ thế giới 2D (bản đồ, nhân vật, quái, hiệu ứng) trong một component.

Client **không phải nguồn sự thật**: không tự quyết máu, sát thương, tiền, vật phẩm — chỉ gửi yêu cầu lên server và hiển thị kết quả server trả về. Việc kiểm tra dữ liệu trên client chỉ để phản hồi nhanh cho người chơi; server luôn kiểm tra lại.

## Công nghệ

| Thành phần | Phiên bản / ghi chú |
|---|---|
| Angular | 22 (standalone component, signals, router, `ChangeDetectionStrategy.OnPush`) |
| Gọi API | `HttpClient` + `provideHttpClient(withFetch())`, đường dẫn tương đối `/api/...`; mọi yêu cầu có thời hạn 15 giây (`REQUEST_TIMEOUT_MS`, lỗi quá hạn có mã riêng `timeout`) |
| Hợp đồng dữ liệu | `@ninja/shared` (schema zod dùng chung với server) |
| Render thế giới 2D | Phaser 4, nhúng trong `WorldCanvas` (lazy chunk của route `/play`) |
| Build/dev | Angular CLI (`ng serve`, `ng build`) |
| Kiểm thử | Vitest qua `ng test` (jsdom) |
| Lint | ESLint + angular-eslint (`ng lint`) |

## Cấu trúc hiện tại

```text
client/
├── angular.json            # có proxyConfig cho lệnh serve (chỉ cấu hình development)
├── proxy.conf.json         # chuyển /api và /ws (websocket) → http://127.0.0.1:3000 khi chạy ng serve
├── eslint.config.js
├── tsconfig*.json
├── public/
└── src/
    ├── main.ts, index.html, styles.css
    └── app/
        ├── app.ts, app.html, app.config.ts   # provider: router + HttpClient
        ├── app.routes.ts                     # '' → Home, 'play' → Play, 'login', 'characters'
        ├── core/                             # (M1) dịch vụ dùng chung
        │   ├── api/                          # api.service.ts, api-error.ts, endpoints.ts, schema.ts
        │   ├── auth/                         # auth.service.ts (signals) + auth.guard.ts
        │   ├── character/                    # character.service.ts
        │   └── game-labels.ts                # nhãn tiếng Việt cho trường/phái
        ├── net/                              # (M2) game-socket.ts, world-state.ts, world-types.ts, ws-url.ts
        ├── input/                            # (M2) key-map.ts, movement-controller.ts
        ├── game/                             # (M0) world-scene, game-config, world-canvas
        │                                     # (M2) world-logic.ts (ô gạch, facing, nội suy), test-hook.ts
        ├── ui/                               # (M2) hud/, chat-panel/, npc-dialog/, notice-bar/
        └── pages/
            ├── home/                         # (M0) trang chủ
            ├── login/                        # (M1) đăng nhập / đăng ký trong cùng một trang
            ├── characters/                   # (M1) danh sách + tạo nhân vật
            └── play/                         # (M2) trang /play — vào thế giới
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

## Luồng M2 (thế giới, di chuyển, chat)

1. `/play` (có guard) đọc danh sách nhân vật, chọn nhân vật (từ `?characterId=` hoặc nhân vật đầu tiên)
   rồi mở WebSocket tới `/ws` và gửi `C2S_HELLO {token, protocolVersion, characterId}`.
2. Server trả `S2C_HELLO` + `S2C_ENTER_MAP` (bản đồ đầy đủ để vẽ, chính mình, người chơi khác, lịch sử
   chat). Mọi gói khác gửi trước khi bắt tay xong đều **xếp hàng** và tuôn ra đúng thứ tự sau đó.
3. Phaser dựng tilemap từ `map.ground` + `map.decor`, vẽ thực thể và **nội suy** vị trí giữa các gói
   10 Hz để hình đi mượt ở 60 fps; camera đi theo nhân vật và giới hạn trong biên bản đồ.
4. Bàn phím (WASD/mũi tên) chỉ gửi **điểm đích** (`C2S_MOVE`), tối đa 10 lệnh/giây; server quyết định
   vị trí thật. Đang gõ chat thì phím không điều khiển nhân vật.
5. Mất kết nối thì nối lại theo cấp số 1→2→4→8→15 giây và hiện lớp phủ `.connection-overlay`; lỗi
   không thể tự khỏi (`unauthorized`, `protocol_mismatch`, `no_character`) thì dừng nối lại và hướng
   dẫn người chơi.
6. Cổng dịch chuyển do **server** phát hiện khi vị trí bước vào vùng cổng — client chỉ nhận
   `S2C_ENTER_MAP` mới và dựng lại bản đồ, nó **không** cần biết vùng cổng nằm ở đâu.

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

- **137 test / 16 file** (`vitest` qua `ng test`), đếm theo từng file: `game-socket.spec` 17,
  `world-logic.spec` 20, `world-state.spec` 11, `movement-controller.spec` 10, `key-map.spec` 10,
  `play.spec` 10, `auth.service.spec` 12, `characters.spec` 9, `api.service.spec` 9, `login.spec` 8,
  `character.service.spec` 6, `ws-url.spec` 5, `auth.guard.spec` 3, `game-config.spec` 3,
  `home.spec` 3, `app.spec` 1.
- `game-config.spec.ts` **mock Phaser**: jsdom không cài đặt canvas 2D nên không nạp được Phaser thật.
  Vì vậy phần vẽ thật của Phaser chưa được unit test che phủ; nó được phủ bằng **e2e Playwright** trong
  `tests/e2e` (13 kịch bản, chạy Chromium thật) — xem `tests/README.md`.
- Hook `window.__ninjaWorld` (dùng cho e2e) **chỉ** gắn khi `isDevMode()`: bản production không phơi nó.
- `ng serve` mặc định chỉ bind IPv6 `[::1]`. Khi cần gọi từ `127.0.0.1` (ví dụ Playwright) thì chạy
  `pnpm --filter @ninja/client dev --host 0.0.0.0`.
