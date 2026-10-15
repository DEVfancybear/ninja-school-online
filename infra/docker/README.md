# Docker cho môi trường phát triển

## Chạy dịch vụ nền

```bash
cp .env.example .env          # lần đầu
docker compose -f infra/docker/docker-compose.dev.yml up -d
```

Sau đó:

| Dịch vụ | Địa chỉ | Ghi chú |
|---|---|---|
| PostgreSQL | `localhost:5432` | user/mật khẩu/DB mặc định: `ninja` / `ninja_dev_password` / `ninja` |
| Redis | `localhost:6379` | bật appendonly |
| Adminer | http://localhost:8080 | xem dữ liệu Postgres qua trình duyệt |

## Dừng và xoá dữ liệu

```bash
docker compose -f infra/docker/docker-compose.dev.yml down        # dừng, giữ dữ liệu
docker compose -f infra/docker/docker-compose.dev.yml down -v     # dừng và xoá volume
```

## Ghi chú

- **PostgreSQL** được dùng từ M1 (tài khoản, nhân vật).
- **Redis** chưa được dùng ở M1 — dự kiến dùng từ M2 (phiên realtime, chống spam, bảng xếp hạng).
- Adminer chỉ là công cụ xem dữ liệu cho lập trình viên.
- Cổng có thể đổi qua biến trong `.env` (`POSTGRES_PORT`, `REDIS_PORT`, `ADMINER_PORT`).
- Máy phát triển cần cài Docker Desktop. Trên máy chưa có Docker thì bỏ qua bước này — lint/typecheck/test/build vẫn chạy được.
