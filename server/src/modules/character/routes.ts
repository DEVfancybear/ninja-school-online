import type { FastifyInstance } from 'fastify';
import { CreateCharacterRequestSchema } from '@ninja/shared';
import { parseRequest } from '../../http/validate.js';
import type { CharacterService } from './service.js';

/** Các route quản lý nhân vật; đều yêu cầu đăng nhập. */
export function registerCharacterRoutes(app: FastifyInstance, service: CharacterService): void {
  app.get('/api/characters', { preHandler: app.authenticate }, async (request) => {
    return { characters: await service.list(request.user.sub) };
  });

  app.post('/api/characters', { preHandler: app.authenticate }, async (request, reply) => {
    const input = parseRequest(CreateCharacterRequestSchema, request.body);
    const character = await service.create(request.user.sub, input);
    return reply.status(201).send({ character });
  });
}
