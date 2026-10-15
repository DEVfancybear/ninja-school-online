# Cấu trúc dự án

*Ngày viết: 2026-10-15. Đây là cấu trúc đích mà dự án sẽ theo khi bắt đầu code (hiện tại các thư mục còn trống, chỉ có README).*

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
├── pnpm-workspace.yaml           # khai báo workspace: client, server, shared
├── tsconfig.base.json            # cấu hình TS chung
│
├── docs/                         # tài liệu dự án (đã có)
│   ├── 01-research/
│   ├── 02-architecture/
│   └── 03-plan/
│
├── client/                       # CLIENT WEB (Phaser 3 + Vite + TS)
│   ├── index.html
│   ├── public/                   # favicon, manifest PWA, tài nguyên tĩnh
│   └── src/
│       ├── main.ts               # điểm khởi động
│       ├── core/                 # bootstrap, vòng lặp, scene manager, asset loader, audio
│       ├── net/                  # WebSocket client (reconnect, backoff, hàng đợi), REST client
│       ├── state/                # store: phiên, nhân vật, túi đồ, nhiệm vụ, trận đấu
│       ├── scenes/               # login, chọn nhân vật, thế giới, trận đấu, lôi đài
│       ├── world/                # render bản đồ (tilemap), thực thể, camera
│       ├── battle/               # UI sàn đấu theo lượt + hiệu ứng chiêu
│       ├── ui/                   # HUD, chat, túi, nhiệm vụ, shop, hộp thoại
│       ├── input/                # bàn phím, chạm, joystick ảo
│       └── i18n/                 # chuỗi giao diện (tiếng Việt trước)
│
├── server/                       # GAME SERVER (Node.js + Fastify + ws)
│   ├── src/
│   │   ├── main.ts               # khởi động, nạp config + game-data
│   │   ├── config/               # env, feature flags, nạp/kiểm tra game-data
│   │   ├── net/                  # WS server, connection registry, codec, handshake xác thực
│   │   ├── core/                 # tick scheduler, event bus, room manager, id generator
│   │   ├── world/                # map instance, spawn quái, kiểm tra di chuyển, tầm nhìn
│   │   ├── modules/              # nghiệp vụ theo hệ thống (xem mục 3)
│   │   ├── db/                   # schema, migrations, repository
│   │   └── security/             # rate-limit, chống gian lận, audit log
│   └── (test/, package.json)
│
├── shared/                       # HỢP ĐỒNG CHUNG client ↔ server
│   └── src/
│       ├── protocol/             # opcode, định nghĩa gói tin, encode/decode, PROTOCOL_VERSION
│       ├── constants/            # enum: trường/phái, loại vật phẩm, mã lỗi
│       ├── types/                # kiểu DTO: nhân vật, vật phẩm, nhiệm vụ, trận đấu
│       └── utils/                # toán, RNG xác định, định dạng
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
| M1–M3 (MVP) | `client/src/*`, `server/src/{net,core,world}`, `modules/{account,character,npc,inventory,battle,skill}`, `shared/src/protocol`, `game-data/{maps,monsters,items,skills,classes,npcs}`, `tests/e2e` (kịch bản 1–3) |
| M4–M6 (Alpha) | `modules/{quest,social,arena,mail}`, mở rộng `game-data/{quests,shops,items}`, `tools/{map-editor,asset-pipeline}`, bổ sung `tests/e2e` (kịch bản 4–5) |
| M7–M8 (Beta) | `modules/{guild,event}`, `tools/gm-cli`, `infra/deploy`, `tests/load` |

Chi tiết tiêu chí từng mốc xem `docs/03-plan/roadmap.md`.
