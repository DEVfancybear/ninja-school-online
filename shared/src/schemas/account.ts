import { z } from 'zod';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from '../constants/account.js';

export const UsernameSchema = z
  .string()
  .min(USERNAME_MIN_LENGTH, `tên đăng nhập phải có ít nhất ${USERNAME_MIN_LENGTH} ký tự`)
  .max(USERNAME_MAX_LENGTH, `tên đăng nhập tối đa ${USERNAME_MAX_LENGTH} ký tự`)
  .regex(/^[a-z0-9_]+$/, 'tên đăng nhập chỉ gồm chữ thường, chữ số và dấu gạch dưới');

export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `mật khẩu phải có ít nhất ${PASSWORD_MIN_LENGTH} ký tự`)
  .max(PASSWORD_MAX_LENGTH, `mật khẩu tối đa ${PASSWORD_MAX_LENGTH} ký tự`);

export const EmailSchema = z.email().max(254);

export const RegisterRequestSchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
  email: EmailSchema.optional(),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  username: UsernameSchema,
  password: z.string().min(1, 'hãy nhập mật khẩu'),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const RefreshRequestSchema = z.object({ refreshToken: z.string().min(1) });
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

/** Thông tin tài khoản trả về cho client (không bao giờ có mật khẩu hay hash). */
export const AccountSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  createdAt: z.iso.datetime(),
});
export type Account = z.infer<typeof AccountSchema>;

export const AuthTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
export type AuthTokens = z.infer<typeof AuthTokensSchema>;

/** Kết quả đăng ký hoặc đăng nhập. */
export const AuthSessionSchema = AuthTokensSchema.extend({ account: AccountSchema });
export type AuthSession = z.infer<typeof AuthSessionSchema>;
