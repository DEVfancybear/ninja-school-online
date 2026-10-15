# Ninja School Online — Game nhập vai ninja chơi trên web

Dự án game **nhập vai 2D nhiều người chơi (MMORPG nhẹ)**, chiến đấu theo lượt, **chơi trực tiếp trên trình duyệt** (máy tính + mobile web), lấy cảm hứng từ dòng game "Ninja School Online" nổi tiếng ở Việt Nam.

> **Trạng thái: đã xong Giai đoạn 0 (nghiên cứu & thiết kế) và mốc M0 (nền móng kỹ thuật).**
> Repo đã có monorepo chạy được: Angular + Phaser (client), Fastify (server), schema dùng chung (shared), công cụ kiểm tra dữ liệu, CI và Docker Compose. Chưa có gameplay.

## Lệnh nhanh

```bash
pnpm install            # cài phụ thuộc (pnpm 12 trở lên)
pnpm build              # build shared → server/tools/client
pnpm dev                # chạy client (ng serve) + server (tsx watch)
pnpm lint && pnpm typecheck && pnpm test
pnpm validate:data      # kiểm tra game-data/ theo schema
```

Dịch vụ nền cho M1 (chưa cần ở M0): `docker compose -f infra/docker/docker-compose.dev.yml up -d`.

## 1. Quyết định đã chốt (theo yêu cầu)

| Hạng mục | Quyết định |
|---|---|
| Nền tảng chơi | **Web** (trình duyệt desktop + mobile), không cần tải app |
| Thể loại | Nhập vai 2D, chiến đấu theo lượt, thế giới nhẫn giả (trường học ninja) |
| Ngôn ngữ | TypeScript cho cả client và server |
| Client | **Angular 22** (giao diện, HUD, định tuyến) + **Phaser 4** (vẽ thế giới 2D) |
| Kiến trúc | Client-server, **server là nguồn sự thật** (server-authoritative) |
| Bản quyền | Nội dung **nguyên bản 100%**, chỉ học ý tưởng gameplay từ game gốc |

## 2. Giả định đã dùng để viết tài liệu

- Tên đang dùng cho repo và giao diện là **Ninja School Online** — đây là quyết định của chủ dự án, không phải tên tự chọn của tài liệu. Tên này trùng tên một game đã có bản quyền nên có rủi ro thương hiệu; xem mục 6.
- Tên gói trong monorepo dùng tiền tố `@ninja/`.
- Quy mô mục tiêu ban đầu: vài trăm người chơi đồng thời (CCU), chạy tốt trên 1 VPS nhỏ khi ra demo.
- Stack đã chốt: **Angular + Phaser** (client), Node.js + TypeScript + Fastify/ws (server), PostgreSQL + Redis, Docker Compose. Xem `docs/02-architecture/tech-stack.md`.
- **Không** tái hiện: nạp tiền thật, minigame cờ bạc (Tài Xỉu...), auto/mod, sao chép tài nguyên của bất kỳ game nào.

## 3. Đọc gì trước (theo thứ tự)

1. `docs/01-research/game-overview.md` — Ninja School Online là gì, lịch sử, gameplay cốt lõi.
2. `docs/01-research/game-systems.md` — Danh mục hệ thống game + mức ưu tiên cho bản remake.
3. `docs/01-research/reference-sources.md` — Nguồn tham khảo, bài học từ source cộng đồng, **lưu ý pháp lý**.
4. `docs/02-architecture/tech-stack.md` — Công nghệ chọn cho web + phương án thay thế.
5. `docs/02-architecture/project-structure.md` — Cấu trúc thư mục chi tiết và quy ước.
6. `docs/02-architecture/network-and-data.md` — Giao thức mạng, thiết kế dữ liệu, chống gian lận.
7. `docs/03-plan/roadmap.md` — Lộ trình M0 → M8, tiêu chí nghiệm thu, rủi ro.

## 4. Cấu trúc thư mục hiện tại

```text
ninja/
├── README.md               # file này
├── package.json            # script gốc của monorepo + tooling dùng chung
├── pnpm-workspace.yaml     # khai báo workspace + cấu hình pnpm 12 (allowBuilds)
├── pnpm-lock.yaml
├── tsconfig.base.json      # cấu hình TS cho shared/server/tools (client dùng cấu hình của Angular)
├── eslint.config.js        # ESLint flat config cho shared/server/tools
├── .prettierrc.json, .prettierignore, .editorconfig, .gitattributes
├── .env.example            # mẫu biến môi trường (file .env thật không được commit)
├── .github/workflows/ci.yml# CI: validate:data → lint → typecheck → test → build
├── docs/                   # toàn bộ tài liệu dự án
│   ├── README.md
│   ├── 01-research/        # nghiên cứu game gốc + nguồn tham khảo
│   ├── 02-architecture/    # công nghệ, cấu trúc, mạng & dữ liệu
│   └── 03-plan/            # lộ trình, MVP, rủi ro
├── client/                 # Angular 22 + Phaser 4: giao diện, HUD, vẽ thế giới 2D
├── server/                 # Node.js + Fastify: /health, /version (ws thêm ở cột mốc sau)
├── shared/                 # PROTOCOL_VERSION, hằng số trường/phái, schema zod của game-data
├── game-data/              # dữ liệu nội dung game dạng JSON (đã có ví dụ skill/item)
├── assets/                 # chỉ có README + CREDITS; chưa có tài nguyên hình/âm thanh
├── tools/                  # data-validator: kiểm tra game-data theo schema
├── infra/                  # Docker Compose cho PostgreSQL + Redis (môi trường dev)
└── tests/                  # chỉ có README; chưa có e2e (Playwright) và kiểm thử tải (k6)
```

Các thư mục `client/`, `server/`, `shared/`, `tools/data-validator/` đã có mã nguồn chạy được.
`assets/` và `tests/` mới chỉ có README mô tả mục đích; sẽ có nội dung ở các cột mốc sau.

## 5. Việc tiếp theo (từ M1)

- [x] ~~Xác nhận stack~~ → **Angular + Phaser + Node.js + PostgreSQL + Redis + Docker** (2026-10-15).
- [x] ~~M0: khởi tạo monorepo pnpm, tsconfig, ESLint/Prettier, CI, docker-compose~~ → xong (xem `docs/03-plan/roadmap.md`).
- [ ] **M1: tài khoản + tạo nhân vật** — cần PostgreSQL chạy trước (`docker compose -f infra/docker/docker-compose.dev.yml up -d`).
- [ ] Quyết định có đổi tên sản phẩm hay không (xem mục 6).

## 6. Lưu ý bản quyền (đọc kỹ)

Ninja School Online là sản phẩm có bản quyền của TeaMobi, hiện được cấp phép phát hành bởi Gomobi. Ở Việt Nam đã có **vụ án hình sự năm 2026** với người sao chép game này (xem `docs/01-research/reference-sources.md`).

Vì vậy dự án này chỉ **học ý tưởng và cấu trúc gameplay** (vốn không được bảo hộ như ý tưởng), **tuyệt đối không**:
- sao chép mã nguồn, tài nguyên hình ảnh/âm thanh, cốt truyện, nhân vật của NSO hoặc game khác;
- chạy "private server" của game gốc.

Toàn bộ hình ảnh, âm thanh, cốt truyện, tên nhân vật và chiêu thức trong game sẽ do dự án **tự sản xuất hoặc dùng tài nguyên có license rõ ràng**.

### Riêng về tên sản phẩm

Chủ dự án đã đặt tên repo và giao diện là **Ninja School Online**, trùng tên game gốc. Tài liệu **không** tự ý đổi, nhưng cần nói rõ đây là điểm rủi ro:

- "Ninja School" gắn với sản phẩm có bản quyền và có thể được bảo hộ dưới dạng **nhãn hiệu**; dùng cùng tên cho một game khác dễ gây nhầm lẫn nguồn gốc.
- Vụ án năm 2026 cho thấy chủ thể quyền **thực sự** khởi kiện khi có hành vi sao chép/phát hành trái phép.
- **Khuyến nghị:** giữ tên này trong giai đoạn học tập nội bộ, nhưng **đổi tên sản phẩm trước khi công bố/phát hành rộng rãi**. Việc đổi tên chỉ ảnh hưởng phần hiển thị và tên repo, không ảnh hưởng mã nguồn.

Cách đổi khi cần: sửa chuỗi hiển thị trong `client/src/index.html`, `client/src/app/pages/home/home.ts` và `client/src/app/app.routes.ts` (tiêu đề trang).
