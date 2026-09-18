import { HTTPException } from 'hono/http-exception';
export function fail(message: string, status: 400 | 403 | 404 | 409 = 400): never {
  throw new HTTPException(status, { message });
}
export function text(value: unknown, label: string, max = 200, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) fail(`${label}格式不正确`);
  return value.trim();
}
export function level(value: unknown, nullable = false): number | null {
  if (nullable && value === null) return null;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 5) fail('VIP等级必须为1–5');
  return value as number;
}
export async function body(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  const value = await c.req.json().catch(() => null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('请提交有效JSON');
  return value as Record<string, unknown>;
}
export async function exists(db: D1Database, table: 'courses'|'chapters'|'lessons'|'users', id: string) {
  if (!await db.prepare(`SELECT id FROM ${table} WHERE id=?`).bind(id).first()) fail('记录不存在', 404);
}
