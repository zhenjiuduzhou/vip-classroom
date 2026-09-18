// Uses the Miniflare runtime bundled with Wrangler; never contacts remote D1.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { app } from '../src/worker';
import type { Env } from '../src/types';

const mf = new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default { fetch() { return new Response("test"); } };',compatibilityDate:'2026-09-17',d1Databases:{DB:'bootstrap-integration'},d1Persist:false}));
try {
  const db=await mf.getD1Database('DB');
  for(const name of ['0001_auth_gate.sql','0002_platform.sql','0003_system_settings.sql','0004_bootstrap.sql']) {
    const source=await readFile(`migrations/${name}`,'utf8');
    await db.batch(source.split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
  }
  const env={DB:db,APP_ORIGIN:'http://localhost:5173',ENVIRONMENT:'local',BOOTSTRAP_TOKEN:'isolated-d1-test-token-'.repeat(3)} as unknown as Env;
  const body={token:env.BOOTSTRAP_TOKEN,email:'first@example.com',password:'isolated-test-password',confirmPassword:'isolated-test-password'};
  const post=(email:string)=>app.request('/api/v1/auth/bootstrap',{method:'POST',headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json','X-CSRF-Protection':'1'},body:JSON.stringify({...body,email})},env);
  const responses=await Promise.all([post('first@example.com'),post('second@example.com')]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM users').first<{n:number}>())!.n,1);
  const login=await app.request('/api/v1/auth/login',{method:'POST',headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json','X-CSRF-Protection':'1'},body:JSON.stringify({account:(await db.prepare('SELECT email FROM users').first<{email:string}>())!.email,password:body.password})},env);
  assert.equal(login.status,200);assert.match(login.headers.get('set-cookie')||'',/HttpOnly/i);
  await db.prepare('DELETE FROM users').run();
  assert.equal((await post('third@example.com')).status,409);
  assert.deepEqual(await (await app.request('/api/v1/auth/bootstrap',{},env)).json(),{state:'completed'});
  console.log('独立本地 D1/workerd 验证通过：全部迁移、并发只建一个管理员、正常登录、删除后永久关闭。');
} finally {await mf.dispose();}
