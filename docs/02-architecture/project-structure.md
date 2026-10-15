# Cấu trúc dự án

*Ngày viết: 2026-10-15. Cập nhật sau khi hoàn thành M0: **mốc M0 đã dựng thật**, các phần còn lại là cấu trúc đích cho các cột mốc sau.*

## 1. Nguyên tắc thiết kế

1. **Monorepo, một ngôn ngữ (TypeScript):** client, server, shared nằm cùng repo, cùng phiên bản protocol.
2. **Tách client / server / shared rõ ràng:**
   - `client/` chỉ render và gửi ý định;
   - `server/` là nguồn sự thật, chứa toàn bộ nghiệp vụ;
   - `shared/` chỉ chứa hợp đồng (protocol, kiểu dữ liệu, hằng số) — không chứa nghiệp vụ chạy được.
3. **Data-driven:** nội dung (map, quái, vật phẩm, nhiệm vụ...) nằm trong `game-data/` dạng JSON. Sửa cân bằng = sửa dữ liệu, không sửa code.
4. **Module theo hệ thống:** mỗi hệ thống game = một module trong `server/src/modules/`, ánh xạ 1-1 với tài liệu `game-systems.md`.
5. **Server-authoritative:** mọi quyết định (sát thương, tiền, rơi đồ, thời gian hồi) tính ở server.
6. **Tài nguyên nguyên bản:** hình/âm chỉ từ `assets/` của dự án (xem chính sách trong `assets/README.md`).

## 2. Cây thư mục đích (đầy đủ)

```text
ninja/
├── README.md
├── .gitignore
├── package.json                  # workspace root (M0)
├── pnpm-workspace.yaml           # khai báo workspace: client, server, shared, tools/*
├── tsconfig.base.json            # cấu hình TS chung
│
├── docs/                         # tài liệu dự án (đã có)
│   ├── 01-research/
│   ├── 02-architecture/
│   └── 03-plan/
│
├── client/                       # CLIENT WEB (Angular 22 + Phaser 4)
│   ├── angular.json              # cấu hình Angular CLI
│   ├── eslint.config.js          # do angular-eslint sinh ra
│   ├── public/                   # favicon, manifest PWA, tài nguyên tĩnh
│   └── src/
│       ├── main.ts               # bootstrap Angular
│       ├── index.html
│       ├── styles.css            # biến màu, nền tối dùng chung
│       └── app/
│           ├── app.ts            # component gốc + <router-outlet />
│           ├── app.routes.ts     # '' → Home, 'play' → WorldCanvas, 'login', 'characters'
│           ├── app.config.ts     # provider: router + HttpClient (withFetch)
│           ├── core/             # (M1) api/, auth/ (service + guard), character/, game-labels.ts
│           ├── pages/home/       # (M0) trang chủ
│           ├── pages/login/      # (M1) đăng nhập + đăng ký
│           ├── pages/characters/ # (M1) danh sách + tạo nhân vật
│           └── game/             # (M0) world-scene.ts, game-config.ts, world-canvas/
│       # các thư mục thêm ở cột mốc sau (đặt trong src/app/):
│       #   net/          WebSocket client (reconnect, backoff, hàng đợi)
│       #   battle/       UI sàn đấu theo lượt + hiệu ứng chiêu
│       #   ui/           HUD, chat, túi, nhiệm vụ, shop, hộp thoại
│       #   input/        bàn phím, chạm, joystick ảo
│       #   i18n/         chuỗi giao diện (tiếng Việt trước)
│
├── server/                       # GAME SERVER (Node.js + Fastify + ws)
│   ├── drizzle/                  # file SQL migration (drizzle-kit sinh)
│   ├── drizzle.config.ts
│   └── src/
│       ├── main.ts               # khởi động: nạp .env, mở pool, dựng app, đóng sạch khi có tín hiệu
│       ├── app.ts                # (M1) dựng Fastify: cors, jwt, route, xử lý lỗi thống nhất
│       ├── config/               # (M1) env.ts (kiểm biến môi trường), dotenv.ts
│       ├── http/                 # (M1) parseRequest, auth.ts (preHandler xác thực)
│       ├── security/             # (M1) password.ts (Argon2id), tokens.ts (JWT + refresh token)
│       ├── db/                   # (M1) schema.ts, client.ts, migrate.ts
│       ├── modules/account/      # (M1) đăng ký/đăng nhập/làm mới/đăng xuất
│       ├── modules/character/    # (M1) tạo/liệt kê nhân vật
│       ├── test/                 # (M1) global-setup + tiện ích database kiểm thử
│       # thêm ở cột mốc sau:
│       #   net/                  WS server, connection registry, codec, handshake
│       #   core/                 tick scheduler, event bus, room manager, id generator
│       #   world/                map instance, spawn quái, kiểm tra di chuyển, tầm nhìn
│       #   modules/<hệ thống>    inventory, skill, battle, quest, npc, social, guild, arena, event, mail, admin
│       #   security/             rate-limit, chống gian lận, audit log
│
├── shared/                       # HỢP ĐỒNG CHUNG client ↔ server
│   └── src/
│       ├── protocol/             # PROTOCOL_VERSION (opcode, gói tin thêm ở cột mốc sau)
│       ├── constants/            # enum: trường, phái, quan hệ trường–phái
│       ├── schemas/              # schema zod: skill, item (M0), account, character (M1)
│       └── index.ts              # điểm xuất chung
│       # thêm ở cột mốc sau: types/ (DTO), utils/ (toán, RNG xác định)
│
├── game-data/                    # NỘI DUNG GAME (JSON, chỉ server nạp)
│   ├── maps/ monsters/ items/ skills/ quests/ npcs/ shops/ classes/ events/
│
├── assets/                       # TÀI NGUYÊN NGUỒN (hình, âm thanh, font)
│   ├── art/ (characters, monsters, tilesets, ui, effects)
│   └── audio/ (sfx, music)
│
├── tools/                        # CÔNG CỤ DEV
│   ├── data-validator/           # kiểm tra game-data theo schema
│   ├── map-editor/               # Tiled + script xuất map
│   ├── asset-pipeline/           # đóng gói atlas, nén ảnh/âm
│   └── gm-cli/                   # công cụ quản trị GM
│
├── infra/                        # HẠ TẦNG
│   ├── docker/                   # docker-compose.dev/prod, Dockerfile.server, nginx.conf
│   ├── deploy/                   # kịch bản triển khai VPS
│   └── ci/                       # ghi chú pipeline (workflow thật ở .github/workflows)
│
└── tests/                        # KIỂM THỬ TOÀN HỆ THỐNG
    ├── e2e/                      # Playwright
    └── load/                     # k6
```

## 3. Ánh xạ hệ thống game → vị trí code

| Hệ thống (game-systems.md) | Server | Client | Dữ liệu |
|---|---|---|---|
| Tài khoản, đăng nhập | `modules/account` + `net/` | `scenes/` (login) + `net/` | bảng `accounts` |
| Nhân vật & chỉ số | `modules/character` | `scenes/` (chọn NV), `ui/` | `game-data/classes/` |
| Bản đồ, di chuyển | `world/` | `world/` | `game-data/maps/` |
| NPC, hội thoại, shop | `modules/npc` | `ui/` | `game-data/npcs/`, `game-data/shops/` |
| Nhiệm vụ | `modules/quest` | `ui/` | `game-data/quests/` |
| Đấu theo lượt, quái, rơi đồ | `modules/battle`, `world/` | `battle/` | `game-data/monsters/` |
| Kỹ năng, chiêu thức | `modules/skill` | `battle/`, `ui/` | `game-data/skills/` |
| Túi đồ, trang bị, cường hóa | `modules/inventory` | `ui/` | `game-data/items/` |
| Chat, bạn, nhóm | `modules/social` (chat khu vực ở MVP nằm trong `net/` + `world/`) | `ui/` (chat) | bảng `friends` |
| Bang hội | `modules/guild` | `ui/` | bảng `guilds` |
| Lôi Đài, xếp hạng | `modules/arena` | `scenes/` (lôi đài) | Redis + bảng `arena_rank` |
| Sự kiện, quà đăng nhập | `modules/event` | `ui/` | `game-data/events/` |
| Thư (mail) | `modules/mail` | `ui/` | bảng `mails` |
| Công cụ GM | `modules/admin` | — | audit log |

## 4. Quy ước đặt tên

| Loại | Quy ước | Ví dụ |
|---|---|---|
| Thư mục | kebab-case | `game-data/`, `data-validator/` |
| File TS | kebab-case | `battle-service.ts`, `map-room.ts` |
| Class/Type | PascalCase | `BattleRoom`, `CharacterDto` |
| Hàm/biến | camelCase | `resolveDamage()` |
| Opcode | UPPER_SNAKE | `C2S_MOVE`, `S2C_ENTER_MAP` |
| File dữ liệu | tiền tố loại + kebab-case | `map-lang-khoi-nguon.json`, `skill-otama.json` |

Chữ trong code/giao diện: tiếng Anh cho định danh, chuỗi hiển thị nằm trong `i18n/` (tiếng Việt trước, thêm tiếng Anh sau nếu cần).

## 5. Cấu trúc tiến hóa theo giai đoạn

| Giai đoạn | Thêm mới vào cấu trúc |
|---|---|
| M0 (nền móng) | `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, CI, `infra/docker/docker-compose.dev.yml`, `tools/data-validator` |
| M1 (đã xong) | `client/src/app/{core,pages/login,pages/characters}`, `server/src/{config,db,http,security,modules/{account,character}}`, `shared/src/schemas`, `server/drizzle`, `tests/e2e` (8 kịch bản tài khoản & nhân vật) |
| M2–M3 (MVP còn lại) | `server/src/{net,core,world,modules/{npc,inventory,battle,skill}}`, `client/src/app/{net,battle,ui,input}`, `game-data/{maps,monsters,items,skills,classes,npcs}` |
| M4–M6 (Alpha) | `modules/{quest,social,arena,mail}`, mở rộng `game-data/{quests,shops}`, `tools/{map-editor,asset-pipeline}`, thêm kịch bản e2e cho thế giới/chat rồi chiến đấu |
| M7–M8 (Beta) | `modules/{guild,event}`, `tools/gm-cli`, `infra/deploy`, `tests/load` |

Chi tiết tiêu chí từng mốc xem `docs/03-plan/roadmap.md`.

## 6. Ghi chú về cấu hình TypeScript

| Gói | Cấu hình | Vì sao |
|---|---|---|
| `shared`, `server`, `tools/*` | kế thừa `tsconfig.base.json` (module `nodenext`) | chạy trên Node.js, xuất ESM thật nên import tương đối phải ghi kèm `.js` |
| `client` | dùng cấu hình do Angular CLI sinh ra (`client/tsconfig.json`) | Angular tự quyết định `module`, decorator, template; ghi đè dễ hỏng |

`shared` được **build ra `dist/`** trước khi `server` và `tools/data-validator` dùng, nên chúng import `@ninja/shared` qua `exports` trong `package.json` (không trỏ thẳng vào file `.ts`). Vì vậy các script gốc `validate:data`, `typecheck`, `test` đều chạy `pnpm build:shared` trước.

`client` đã phụ thuộc `@ninja/shared` từ M1 để dùng chung schema dữ liệu với server (kiểm biểu mẫu, suy ra kiểu).
