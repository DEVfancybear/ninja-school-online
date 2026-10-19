import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { ApiErrorCode, PROTOCOL_VERSION } from '@ninja/shared';
import type { Env } from './config/env.js';
import type { Db } from './db/client.js';
import { AppError } from './errors.js';
import { authenticate } from './http/auth.js';
import { AccountService } from './modules/account/service.js';
import { registerAccountRoutes } from './modules/account/routes.js';
import { CharacterService } from './modules/character/service.js';
import { registerCharacterRoutes } from './modules/character/routes.js';
import { ChatService } from './modules/chat/service.js';
import { EquipmentService } from './modules/equipment/service.js';
import { InventoryService } from './modules/inventory/service.js';
import { NpcService } from './modules/npc/service.js';
import { QuestService } from './modules/quest/service.js';
import { ShopService } from './modules/shop/service.js';
import { UpgradeService } from './modules/upgrade/service.js';
import { RoomManager } from './core/room-manager.js';
import { TickScheduler } from './core/tick.js';
import { WebSocketGateway } from './net/ws-server.js';
import { SessionRegistry } from './net/session-registry.js';
import { argon2PasswordHasher } from './security/password.js';
import { TokenService } from './security/tokens.js';
import { loadGameData } from './world/game-data.js';
import { WorldService, type AccountToken } from './world/world-service.js';

export interface CreateAppOptions {
  env: Env;
  db: Db;
  /** Thư mục game-data; mặc định là `game-data/` ở gốc repo. */
  gameDataDir?: string;
  /** Ghi đè tham số WebSocket — chỉ dùng cho kiểm thử (thời gian chờ bắt tay, heartbeat). */
  websocket?: {
    path?: string;
    handshakeTimeoutMs?: number;
    heartbeatTimeoutMs?: number;
  };
}

/** Ghép toàn bộ plugin, dịch vụ và route thành một instance Fastify (kiểm thử bằng app.inject()). */
export async function createApp(options: CreateAppOptions): Promise<FastifyInstance> {
  const { env, db } = options;
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });

  await app.register(cors, { origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()) });
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_ACCESS_TTL_SECONDS },
  });
  app.decorate('authenticate', authenticate);

  const tokens = new TokenService(db, { refreshTtlDays: env.JWT_REFRESH_TTL_DAYS });
  const accountService = new AccountService({
    db,
    hasher: argon2PasswordHasher,
    tokens,
    signAccessToken: (payload) => app.jwt.sign(payload),
  });

  app.get('/health', async () => {
    let database: 'up' | 'down' = 'up';
    try {
      await db.execute(sql`select 1`);
    } catch {
      database = 'down';
    }
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      protocolVersion: PROTOCOL_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
    };
  });

  app.get('/version', async () => ({
    protocolVersion: PROTOCOL_VERSION,
    corsOrigin: env.CORS_ORIGIN,
  }));

  registerAccountRoutes(app, accountService);

  // --- Thế giới & realtime (M2). game-data được kiểm ngay ở đây: dữ liệu sai thì app không dựng
  // được, nên server sẽ không khởi động với nội dung hỏng.
  const gameData = await loadGameData(options.gameDataDir);
  const inventoryService = new InventoryService(db, gameData);
  const characterService = new CharacterService(db, inventoryService, gameData);
  const equipmentService = new EquipmentService(gameData, characterService, inventoryService);
  const shopService = new ShopService(db, gameData, characterService, inventoryService);
  const upgradeService = new UpgradeService(db, gameData, characterService, inventoryService);
  // Nhiệm vụ cần cả nhân vật (kinh nghiệm/cấp) lẫn túi đồ (quà và mục tiêu `collect`) để trả thưởng.
  const questService = new QuestService(db, gameData, characterService, inventoryService);
  const tick = new TickScheduler();
  const rooms = new RoomManager({
    gameData,
    tick,
    onError: (error, mapId) => {
      app.log.error({ err: error, mapId }, 'room gặp lỗi trong nhịp tick');
    },
    // `world` được tạo ngay dưới đây (nó cần `rooms`); hàm này chỉ chạy trong nhịp tick, lúc đó
    // `world` đã tồn tại.
    onPortal: (room, player, portal) => {
      world.enterPortal(room, player, portal);
    },
  });
  const verifyAccessToken = (raw: string): AccountToken | undefined => {
    try {
      return app.jwt.verify<AccountToken>(raw);
    } catch {
      // Chữ ký sai hoặc đã hết hạn: coi như chưa đăng nhập.
      return undefined;
    }
  };

  const world = new WorldService({
    gameData,
    rooms,
    sessions: new SessionRegistry(),
    characters: characterService,
    chat: new ChatService(),
    npcs: new NpcService(shopService),
    inventory: inventoryService,
    equipment: equipmentService,
    shop: shopService,
    upgrade: upgradeService,
    quests: questService,
    tick,
    verifyToken: verifyAccessToken,
  });
  // Nhân vật cần game-data (đồ khởi đầu, chỉ số phái) nên route đăng ký sau khi nạp game-data.
  registerCharacterRoutes(app, characterService);

  const gateway = new WebSocketGateway({ app, world, tick, ...options.websocket });
  gateway.attach();
  tick.start();

  app.addHook('onClose', async () => {
    // Gateway đã tự đóng socket + gỡ listener trong hook `preClose` của nó (xem net/ws-server.ts);
    // ở đây chỉ còn dừng nhịp tick và xoá các room.
    world.battle.dispose();
    rooms.dispose();
    tick.dispose();
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      error: ApiErrorCode.NOT_FOUND,
      message: `không có đường dẫn ${request.method} ${request.url}`,
    });
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    }
    if (error.validation) {
      return reply
        .status(400)
        .send({ error: ApiErrorCode.VALIDATION, message: 'dữ liệu gửi lên không hợp lệ' });
    }
    request.log.error(error);
    return reply
      .status(500)
      .send({ error: ApiErrorCode.INTERNAL, message: 'lỗi hệ thống, hãy thử lại sau' });
  });

  return app;
}
