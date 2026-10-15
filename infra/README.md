# infra/ — Hạ tầng & triển khai

## Đã có (M0)

```text
infra/
├── docker/
│   ├── docker-compose.dev.yml    # PostgreSQL 16 + Redis 7 + Adminer
│   └── README.md                 # cách chạy và dừng
└── README.md                     # file này
```

CI thật nằm ở `.github/workflows/ci.yml` (validate:data → lint → typecheck → test → build).

## Dự kiến thêm sau

```text
infra/
├── docker/
│   ├── docker-compose.prod.yml   # server + postgres + redis + nginx
│   ├── Dockerfile.server
│   └── nginx.conf                # phục vụ client tĩnh, proxy API + WebSocket
└── deploy/                       # systemd/PM2, certbot, kịch bản sao lưu — làm ở M8
```

## Chạy PostgreSQL không cần Docker (máy dev hiện tại)

Máy dev này **chưa cài Docker**, nên PostgreSQL 16.10 được chạy trực tiếp từ bộ binaries chính thức
(không cần quyền admin, không đăng ký Windows service).

| Thành phần | Đường dẫn |
|---|---|
| Bộ binaries PostgreSQL 16.10 | `C:\Users\Duong\Downloads\ninja-dev\pg16\pgsql\bin` |
| Cụm dữ liệu (data directory) | `C:\Users\Duong\Downloads\ninja-dev\pgdata` |
| Log | `C:\Users\Duong\Downloads\ninja-dev\pg.log` |
| Script bật/tắt | `C:\Users\Duong\Downloads\ninja-dev\pg-start.cmd`, `pg-stop.cmd` |
| Script tách tiến trình | `C:\Users\Duong\Downloads\ninja-dev\pg-task.cmd` (`install`, `start`, `stop`, `status`, `delete`) |

Cả thư mục nằm **ngoài repo** nên không bao giờ bị commit.

### Vì sao phải dùng Task Scheduler

Mỗi lệnh chạy trong phiên làm việc bị dọn theo cây tiến trình, nên `pg_ctl start` thường lệ sẽ bị tắt
ngay sau khi lệnh kết thúc. Cách chạy bền: đăng ký một Scheduled Task gọi `pg-run.cmd`, để tiến trình
`postgres` thuộc Task Scheduler thay vì thuộc shell.

```bat
:: một lần đầu
C:\Users\Duong\Downloads\ninja-dev\pg-task.cmd install
C:\Users\Duong\Downloads\ninja-dev\pg-task.cmd start
```

### Thông tin kết nối (khớp `.env.example`)

| Mục | Giá trị |
|---|---|
| Host / cổng | `127.0.0.1:5432` |
| Superuser / mật khẩu | `ninja` / `ninja_dev_password` |
| Database phát triển | `ninja` |
| Database kiểm thử | `ninja_test` (đặt qua `TEST_DATABASE_URL`) |

### Khởi tạo lại từ đầu (nếu cần)

```bash
# 1) tải binaries (khoảng 320 MB) rồi giải nén vào ninja-dev/pg16
# 2) tạo cụm dữ liệu
initdb -D <pgdata> -U ninja --auth-host=scram-sha-256 --encoding=UTF8 --locale=C --pwfile=<file chứa mật khẩu>
# 3) bật lên rồi tạo database
createdb -h 127.0.0.1 -U ninja ninja
createdb -h 127.0.0.1 -U ninja ninja_test
# 4) chạy migration
pnpm --filter @ninja/server db:migrate
```

Khi nào cài Docker Desktop, có thể bỏ cách này và quay lại `docker-compose.dev.yml` bình thường.

## Nguyên tắc

1. Môi trường dev: `docker compose -f infra/docker/docker-compose.dev.yml up -d` là có PostgreSQL + Redis.
2. Client là file tĩnh: nginx phục vụ + CDN (nếu cần), server chạy sau proxy.
3. Bí mật (mật khẩu DB, JWT key) đặt qua biến môi trường, không commit (xem `.env.example`).
4. CI: validate:data → lint → typecheck → test → build; chặn merge khi đỏ.
