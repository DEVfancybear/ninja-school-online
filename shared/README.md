# shared/ — Thư viện dùng chung client ↔ server

**Trạng thái:** đã có mã nguồn (M0): `protocol/version.ts`, `constants/game.ts`, `schemas/{skill,item}.ts`.

## Vai trò
Chứa **hợp đồng chung** giữa client và server để hai bên không bao giờ lệch định nghĩa:

```text
shared/
└── src/
    ├── protocol/    # (M0) version.ts: PROTOCOL_VERSION
    │                # thêm ở M2: opcode, định nghĩa gói tin, codec encode/decode
    ├── constants/   # (M0) game.ts: trường, phái, quan hệ trường–phái
    ├── schemas/     # (M0) schema zod của dữ liệu game: skill, item
    └── index.ts     # điểm xuất chung
    # thêm ở cột mốc sau: types/ (DTO), utils/ (toán, RNG xác định, định dạng)
```

## Nguyên tắc
1. `shared/` **không** chứa nghiệp vụ game và không truy cập DB/mạng — chỉ định nghĩa và tiện ích thuần.
2. Mọi gói tin đều có schema (zod) để kiểm tra ở server và suy ra kiểu TypeScript cho client.
3. Thay đổi protocol phải tăng số phiên bản protocol (`PROTOCOL_VERSION`) để client cũ bị chặn rõ ràng.
4. Giữ ít phụ thuộc ngoài nhất có thể (hiện chỉ `zod`) để bundle client nhẹ.
