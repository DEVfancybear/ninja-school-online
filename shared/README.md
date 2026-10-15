# shared/ — Thư viện dùng chung client ↔ server

**Trạng thái:** trống, chưa có mã nguồn.

## Vai trò
Chứa **hợp đồng chung** giữa client và server để hai bên không bao giờ lệch định nghĩa:

```text
shared/
└── src/
    ├── protocol/    # opcode (mã gói tin), định nghĩa gói tin, codec encode/decode
    ├── constants/   # enum: trường/phái, loại vật phẩm, mã lỗi, trạng thái
    ├── types/       # kiểu dữ liệu: nhân vật, vật phẩm, nhiệm vụ, trận đấu...
    └── utils/       # toán, RNG xác định (deterministic), định dạng số/ngày giờ
```

## Nguyên tắc
1. `shared/` **không** chứa nghiệp vụ game và không truy cập DB/mạng — chỉ định nghĩa và tiện ích thuần.
2. Mọi gói tin đều có schema (zod) để kiểm tra ở server và suy ra kiểu TypeScript cho client.
3. Thay đổi protocol phải tăng số phiên bản protocol (`PROTOCOL_VERSION`) để client cũ bị chặn rõ ràng.
4. Giữ ít phụ thuộc ngoài nhất có thể (chỉ zod, msgpackr) để client bundle nhẹ.
