import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { app } from '../src/worker';
import { verifyPassword } from '../src/security';
import type { Env } from '../src/types';

const token = 'test-installation-token-'.repeat(3);
function setup(existingAdmin=false) {
  const sql = new DatabaseSync(':memory:');
  for (const name of ['0001_auth_gate.sql','0002_platform.sql','0003_system_settings.sql']) sql.exec(readFileSync(`migrations/${name}`,'utf8'));
  if(existingAdmin) sql.exec("INSERT INTO users(id,email,password_hash,role,created_at) VALUES('old','old@example.com','unused','ADMIN','now')");
  sql.exec(readFileSync('migrations/0004_bootstrap.sql','utf8'));
  let beforeBatch: (()=>void)|undefined;
  const db = {
    prepare(query:string) {let args:any[]=[];return {
      bind(...values:any[]) {args=values;return this;},
      async first() {return sql.prepare(query).get(...args)??null;},
      run() {return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}};}
    };},
    async batch(statements:any[]) {
      beforeBatch?.();beforeBatch=undefined;sql.exec('BEGIN');
      try {const results=statements.map(s=>s.run());sql.exec('COMMIT');return results;}
      catch(e) {sql.exec('ROLLBACK');throw e;}
    }
  };
  const env={DB:db,ENVIRONMENT:'local',APP_ORIGIN:'http://localhost:5173',BOOTSTRAP_TOKEN:token} as unknown as Env;
  const body={token,email:'owner@example.com',password:'Owner-password-2026',confirmPassword:'Owner-password-2026'};
  const request=(data:unknown=body,headers:Record<string,string>={Origin:env.APP_ORIGIN,'X-CSRF-Protection':'1'})=>app.request('/api/v1/auth/bootstrap',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)},env);
  return {sql,env,body,request,status:()=>app.request('/api/v1/auth/bootstrap',{},env),raceEmail(){beforeBatch=()=>sql.prepare("INSERT INTO users(id,email,password_hash,created_at) VALUES('racer',?,'unused','now')").run(body.email);}};
}
describe('首任管理员初始化',()=>{
  it('未配置密钥时关闭，不返回密钥',async()=>{
    const s=setup();delete s.env.BOOTSTRAP_TOKEN;
    expect(await (await s.status()).json()).toEqual({state:'disabled'});
    expect((await s.request()).status).toBe(503);
    s.env.BOOTSTRAP_TOKEN='short';expect((await s.request()).status).toBe(503);
  });
  it('错误密钥、来源和密码不创建账号',async()=>{
    const s=setup();expect((await s.request({...s.body,token:'wrong'})).status).toBe(403);
    expect((await s.request(s.body,{Origin:'https://evil.example','X-CSRF-Protection':'1'})).status).toBe(403);
    expect((await s.request(s.body,{Origin:s.env.APP_ORIGIN})).status).toBe(403);
    expect((await s.request({...s.body,confirmPassword:'different'})).status).toBe(400);
    expect((await s.request({...s.body,email:'invalid'})).status).toBe(400);
    expect(s.sql.prepare('SELECT COUNT(*) AS n FROM users').get()!.n).toBe(0);
  });
  it('错误尝试触发限流',async()=>{
    const s=setup();for(let i=0;i<10;i++)expect((await s.request({token:'wrong'})).status).toBe(403);
    expect((await s.request()).status).toBe(429);
  });
  it('创建真实密码哈希，删除管理员和更换密钥后仍然关闭',async()=>{
    const s=setup();expect((await s.request()).status).toBe(201);
    const user=s.sql.prepare('SELECT * FROM users').get()!;
    expect(user.role).toBe('ADMIN');expect(user.password_hash).not.toBe(s.body.password);
    expect(await verifyPassword(s.body.password,user.password_hash as string)).toBe(true);
    s.sql.exec('DELETE FROM users');s.env.BOOTSTRAP_TOKEN='new-token-'.repeat(6);
    expect(await (await s.status()).json()).toEqual({state:'completed'});
    expect((await s.request({...s.body,token:s.env.BOOTSTRAP_TOKEN})).status).toBe(409);
  },30000);
  it('并发请求只允许一个首任管理员',async()=>{
    const s=setup();const responses=await Promise.all([s.request(),s.request({...s.body,email:'second@example.com'})]);
    expect(responses.map(r=>r.status).sort()).toEqual([201,409]);
    expect(s.sql.prepare('SELECT COUNT(*) AS n FROM users').get()!.n).toBe(1);
    expect(s.sql.prepare('SELECT COUNT(*) AS n FROM installation').get()!.n).toBe(1);
  },30000);
  it('账号插入失败回滚初始化标记，允许改邮箱重试',async()=>{
    const s=setup();s.raceEmail();expect((await s.request()).status).toBe(409);
    expect(s.sql.prepare('SELECT * FROM installation').get()).toBeUndefined();
    expect((await s.request({...s.body,email:'another@example.com'})).status).toBe(201);
  },30000);
  it('不会提升已注册的普通用户',async()=>{
    const s=setup();s.sql.prepare("INSERT INTO users(id,email,password_hash,created_at) VALUES('student',?,'unused','now')").run(s.body.email);
    expect((await s.request()).status).toBe(409);
    expect(s.sql.prepare('SELECT role FROM users').get()!.role).toBe('USER');
    expect(s.sql.prepare('SELECT * FROM installation').get()).toBeUndefined();
  });
  it('升级已有管理员的数据库永久关闭入口',async()=>{
    const s=setup(true);s.sql.exec('DELETE FROM users');
    expect(await (await s.status()).json()).toEqual({state:'completed'});
    expect((await s.request()).status).toBe(409);
  });
});
