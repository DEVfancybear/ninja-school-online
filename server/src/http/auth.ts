import type { FastifyRequest } from 'fastify';
import { unauthorizedError } from '../errors.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; username: string };
    user: { sub: string; username: string };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** preHandler xác thực access token; gắn `request.user` khi hợp lệ. */
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
}

/** Xác thực access token trong header `Authorization: Bearer <token>`. */
export async function authenticate(request: FastifyRequest): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    throw unauthorizedError('phiên đăng nhập đã hết hạn, hãy đăng nhập lại');
  }
}
