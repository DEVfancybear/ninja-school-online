/**
 * Đường dẫn API, luôn tương đối để đi cùng origin với trang: dev server chuyển tiếp `/api`
 * sang server game qua `client/proxy.conf.json`, nên không hardcode host ở đâu cả.
 *
 * Hợp đồng M1 đặt mọi endpoint dưới `/api`. Nếu server game đăng ký route ở đường dẫn gốc
 * thì chỉ cần sửa hằng số `API_BASE` ở đây (kèm tiền tố khoá trong `proxy.conf.json`).
 */
export const API_BASE = '/api';

const AUTH_BASE = `${API_BASE}/auth`;

export const REGISTER_PATH = `${AUTH_BASE}/register`;
export const LOGIN_PATH = `${AUTH_BASE}/login`;
export const REFRESH_PATH = `${AUTH_BASE}/refresh`;
export const ME_PATH = `${AUTH_BASE}/me`;
export const CHARACTERS_PATH = `${API_BASE}/characters`;
