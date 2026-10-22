import { z } from 'zod';

/** Giá trị mặc định chỉ dùng cho môi trường phát triển cục bộ. */
const DEV_JWT_SECRET = 'dev-only-do-not-use-in-production';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    CORS_ORIGIN: z.string().default('http://localhost:4200'),
    DATABASE_URL: z
      .string()
      .min(1)
      .default('postgresql://ninja:ninja_dev_password@127.0.0.1:5432/ninja'),
    JWT_SECRET: z.string().min(16, 'JWT_SECRET phải có ít nhất 16 ký tự').default(DEV_JWT_SECRET),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
    /** M7 event is on by default; operators can disable claims/progress without a code deploy. */
    M7_EVENT_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
    /** Field boss repeats on this UTC-minute interval; defaults to the first 15 minutes of each hour. */
    FIELD_BOSS_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(1440).default(60),
    FIELD_BOSS_WINDOW_MINUTES: z.coerce.number().int().min(1).max(120).default(15),
    FIELD_BOSS_START_OFFSET_MINUTES: z.coerce.number().int().min(0).max(1439).default(0),
  })
  .superRefine((value, ctx) => {
    if (value.FIELD_BOSS_WINDOW_MINUTES > value.FIELD_BOSS_INTERVAL_MINUTES) {
      ctx.addIssue({ code: 'custom', path: ['FIELD_BOSS_WINDOW_MINUTES'], message: 'cửa sổ boss không được dài hơn chu kỳ' });
    }
    if (value.FIELD_BOSS_START_OFFSET_MINUTES >= value.FIELD_BOSS_INTERVAL_MINUTES) {
      ctx.addIssue({ code: 'custom', path: ['FIELD_BOSS_START_OFFSET_MINUTES'], message: 'mốc mở boss phải nằm trong chu kỳ UTC' });
    }
    if (value.NODE_ENV === 'production' && value.JWT_SECRET === DEV_JWT_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message:
          'không được dùng JWT_SECRET mặc định của môi trường phát triển khi chạy production',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/** Đọc và kiểm tra biến môi trường. Sai định dạng thì ném lỗi rõ ràng. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Cấu hình môi trường không hợp lệ — ${detail}`);
  }
  return result.data;
}
