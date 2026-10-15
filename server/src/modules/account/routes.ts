import type { FastifyInstance } from 'fastify';
import { LoginRequestSchema, RefreshRequestSchema, RegisterRequestSchema } from '@ninja/shared';
import { unauthorizedError } from '../../errors.js';
import { parseRequest } from '../../http/validate.js';
import { toAccountDto, type AccountService } from './service.js';

/** Các route xác thực, đều nằm dưới tiền tố /api/auth. */
export function registerAccountRoutes(app: FastifyInstance, service: AccountService): void {
  app.post('/api/auth/register', async (request, reply) => {
    const input = parseRequest(RegisterRequestSchema, request.body);
    const session = await service.register(input);
    return reply.status(201).send(session);
  });

  app.post('/api/auth/login', async (request) => {
    const input = parseRequest(LoginRequestSchema, request.body);
    return service.login(input);
  });

  app.post('/api/auth/refresh', async (request) => {
    const input = parseRequest(RefreshRequestSchema, request.body);
    return service.refresh(input.refreshToken);
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const input = parseRequest(RefreshRequestSchema, request.body);
    await service.logout(input.refreshToken);
    return reply.status(204).send();
  });

  app.get('/api/auth/me', { preHandler: app.authenticate }, async (request) => {
    const account = await service.findById(request.user.sub);
    if (!account) {
      // Token hợp lệ nhưng tài khoản đã bị xoá: coi như chưa đăng nhập.
      throw unauthorizedError('tài khoản không còn tồn tại');
    }
    return { account: toAccountDto(account) };
  });
}
