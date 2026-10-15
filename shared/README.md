# shared/ — Thư viện dùng chung client ↔ server

**Trạng thái:** đã có mã nguồn từ M0, mở rộng ở M1 (tài khoản, nhân vật).

## Vai trò
Chứa **hợp đồng chung** giữa client và server để hai bên không bao giờ lệch định nghĩa.

```text
shared/
├── src/
│   ├── protocol/    # (M0) version.ts: PROTOCOL_VERSION
│   │                # thêm ở M2: opcode, định nghĩa gói tin, codec encode/decode
│   ├── constants/   # (M0) game.ts: trường, phái, quan hệ trường–phái
│   │                # (M1) account.ts: quy tắc tên đăng nhập/mật khẩu, giới hạn số nhân vật
│   │                # (M1) character.ts: quy tắc và mẫu tên nhân vật
│   ├── schemas/     # (M0) skill.ts, item.ts — dữ liệu game
│   │                # (M1) common.ts (hình dạng lỗi API), account.ts, character.ts
│   └── index.ts     # điểm xuất chung
│   # thêm ở cột mốc sau: types/ (DTO), utils/ (toán, RNG xác định, định dạng)
├── scripts/         # mark-cjs.mjs: đánh dấu thư mục dist-cjs là CommonJS
└── test/            # vitest: game-data.spec.ts (6), account-character.spec.ts (14)
```

## Nguyên tắc
1. `shared/` **không** chứa nghiệp vụ game và không truy cập DB/mạng — chỉ định nghĩa và tiện ích thuần.
2. Mọi dữ liệu vào/ra của API và mọi file trong `game-data/` đều có schema zod ở đây; client dùng cùng
   schema để kiểm biểu mẫu, server dùng lại để kiểm dữ liệu nhận được — nhờ vậy hai bên không lệch quy tắc.
3. Thay đổi protocol phải tăng `PROTOCOL_VERSION` để client cũ bị chặn rõ ràng.
4. Giữ ít phụ thuộc ngoài nhất có thể (hiện chỉ `zod`).
5. Gói được build ra **hai bản**: `dist/` (ESM, cho server và client) và `dist-cjs/` (CommonJS, cho công
   cụ chỉ hỗ trợ CJS như `drizzle-kit`). Script `prepare` bảo đảm `pnpm install` trên máy sạch tự build cả hai.
