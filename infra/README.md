# infra/ — Hạ tầng & triển khai

**Trạng thái:** trống, chưa có file cấu hình.

## Dự kiến
```text
infra/
├── docker/
│   ├── docker-compose.dev.yml    # postgres + redis + adminer cho máy dev
│   ├── docker-compose.prod.yml   # server + postgres + redis + nginx
│   ├── Dockerfile.server
│   └── nginx.conf                # phục vụ client tĩnh, proxy API + WS
├── deploy/                       # kịch bản triển khai VPS (systemd/PM2, certbot)
└── ci/                           # ghi chú pipeline (workflow thật đặt ở .github/workflows)
```

## Nguyên tắc
1. Môi trường dev: chỉ cần `docker compose up` là có PostgreSQL + Redis.
2. Client là file tĩnh: nginx phục vụ + CDN (nếu cần), server chạy sau proxy.
3. Bí mật (mật khẩu DB, JWT key) đặt qua biến môi trường, không commit.
4. CI: lint → typecheck → test → build; chặn merge khi đỏ.
