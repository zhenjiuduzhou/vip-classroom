import type { Context } from 'hono';
export interface Env {
  BOOTSTRAP_TOKEN?: string;
  SETTINGS_ENCRYPTION_KEY?: string;
  DB: D1Database; MEDIA: R2Bucket; APP_ORIGIN: string; ENVIRONMENT: string;
  R2_ACCOUNT_ID: string; R2_BUCKET_NAME: string; R2_ACCESS_KEY_ID: string; R2_SECRET_ACCESS_KEY: string;
}
export interface User {
  id: string; email: string | null; phone: string | null; name: string; role: 'USER' | 'ADMIN';
  vip_level: number | null; vip_expires_at: string | null; password_hash: string; created_at: string;
}
export type App = { Bindings: Env; Variables: { user: User } };
export type Ctx = Context<App>;
export const publicUser = (u: User) => ({ id: u.id, email: u.email, phone: u.phone, name: u.name, role: u.role,
  vipLevel: u.vip_level, vipExpiresAt: u.vip_expires_at, createdAt: u.created_at });
