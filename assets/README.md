# assets/ — Tài nguyên nguồn (hình ảnh, âm thanh)

**Trạng thái:** trống, chưa có tài nguyên.

## Vai trò
Chứa **file nguồn** của hình ảnh và âm thanh (ví dụ `.aseprite`, `.psd`, `.wav`), từ đó công cụ trong `tools/` đóng gói thành atlas/nén để client dùng.

```text
assets/
├── art/
│   ├── characters/   # nhân vật theo phái, hướng, hoạt ảnh
│   ├── monsters/     # quái, boss
│   ├── tilesets/     # gạch bản đồ
│   ├── ui/           # khung, nút, icon
│   └── effects/      # hiệu ứng chiêu thức
├── audio/
│   ├── sfx/
│   └── music/
└── fonts/
```

## Chính sách tài nguyên (bắt buộc)
1. **100% nguyên bản**: tự vẽ/tự làm, hoặc mua license, hoặc tài nguyên CC0 được phép dùng thương mại.
2. **Cấm** trích xuất (rip) hình/âm từ Ninja School Online hay bất kỳ game nào khác.
3. Mỗi tài nguyên ngoài phải ghi nguồn + license vào `assets/CREDITS.md` (đã có khung sẵn trong thư mục này).
4. Phong cách: 2D pixel/vector đơn giản, phong cách Nhật Bản (làng, trường học, rừng tre...) nhưng **nhân vật và bối cảnh là sáng tạo mới**.
