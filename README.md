# ninja (tên tạm) — Game nhập vai ninja chơi trên web

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

- Tên dự án chính thức **chưa chọn**; tài liệu dùng tên tạm `ninja`. Không dùng tên "Ninja School" cho sản phẩm (xem mục 6).
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
├── .gitignore
├── docs/                   # toàn bộ tài liệu dự án
│   ├── README.md
│   ├── 01-research/        # nghiên cứu game gốc + nguồn tham khảo
│   ├── 02-architecture/    # công nghệ, cấu trúc, mạng & dữ liệu
│   └── 03-plan/            # lộ trình, MVP, rủi ro
├── client/                 # Angular 22 + Phaser 4: giao diện, HUD, vẽ thế giới 2D
├── server/                 # Node.js + Fastify: /health, /version (ws thêm ở cột mốc sau)
├── shared/                 # phiên bản protocol, hằng số, schema zod của game-data
├── game-data/              # dữ liệu nội dung game dạng JSON (đã có ví dụ skill/item)
├── assets/                 # (trống) file nguồn hình/âm thanh do dự án tự sản xuất
├── tools/                  # data-validator: kiểm tra game-data theo schema
├── infra/                  # Docker Compose cho PostgreSQL + Redis (môi trường dev)
└── tests/                  # (trống) e2e (Playwright) và kiểm thử tải (k6)
```

Thư mục trống sẽ có `README.md` mô tả mục đích và cấu trúc dự kiến bên trong. Khi bắt đầu code sẽ bổ sung `package.json`, workspace pnpm, tsconfig... (xem lộ trình M0).

## 5. Việc tiếp theo (khi bắt đầu code)

- [x] ~~Xác nhận stack~~ → **Angular + Phaser + Node.js + PostgreSQL + Redis + Docker** (2026-10-15).
- [x] ~~M0: khởi tạo monorepo pnpm, tsconfig, ESLint/Prettier, CI, docker-compose~~ → xong (xem `docs/03-plan/roadmap.md`).
- [ ] Chốt tên dự án + tên miền (tránh trùng thương hiệu game gốc).
- [ ] **M1: tài khoản + tạo nhân vật** (xem `docs/03-plan/roadmap.md`).

## 6. Lưu ý bản quyền (đọc kỹ)

Ninja School Online là sản phẩm có bản quyền của TeaMobi, hiện được cấp phép phát hành bởi Gomobi. Ở Việt Nam đã có **vụ án hình sự năm 2026** với người sao chép game này (xem `docs/01-research/reference-sources.md`).

Vì vậy dự án này chỉ **học ý tưởng và cấu trúc gameplay** (vốn không được bảo hộ như ý tưởng), **tuyệt đối không**:
- sao chép mã nguồn, tài nguyên hình ảnh/âm thanh, cốt truyện, nhân vật, tên game của NSO hoặc game khác;
- chạy "private server" của game gốc.

Toàn bộ hình ảnh, âm thanh, cốt truyện, tên gọi trong game sẽ do dự án **tự sản xuất hoặc dùng tài nguyên có license rõ ràng**.
