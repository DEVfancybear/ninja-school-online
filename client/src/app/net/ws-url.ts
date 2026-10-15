/**
 * Đường dẫn WebSocket của game server. Dev server chuyển tiếp `/ws` sang server game,
 * nên client chỉ cần nối tới cùng origin với trang (xem `client/proxy.conf.json`).
 */
export const WS_PATH = '/ws';

/** Phần tối thiểu của `window.location` cần cho việc đổi giao thức. */
export interface OriginLike {
  readonly protocol: string;
  readonly host: string;
}

/**
 * Đổi origin của trang thành URL WebSocket **cùng origin**: `http` → `ws`, `https` → `wss`.
 * Không hardcode host ở đâu cả để chạy được cả dev (qua proxy) lẫn production (sau nginx).
 */
export function wsUrlFor(origin: OriginLike, path: string = WS_PATH): string {
  const protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${origin.host}${path}`;
}

/** URL WebSocket của trang hiện tại; dùng origin giả khi không có `location` (kiểm thử, SSR). */
export function currentWsUrl(path: string = WS_PATH, origin?: OriginLike): string {
  const source = origin ?? globalThis.location ?? { protocol: 'http:', host: 'localhost' };
  return wsUrlFor(source, path);
}
