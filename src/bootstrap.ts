import type { Ctx, Env } from './types';
import { hashPassword, normalizeEmail, sha256, validPassword } from './security';

export async function installationClosed(env: Env) {
  return !!await env.DB.prepare("SELECT 1 AS closed FROM installation WHERE id=1 UNION ALL SELECT 1 FROM users WHERE role='ADMIN' LIMIT 1").first();
}
function tokenReady(env: Env) {
  return typeof env.BOOTSTRAP_TOKEN === 'string' && env.BOOTSTRAP_TOKEN.length >= 32 && env.BOOTSTRAP_TOKEN.length <= 256;
}
export async function bootstrapStatus(c: Ctx) {
  if (await installationClosed(c.env)) return c.json({ state: 'completed' });
  return c.json({ state: tokenReady(c.env) ? 'ready' : 'disabled' });
}
export async function createFirstAdmin(c: Ctx) {
  if (await installationClosed(c.env)) return c.json({ error: '本站已完成初始化，入口已关闭' }, 409);
  if (!tokenReady(c.env)) return c.json({ error: '请先在 Cloudflare 为 Worker 配置 BOOTSTRAP_TOKEN Secret（32–256字符）' }, 503);
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b.token !== 'string' || b.token.length > 256) return c.json({ error: '初始化密钥错误' }, 403);
  const actual = await sha256(b.token), expected = await sha256(c.env.BOOTSTRAP_TOKEN!);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  if (difference) return c.json({ error: '初始化密钥错误' }, 403);
  if (!validPassword(b.password) || b.password !== b.confirmPassword) return c.json({ error: '密码须为6–128个字符，且两次一致' }, 400);
  let email: string | null;
  try { email = normalizeEmail(typeof b.email === 'string' ? b.email : ''); }
  catch { return c.json({ error: '请填写有效的管理员邮箱' }, 400); }
  if (!email) return c.json({ error: '请填写管理员邮箱' }, 400);
  if (await c.env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first())
    return c.json({ error: '该邮箱已注册，请使用一个未注册的管理员邮箱' }, 409);
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const passwordHash = await hashPassword(b.password);
  // D1 batch is transactional: singleton claim and account commit together.
  try {
    const results = await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO installation(id,admin_id,completed_at)
        SELECT 1,?,? WHERE NOT EXISTS(SELECT 1 FROM installation WHERE id=1)
        AND NOT EXISTS(SELECT 1 FROM users WHERE role='ADMIN') ON CONFLICT(id) DO NOTHING`).bind(id,now),
      c.env.DB.prepare(`INSERT INTO users(id,email,password_hash,name,role,created_at)
        SELECT ?,?,?,'管理员','ADMIN',? FROM installation WHERE id=1 AND admin_id=?`).bind(id,email,passwordHash,now,id)
    ]);
    if (!results[1].meta.changes) return c.json({ error: '本站已完成初始化，入口已关闭' }, 409);
  } catch (e) {
    if ((e as Error).message.includes('UNIQUE constraint')) return c.json({ error: '该邮箱已注册，请使用一个未注册的管理员邮箱' }, 409);
    throw e;
  }
  return c.json({ ok: true }, 201);
}
