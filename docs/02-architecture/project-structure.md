# Cấu trúc dự án

*Ngày viết: 2026-10-15. Cập nhật sau khi hoàn thành **M0, M1 và M2**: các mục ghi (M0)/(M1)/(M2) đã dựng thật, phần còn lại là cấu trúc đích cho các cột mốc sau.*

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
│           ├── pages/characters/ # (M1) danh sách + tạo nhân vật; (M2) lối vào thế giới
│           ├── pages/play/       # (M2) trang /play: nối WebSocket, nạp bản đồ, HUD; (M3) chiến đấu; (M4) túi/trang bị/shop; (M5) nhiệm vụ; (M6) xã hội và Lôi Đài
│           ├── net/              # (M2) game-socket.ts (WebSocket, nối lại, ping), world-state.ts;
│           │                     # (M4) equipment-state; (M5) quest-state; (M6) social-state, party-state, arena-state, mail-state
│           ├── input/            # (M2) key-map.ts (bàn phím), movement-controller.ts (gửi đích mỗi 100 ms)
│           ├── game/             # (M0) world-canvas/, game-config; (M2) world-scene.ts, world-logic.ts, test-hook.ts
│           │                     # (M5) hook nhiệm vụ; (M6) hook xã hội, thư và Lôi Đài cho e2e
│           ├── ui/               # (M2) hud/, chat-panel/, npc-dialog/, notice-bar/; (M3) battle-panel/;
│           │                     # (M4) inventory-panel/, equipment-panel/, shop-panel/; (M5) quest-log/;
│           │                     # (M6) social-panel/, arena-panel/, mail-panel/
│           └── # các thư mục thêm ở cột mốc sau (đặt trong src/app/):
│               #   i18n/     tách chuỗi giao diện (hiện đang viết trực tiếp trong template)
│
├── server/                       # GAME SERVER (Node.js + Fastify + ws)
│   ├── drizzle/                  # M1–M6 migrations 0001–0004, journal và metadata snapshot
│   ├── drizzle.config.ts
│   └── src/
│       ├── main.ts               # khởi động: nạp .env, mở pool, dựng app, đóng sạch khi có tín hiệu
│       ├── app.ts                # (M1) dựng Fastify: cors, jwt, route, xử lý lỗi thống nhất; (M2) thế giới + WebSocket; (M6) nối social/arena/mail
│       ├── config/               # (M1) env.ts (kiểm biến môi trường), dotenv.ts
│       ├── http/                 # (M1) parseRequest, auth.ts (preHandler xác thực)
│       ├── security/             # (M1) password.ts (Argon2id), tokens.ts (JWT + refresh token)
│       ├── db/                   # schema.ts, client.ts, migrate.ts; M6 thêm friendships, character_arena, mails
│       ├── net/                  # (M2) gateway WS gắn vào Fastify (`/ws`), phiên kết nối, bảng phiên theo nhân vật
│       ├── core/                 # (M2) tick.ts (một interval dùng chung), room-manager.ts
│       ├── world/                # (M2) game-data.ts (nạp + kiểm), map.ts, movement.ts, room.ts, world-service.ts
│       │                         # (M3) quái trong room có máu + hồi sinh; gửi chỉ số/túi sau bắt tay
│       ├── battle/               # (M3) engine.ts (công thức thuần), service.ts (luồng trận theo lượt)
│       ├── modules/account/      # (M1) đăng ký/đăng nhập/làm mới/đăng xuất
│       ├── modules/character/    # (M1) tạo/liệt kê nhân vật; (M2) chọn nhân vật để vào game;
│       │                         # (M3) stats.ts (chỉ số theo cấp), máu/nội lực, thưởng trận đấu
│       ├── modules/chat/         # (M2) chat khu vực; M6 bổ sung map/world/party/private và giới hạn tần suất
│       ├── modules/inventory/    # (M3) túi đồ: cất/lấy theo số lượng, sức chứa theo số loại;
│       │                         # (M4) món trong túi có cấp cường hóa + ô đang mặc
│       ├── modules/equipment/    # (M4) mặc/tháo 4 ô trang bị, cộng chỉ số vào nhân vật
│       ├── modules/shop/         # (M4) quầy NPC: mua/bán, ghi sổ giao dịch
│       ├── modules/upgrade/      # (M4) cường hóa: yên + đá vụn, tỉ lệ theo cấp
│       ├── modules/npc/          # (M2) hội thoại NPC theo game-data (M4: quầy hàng; M5: nhánh theo nhiệm vụ)
│       ├── modules/quest/        # (M5) nhiệm vụ chính tuyến: nhận/trả, tiến độ, thưởng, cờ mở khoá
│       ├── modules/social/       # (M6) lời mời/đồng ý/bỏ bạn; giới hạn 50 bạn mỗi nhân vật
│       ├── modules/party/        # (M6) lập đội, mời, rời/đuổi; tối đa 4 thành viên
│       ├── modules/arena/        # (M6) hàng chờ 1v1, đấu PvP, Elo và xử lý ngắt kết nối
│       ├── modules/leaderboard/  # (M6) bảng cấp độ và điểm Arena, tối đa 20 dòng
│       ├── modules/mail/         # (M6) thư hệ thống; claim yên/vật phẩm nguyên tử
│       ├── test/                 # global-setup + DB kiểm thử; server thật trên cổng 0 + client ws;
│       │                         # M3 dữ liệu game tạm để thử dữ liệu sai; M6 test xã hội/arena và admission
│       # cột mốc sau: guild, event, admin và rate-limit chung
│
├── shared/                       # HỢP ĐỒNG CHUNG client ↔ server
│   └── src/
│       ├── protocol/             # PROTOCOL_VERSION 6; opcodes/gói tin M0–M6 và schema lỗi chung
│       ├── constants/            # enum trường/phái (M0); account/character (M1), world (M2), battle/stats (M3);
│       │                         # equipment (M4), quest (M5), social/party/chat/arena/leaderboard/mail (M6)
│       ├── schemas/              # schema zod: skill/item (M0), account/character (M1), map (M2),
│       │                         # school/monster/game-data (M3), item/equipment (M4), quest/NPC dialog (M5),
│       │                         # social/party/chat/mail/arena/leaderboard (M6)
│       └── index.ts              # điểm xuất chung
│       # thêm ở cột mốc sau: types/ (DTO), utils/ (toán, RNG xác định)
│
├── game-data/                    # NỘI DUNG GAME (JSON, chỉ server nạp)
│   ├── maps/ monsters/ items/ skills/ npcs/ classes/   # 27 tệp nội dung nền; quầy khai trong NPC
│   ├── quests/                                         # (M5) 12 nhiệm vụ chính tuyến chương 1
│   │   # Đo hiện tại: 39 tệp JSON gồm nội dung nền và quest; validator kiểm cả 39 file
│   ├── events/                                         # cột mốc sau (M7)
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
| Tài khoản, đăng nhập | `modules/account` (+ `net/` cho WebSocket) | `pages/login/`, `core/auth/` | bảng `accounts` |
| Nhân vật & chỉ số | `modules/character` | `pages/characters/`, `core/character/` | `game-data/classes/` |
| Bản đồ, di chuyển | `world/` | `game/` (Phaser), `input/` | `game-data/maps/` |
| NPC, hội thoại, shop | `modules/npc` | `ui/npc-dialog/` | `game-data/npcs/` (quầy bán khai ngay trong NPC, M4) |
| Nhiệm vụ | `modules/quest` | `ui/quest-log/`, `ui/npc-dialog/` | `game-data/quests/` |
| Đấu theo lượt, quái, rơi đồ | `battle/` (M3), `world/` | `ui/battle-panel/`, `game/` | `game-data/monsters/` |
| Kỹ năng, chiêu thức | `modules/character/stats.ts` (M3: học theo phái + cấp) | `ui/battle-panel/` | `game-data/skills/` |
| Túi đồ, trang bị, cường hóa | `modules/inventory` (M3: túi), trang bị/cường hóa M4 | `ui/inventory-panel/` | `game-data/items/` |
| Chat theo khu vực/thế giới/tổ đội/riêng, bạn bè và tổ đội | `modules/chat`, `modules/social`, `modules/party` | `ui/chat-panel/`, `ui/social-panel/`; state trong `net/` | bảng `friendships`; tổ đội lưu trong bộ nhớ server |
| Bang hội | `modules/guild` (M7, chưa triển khai) | `ui/` (M7) | bảng `guilds` (M7) |
| Lôi Đài 1v1, điểm và bảng xếp hạng | `modules/arena`, `modules/leaderboard`; dùng chung `battle/engine.ts` | `ui/arena-panel/`, `ui/battle-panel/` | bảng `character_arena` |
| Sự kiện, quà đăng nhập | `modules/event` (M7, chưa triển khai) | `ui/` (M7) | `game-data/events/` (M7) |
| Thư hệ thống | `modules/mail` | `ui/mail-panel/`; state trong `net/mail-state.ts` | bảng `mails` |
| Công cụ GM | `modules/admin` | — | audit log |

## 4. Quy ước đặt tên

| Loại | Quy ước | Ví dụ |
|---|---|---|
| Thư mục | kebab-case | `game-data/`, `data-validator/` |
| File TS | kebab-case | `battle-service.ts`, `map-room.ts` |
| Class/Type | PascalCase | `BattleRoom`, `CharacterDto` |
| Hàm/biến | camelCase | `resolveDamage()` |
| Opcode | UPPER_SNAKE | `C2S_MOVE`, `S2C_ENTER_MAP` |
| File dữ liệu | kebab-case, map/NPC theo tiền tố loại | `lang-khoi-nguon.json` (map), `npc-thay-hieu-truong.json`, `skill-otama.json` |

Chữ trong code/giao diện: tiếng Anh cho định danh, chuỗi hiển thị nằm trong `i18n/` (tiếng Việt trước, thêm tiếng Anh sau nếu cần).

## 5. Cấu trúc tiến hóa theo giai đoạn

| Giai đoạn | Thêm mới vào cấu trúc |
|---|---|
| M0 (nền móng) | `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, CI, `infra/docker/docker-compose.dev.yml`, `tools/data-validator` |
| M1 (đã xong) | `client/src/app/{core,pages/login,pages/characters}`, `server/src/{config,db,http,security,modules/{account,character}}`, `shared/src/schemas`, `server/drizzle`, `tests/e2e` (8 kịch bản tài khoản & nhân vật) |
| M2 (đã xong) | `server/src/{net,core,world,modules/{chat,npc}}`, `client/src/app/{net,input,ui,pages/play}` + `game/world-logic.ts`, `game-data/{maps,npcs}` (2 bản đồ + 1 NPC có hội thoại), `server/src/net/ws.spec.ts`, e2e thế giới/chat trong `tests/e2e` |
| M3 (đã xong) | `client/src/app/ui/battle-panel/`, `server/src/battle/`, `server/src/modules/inventory/`, chiêu thức trong `server/src/modules/character/stats.ts`, `game-data/{monsters,items,skills,classes}` |
| M4 (đã xong) | `server/src/modules/{equipment,shop,upgrade}/`, `client/src/app/ui/{equipment,shop}-panel/`; mua/bán, trang bị và cường hóa |
| M5 (đã xong) | `server/src/modules/quest/`, 12 tệp `game-data/quests/`, `client/src/app/net/quest-state.ts`, `ui/quest-log/`; 4 kịch bản e2e |
| M6 (đã xong 2026-10-21) | `server/src/modules/{social,party,arena,leaderboard,mail}/`; protocol v6, các bảng `friendships`, `character_arena`, `mails`; client `ui/{social,chat,arena,mail}-panel/`; 5 kịch bản e2e |
| M7–M8 (Beta) | `modules/{guild,event}`, `tools/gm-cli`, `infra/deploy`, `tests/load` |

Chi tiết tiêu chí từng mốc xem `docs/03-plan/roadmap.md`.

## 6. Ghi chú về cấu hình TypeScript

| Gói | Cấu hình | Vì sao |
|---|---|---|
| `shared`, `server`, `tools/*` | kế thừa `tsconfig.base.json` (module `nodenext`) | chạy trên Node.js, xuất ESM thật nên import tương đối phải ghi kèm `.js` |
| `client` | dùng cấu hình do Angular CLI sinh ra (`client/tsconfig.json`) | Angular tự quyết định `module`, decorator, template; ghi đè dễ hỏng |

`shared` được **build ra `dist/`** trước khi `server` và `tools/data-validator` dùng, nên chúng import `@ninja/shared` qua `exports` trong `package.json` (không trỏ thẳng vào file `.ts`). Vì vậy các script gốc `validate:data`, `typecheck`, `test` đều chạy `pnpm build:shared` trước.

`client` đã phụ thuộc `@ninja/shared` từ M1 để dùng chung schema dữ liệu với server (kiểm biểu mẫu, suy ra kiểu).
