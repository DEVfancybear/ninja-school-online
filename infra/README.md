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

## Nguyên tắc

1. Môi trường dev: `docker compose -f infra/docker/docker-compose.dev.yml up -d` là có PostgreSQL + Redis.
2. Client là file tĩnh: nginx phục vụ + CDN (nếu cần), server chạy sau proxy.
3. Bí mật (mật khẩu DB, JWT key) đặt qua biến môi trường, không commit (xem `.env.example`).
4. CI: validate:data → lint → typecheck → test → build; chặn merge khi đỏ.
