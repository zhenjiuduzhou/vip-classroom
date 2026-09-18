import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { canAccess, hashPassword, newToken, normalizeEmail, normalizePhone, parseRange, sha256, validPassword, verifyPassword } from './security';
import { publicUser, type App, type Ctx, type Env, type User } from './types';
import { HTTPException } from 'hono/http-exception';
import catalog, { adminCatalog } from './catalog';
import users from './users';
import uploads from './uploads';
import { runCleanup } from './cleanup';
import settings, { runCachePurge } from './settings';
import { bootstrapStatus, createFirstAdmin } from './bootstrap';
const app = new Hono<App>();

app.onError((error, c) => {
  if(error instanceof HTTPException)return c.json({error:error.message},error.status);
  console.error(JSON.stringify({ event: 'request_failed', name: error.name }));
  return c.json({ error: '服务暂时不可用，请稍后重试' }, 500);
});
app.use('*', async (c, next) => {
  if(c.env.ENVIRONMENT==='local' && !['localhost','127.0.0.1','[::1]'].includes(new URL(c.req.url).hostname))
    return c.json({error:'线上部署必须使用production配置'},503);
  c.header('Cache-Control', 'private, no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin=c.req.header('Origin');let allowed=origin===c.env.APP_ORIGIN;
    if(!allowed && c.env.ENVIRONMENT==='local' && origin){try{const source=new URL(origin),configured=new URL(c.env.APP_ORIGIN);allowed=source.protocol==='http:'&&['localhost','127.0.0.1'].includes(source.hostname)&&source.port===configured.port;}catch{}}
    if (!allowed || c.req.header('X-CSRF-Protection') !== '1')
      return c.json({ error: '请求来源校验失败' }, 403);
    const length = Number(c.req.header('Content-Length') || '0');
    const localPart=c.env.ENVIRONMENT==='local' && /^\/api\/v1\/admin\/uploads\/[^/]+\/local\/\d+$/.test(c.req.path);
    if (length > (localPart?16*1024*1024:32768)) return c.json({ error: '请求过大' }, 413);
    if(!localPart){
      const reader=c.req.raw.clone().body?.getReader();let received=0;
      if(reader)while(true){const chunk=await reader.read();if(chunk.done)break;received+=chunk.value.byteLength;if(received>32768){void reader.cancel();return c.json({error:'请求过大'},413);}}
    }
  }
  await next();
});
app.get('/api/v1/health', c => c.json({ status: 'ok', freeTierVerified: false }));
app.get('/api/v1/auth/bootstrap', c => bootstrapStatus(c));
app.post('/api/v1/auth/bootstrap', async c => {
  if (await limited(c)) return c.json({ error: '操作过于频繁，请15分钟后再试' }, 429);
  return createFirstAdmin(c);
});

async function limited(c: Ctx): Promise<boolean> {
  const now = Date.now();
  const ip = c.req.header('CF-Connecting-IP') || (c.env.ENVIRONMENT === 'local' ? 'local' : 'unknown');
  const key = await sha256(`auth:${ip}`);
  const result = await c.env.DB.prepare(`INSERT INTO auth_limits(key,count,reset_at) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END,
    reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING count`)
    .bind(key, now + 900000, now, now).first<{count:number}>();
  return result!.count > 10;
}
async function session(c: Ctx, userId: string) {
  const token = newToken();
  await c.env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)')
    .bind(await sha256(token), userId, new Date(Date.now() + 7 * 86400000).toISOString()).run();
  setCookie(c, 'classroom_session', token, { httpOnly: true, secure: c.env.ENVIRONMENT !== 'local', sameSite: 'Lax', path: '/', maxAge: 604800 });
}
app.post('/api/v1/auth/register', async c => {
  if (await limited(c)) return c.json({ error: '操作过于频繁，请15分钟后再试' }, 429);
  const b = await c.req.json().catch(() => null);
  if (!b || !validPassword(b.password) || b.password !== b.confirmPassword) return c.json({ error: '密码须为6–128个字符，且两次一致' }, 400);
  let email: string | null, phone: string | null;
  try { email = normalizeEmail(String(b.email || '')); phone = normalizePhone(String(b.phone || '')); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }
  if (!email && !phone) return c.json({ error: '请填写手机号或邮箱' }, 400);
  if (await c.env.DB.prepare('SELECT id FROM users WHERE email=? OR phone=?').bind(email, phone).first())
    return c.json({ error: '该联系方式已注册' }, 409);
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(b.password);
  try {
    await c.env.DB.prepare('INSERT INTO users(id,email,phone,password_hash,created_at) VALUES(?,?,?,?,?)')
      .bind(id, email, phone, passwordHash, new Date().toISOString()).run();
  } catch (e) {
    if ((e as Error).message.includes('UNIQUE constraint')) return c.json({ error: '该联系方式已注册' }, 409);
    throw e;
  }
  await session(c, id);
  return c.json({ user: publicUser((await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first<User>())!) }, 201);
});
app.post('/api/v1/auth/login', async c => {
  if (await limited(c)) return c.json({ error: '操作过于频繁，请15分钟后再试' }, 429);
  const b = await c.req.json().catch(() => null);
  if (!b || !validPassword(b.password)) return c.json({ error: '账号或密码错误' }, 401);
  let account: string | null;
  try { account = String(b.account || '').includes('@') ? normalizeEmail(String(b.account)) : normalizePhone(String(b.account || '')); }
  catch { return c.json({ error: '账号或密码错误' }, 401); }
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email=? OR phone=?').bind(account, account).first<User>();
  // Missing accounts still perform the same expensive KDF to reduce timing disclosure.
  const dummy = 'scrypt$v1$32768$8$3$00000000000000000000000000000000$' + '0'.repeat(64);
  const verified = await verifyPassword(b.password, user?.password_hash || dummy);
  if (!user || !verified) return c.json({ error: '账号或密码错误' }, 401);
  await session(c, user.id);
  return c.json({ user: publicUser(user) });
});
app.post('/api/v1/auth/logout', async c => {
  const token = getCookie(c, 'classroom_session');
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(token)).run();
  deleteCookie(c, 'classroom_session', { path: '/', secure: c.env.ENVIRONMENT !== 'local' });
  return c.json({ ok: true });
});
async function authenticate(c: Ctx, next: () => Promise<void>) {
  const token = getCookie(c, 'classroom_session');
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return c.json({ error: '请先登录' }, 401);
  const user = await c.env.DB.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?')
    .bind(await sha256(token), new Date().toISOString()).first<User>();
  if (!user) return c.json({ error: '登录已失效，请重新登录' }, 401);
  c.set('user', user); await next();
}
app.get('/api/v1/auth/me', authenticate, c => c.json({ user: publicUser(c.get('user')) }));
app.use('/api/v1/courses',authenticate);
app.use('/api/v1/courses/*',authenticate);
app.use('/api/v1/lessons/*',authenticate);
app.route('/api/v1',catalog);
app.use('/api/v1/admin/*',authenticate,async(c,next)=>{
  if(c.get('user').role!=='ADMIN')return c.json({error:'需要管理员权限'},403);await next();
});
app.route('/api/v1/admin/users',users);
app.route('/api/v1/admin/settings',settings);
app.route('/api/v1/admin',adminCatalog);
app.route('/api/v1/admin/uploads',uploads);
app.post('/api/v1/admin/cleanup',async c=>{await runCleanup(c.env);return c.json({ok:true});});
app.get('/api/v1/admin/probe', c => c.get('user').role === 'ADMIN'
  ? c.json({ ok: true }) : c.json({ error: '需要管理员权限' }, 403));
app.on(['GET', 'HEAD'], '/media/lessons/:lessonId', authenticate, async c => {
  const lesson = await c.env.DB.prepare(`SELECT l.video_key,c.required_vip FROM lessons l
    JOIN chapters ch ON ch.id=l.chapter_id JOIN courses c ON c.id=ch.course_id
    WHERE l.id=? AND l.status='READY'`).bind(c.req.param('lessonId')).first<{video_key: string; required_vip: number}>();
  if (!lesson) return c.json({ error: '视频不存在或尚未上传完成' }, 404);
  if (!canAccess(c.get('user'), lesson.required_vip)) return c.json({ error: 'VIP等级不足或已到期' }, 403);
  const meta = await c.env.MEDIA.head(lesson.video_key);
  if (!meta) return c.json({ error: '视频文件不存在' }, 404);
  const headers = new Headers({ 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', ETag: meta.httpEtag });
  // HTTP Range applies only to GET. If-Range mismatch falls back to the whole representation.
  const raw = c.req.method === 'GET' ? c.req.header('Range') : undefined;
  const ifRange = c.req.header('If-Range');
  const rangeRequested = raw && (!ifRange || ifRange === meta.httpEtag);
  const range = rangeRequested ? parseRange(raw!, meta.size) : undefined;
  if (rangeRequested && !range) {
    headers.set('Content-Range', `bytes */${meta.size}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set('Content-Length', String(range ? range.length : meta.size));
  if (range) headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${meta.size}`);
  if (c.req.method === 'HEAD') return new Response(null, { headers });
  const object = await c.env.MEDIA.get(lesson.video_key, { range: range || undefined, onlyIf: { etagMatches: meta.etag } });
  if (!object || !('body' in object)) return c.json({ error: '视频已更新，请重新加载' }, 409);
  return new Response(object.body, { status: range ? 206 : 200, headers });
});
app.on(['GET','HEAD'],'/media/covers/:id',async c=>{
  const course=await c.env.DB.prepare('SELECT cover_key FROM courses WHERE id=?').bind(c.req.param('id')).first<{cover_key:string|null}>();
  if(!course?.cover_key)return c.json({error:'封面不存在'},404);
  const object=await c.env.MEDIA.get(course.cover_key);if(!object)return c.json({error:'封面不存在'},404);
  const headers=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});object.writeHttpMetadata(headers);headers.set('ETag',object.httpEtag);
  return new Response(c.req.method==='HEAD'?null:object.body,{headers});
});
app.notFound(c => c.json({ error: '接口不存在' }, 404));
export { app };
export default {
  fetch: app.fetch,
  async scheduled(_event:ScheduledEvent,env:Env,ctx:ExecutionContext){ctx.waitUntil((async()=>{await runCleanup(env);await runCachePurge(env);})());}
};
