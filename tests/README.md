# tests/ — Kiểm thử toàn hệ thống

Test đơn vị và tích hợp của từng gói nằm trong chính gói đó (`shared`, `server`, `client`).
Thư mục này chứa kiểm thử **xuyên hệ thống**.

## Đã có: `tests/e2e` (Playwright, trình duyệt thật)

```bash
pnpm e2e                    # build shared → chạy Playwright (tự khởi động server + client)
pnpm --filter @ninja/e2e exec playwright install chromium   # cài trình duyệt (lần đầu)
```

Playwright tự chạy server (`pnpm --filter @ninja/server dev`) và client
(`pnpm --filter @ninja/client dev --host 0.0.0.0` — cần cờ này vì `ng serve` mặc định chỉ bind IPv6
`[::1]`, xem `tests/e2e/playwright.config.ts`), nên chỉ cần PostgreSQL đang chạy và database đã migrate.
Mỗi lần chạy sinh tên tài khoản/nhân vật ngẫu nhiên nên không cần xoá dữ liệu cũ.

Cổng mặc định là 4200 (client) và 3000 (server). Khi cổng 4200 đang bận — ví dụ một dự án khác đang chạy
dev server — đặt `NINJA_E2E_CLIENT_PORT` để đổi cổng client:

```bash
NINJA_E2E_CLIENT_PORT=4300 pnpm e2e
```

**Bẫy đã gặp (tốn thời gian mới tìm ra):** `reuseExistingServer` sẽ **dùng lại** bất cứ thứ gì đang nghe ở
cổng đó, kể cả app của dự án khác; triệu chứng là mọi kịch bản đều báo "không thấy canvas" dù mã nguồn
đúng. Và nếu `shared/` vừa đổi mà client báo lỗi kiểu *"does not provide an export named ..."*, hãy xoá
`client/.angular/cache` rồi chạy lại: Vite giữ bản `@ninja/shared` đã tối ưu hoá từ lần chạy trước.

### `src/auth-character-flow.spec.ts` (8 kịch bản — M1)

| # | Kịch bản | Thuộc |
|---|---|---|
| 1 | Đăng ký → tạo nhân vật → tải lại trang vẫn còn phiên và còn nhân vật | M1 ✅ |
| 2 | Đăng xuất rồi đăng nhập lại bằng mật khẩu đã đặt thì thấy nhân vật cũ | M1 ✅ |
| 3 | Sai mật khẩu bị chặn, hiện thông báo, không rời trang đăng nhập | M1 ✅ |
| 4 | Biểu mẫu sai thì báo lỗi ngay trên trình duyệt và **không** gọi API | M1 ✅ |
| 5 | Chọn trường thì danh sách phái chỉ còn hai phái của trường đó | M1 ✅ |
| 6 | Tên nhân vật trùng (khác hoa thường, tài khoản khác) bị máy chủ từ chối | M1 ✅ |
| 7 | Tên nhân vật quá 12 ký tự bị chặn ngay trên trình duyệt | M1 ✅ |
| 8 | Đăng xuất thu hồi refresh token ở máy chủ: token cũ không dùng lại được | M1 ✅ |

### `src/world-movement-chat.spec.ts` (4 kịch bản — M2)

Hai **context trình duyệt riêng biệt** trong cùng một test, mỗi bên một tài khoản mới:

| # | Kịch bản | Thuộc |
|---|---|---|
| 1 | Hai người chơi cùng bản đồ thấy nhau, và người kia thấy mình đi sang phải | M2 ✅ |
| 2 | Chat trong bản đồ: người kia nhận đúng nội dung kèm tên người gửi | M2 ✅ |
| 3 | Đóng tab thì nhân vật biến mất khỏi bản đồ của người còn lại | M2 ✅ |
| 4 | Bấm vào NPC trong làng thì hiện hộp thoại đúng lời thoại | M2 ✅ |

### `src/world-portal.spec.ts` (1 kịch bản — M2)

| # | Kịch bản | Thuộc |
|---|---|---|
| 1 | Đi bộ vào vùng cổng thì tự sang bản đồ bên kia (người ở lại thấy rời đi), đi ngược lại thì về làng | M2 ✅ |

### `src/battle-pve.spec.ts` (4 kịch bản — M3)

| # | Kịch bản | Thuộc |
|---|---|---|
| 1 | Đi sang bãi luyện tập, bấm vào bù nhìn: trận mở ra, tới lượt mình, bấm "Đánh thường" theo lượt cho tới khi hạ được quái, nhận kinh nghiệm/yên/bánh bao rơi, xác quái nằm lại với 0 máu | M3 ✅ |
| 2 | Đánh liên tiếp ba con bù nhìn: lên tới **cấp 4** (ba cấp), thấy thông báo lên cấp, rồi mở túi dùng bánh bao vừa nhặt để hồi máu | M3 ✅ |
| 3 | Hai người chơi (hai context riêng) cùng bấm vào **một con quái**: vào chung một trận, danh sách có hai người, cả hai cùng thắng và cùng nhận thưởng | M3 ✅ |
| 4 | Lệnh không hợp lệ: bấm lại con quái vừa gục thì server trả `monster_gone` và client hiện đúng lý do; đang trong trận thì giữ phím di chuyển cũng không nhúc nhích | M3 ✅ |

**Tổng: 17 kịch bản.** Các kịch bản dùng hook `window.__ninjaWorld` — hook này **chỉ** được gắn khi
`isDevMode()`, bản production không phơi nó (xem `client/src/app/game/test-hook.ts`). Hook M3 có thêm:
`monsters()`, `attackMonster(name)`, `attackMonsterAt(index)`, `battle()`, `character()`, `inventory()`,
`useItem(name)`, `toggleInventory(open)`, `inventoryOpen()`, `lastError()`.

## Dự kiến thêm sau

```text
tests/
├── e2e/     # Playwright (đã có)
└── load/    # k6: mô phỏng 100–500 người chơi đồng thời — làm ở M8
```

## Nguyên tắc

1. e2e chạy được với môi trường dựng bằng Docker Compose hoặc PostgreSQL chạy sẵn trên máy.
2. Kiểm thử tải đặt mục tiêu rõ: 200 CCU ổn định, độ trễ gói tin trong nước < 200 ms.
3. e2e **không** chạy trong `pnpm test` (test đơn vị phải nhanh); chạy riêng bằng `pnpm e2e`.
   Gói `tests/e2e` cố tình không có script `test` để `pnpm -r test` bỏ qua nó.
