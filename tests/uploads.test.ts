import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import settings, { decryptSecret, encryptSecret, queueCoverPurge, runCachePurge } from '../src/settings';
import { app as workerApp } from '../src/worker';
import { sha256 } from '../src/security';
import uploads from '../src/uploads';
import { enqueueDelete, runCleanup } from '../src/cleanup';
import type { App, Env, User } from '../src/types';

function setup() {
  const sql = new DatabaseSync(':memory:');
  for (const file of ['0001_auth_gate.sql','0002_platform.sql','0003_system_settings.sql']) sql.exec(readFileSync(`migrations/${file}`,'utf8'));
  sql.exec(`INSERT INTO users(id,email,password_hash,role,created_at) VALUES('admin','a@example.com','unused','ADMIN','now');
    INSERT INTO courses(id,title,required_vip,created_at,cover_key) VALUES('course','test',1,'now','old');`);
  let queries=0;
  const db={prepare(query:string){let args:any[]=[];return {
    bind(...values:any[]){args=values;return this;},
    async first(){queries++;return sql.prepare(query).get(...args)??null;},
    async all(){queries++;return {results:sql.prepare(query).all(...args)};},
    run(){queries++;return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}};}
  };},async batch(statements:any[]){sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  const data=new Map<string,Uint8Array>();
  const cover=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0]);
  const media={async head(key:string){const bytes=data.get(key);return bytes?{size:bytes.length,etag:'version'}:null;},
    async get(key:string){const bytes=data.get(key);return bytes?{size:bytes.length,body:true,async arrayBuffer(){return bytes.slice().buffer;}}:null;},
    async put(key:string,bytes:Uint8Array){data.set(key,bytes.slice());},async delete(key:string){data.delete(key);},
    resumeMultipartUpload(){return{async abort(){}};}};
  const env={DB:db,MEDIA:media,ENVIRONMENT:'local',APP_ORIGIN:'http://localhost:5173',SETTINGS_ENCRYPTION_KEY:'12'.repeat(32)} as unknown as Env;
  const app=new Hono<App>();app.use('*',async(c,next)=>{c.set('user',{id:'admin'} as User);await next();});app.route('/uploads',uploads);app.route('/settings',settings);
  function add(id:string,state='UPLOADING',expired=false,locked:string|null=null){
    const key=`staging/${id}`;data.set(key,cover.slice());
    sql.prepare(`INSERT INTO uploads(id,owner_id,course_id,kind,object_key,filename,fingerprint,expected_size,content_type,state,created_at,expires_at,locked_at) VALUES(?,'admin','course','COVER',?,'a.png',?,16,'image/png',?,'now',?,?)`)
      .run(id,key,'a'.repeat(64),state,new Date(Date.now()+(expired?-86400000:86400000)).toISOString(),locked);
    return key;
  }
  const post=(id:string,action:string)=>app.request(`/uploads/${id}/${action}`,{method:'POST'},env,{waitUntil(p:Promise<unknown>){void p;},passThroughOnException(){}} as ExecutionContext);
  return {sql,env,media,data,add,post,app,queryCount:()=>queries};
}

describe('上传状态与封面发布',()=>{
  it('失去完成锁的旧请求不能发布或重置新状态，未发布对象仍有清理记录',async()=>{
    const s=setup();s.add('one');const put=s.media.put;
    s.media.put=async(key,bytes)=>{await put(key,bytes);s.sql.prepare("UPDATE uploads SET locked_at='new-lease' WHERE id='one'").run();};
    expect((await s.post('one','complete')).status).toBe(409);
    expect(s.sql.prepare('SELECT cover_key FROM courses').get()!.cover_key).toBe('old');
    expect(s.sql.prepare('SELECT locked_at FROM uploads').get()!.locked_at).toBe('new-lease');
    const unpublished=[...s.data.keys()].find(key=>key.startsWith('covers/'))!;
    expect(s.sql.prepare('SELECT object_key FROM cleanup_tasks WHERE object_key=?').get(unpublished)).toBeTruthy();
  });
  it('发布数据与暂存对象隔离，后续覆盖暂存对象不能改变已发布封面',async()=>{
    const s=setup(),key=s.add('one');expect((await s.post('one','complete')).status).toBe(200);
    const published=s.sql.prepare('SELECT cover_key FROM courses').get()!.cover_key as string;
    expect(published).not.toBe(key);const bytes=s.data.get(published)!.slice();
    s.data.set(key,new Uint8Array([0]));expect(s.data.get(published)).toEqual(bytes);
    expect(s.sql.prepare('SELECT object_key FROM cleanup_tasks WHERE object_key=?').get(key)).toBeTruthy();
    expect(s.sql.prepare('SELECT object_key FROM cleanup_tasks WHERE object_key=?').get(published)).toBeUndefined();
    expect((await s.post('one','complete')).status).toBe(200);
  });
  it('同时完成两个封面时，被替换的发布对象进入清理队列',async()=>{
    const s=setup();s.add('one');s.add('two');
    const responses=await Promise.all([s.post('one','complete'),s.post('two','complete')]);
    expect(responses.map(r=>r.status)).toEqual([200,200]);
    const current=s.sql.prepare('SELECT cover_key FROM courses').get()!.cover_key;
    const queued=s.sql.prepare('SELECT object_key FROM cleanup_tasks').all().map(r=>r.object_key);
    expect(queued).toContain('old');
    for(const key of s.data.keys())if(key.startsWith('covers/')&&key!==current)expect(queued).toContain(key);
    expect(queued).not.toContain(current);
  });
  it('过期且锁已失效的COMPLETING可取消，正在完成的任务仍受保护',async()=>{
    const s=setup();s.add('stale','COMPLETING',true,new Date(Date.now()-16*60000).toISOString());
    s.add('active','COMPLETING',true,new Date().toISOString());
    expect((await s.post('active','cancel')).status).toBe(409);
    expect((await s.post('stale','cancel')).status).toBe(200);
    expect(s.sql.prepare('SELECT state FROM uploads WHERE id=?').get('stale')!.state).toBe('CANCELLED');
  });
  it('定时清理取消过期COMPLETING并释放课程删除锁，兼容NULL锁',async()=>{
    const s=setup();s.add('stale','COMPLETING',true,null);
    await runCleanup(s.env);
    expect(s.sql.prepare('SELECT state FROM uploads').get()!.state).toBe('CANCELLED');
    await enqueueDelete(s.env,'courses','course');
    expect(s.sql.prepare('SELECT id FROM courses').get()).toBeUndefined();
  });
  it('积压清理批次的D1查询数低于免费档50次',async()=>{
    const s=setup();for(let i=0;i<20;i++)s.add(`task${i}`,'COMPLETING',true,null);
    for(let i=0;i<20;i++)s.sql.prepare('INSERT INTO cleanup_tasks(id,object_key,next_attempt_at,created_at) VALUES(?,?,?,?)').run(`delete${i}`,`delete${i}`,'2000','2000');
    await runCleanup(s.env);expect(s.queryCount()).toBeLessThanOrEqual(38);
  });
});

describe('系统设置与Cloudflare缓存清理',()=>{
  const zone='a'.repeat(32),secret='test-cloudflare-secret';
  async function configure(s:ReturnType<typeof setup>,mode='token'){
    return s.app.request('/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({zoneId:zone,email:'owner@example.com',authMode:mode,secret,enabled:true})},s.env);
  }
  it('加密随机化，可解密，篡改及错误密钥不能解密',async()=>{
    const s=setup(),a=await encryptSecret(s.env,secret),b=await encryptSecret(s.env,secret);
    expect(a).not.toBe(b);expect(a).not.toContain(secret);expect(await decryptSecret(s.env,a)).toBe(secret);
    await expect(decryptSecret({...s.env,SETTINGS_ENCRYPTION_KEY:'34'.repeat(32)},a)).rejects.toThrow();
    await expect(decryptSecret(s.env,a.slice(0,-4)+'AAAA')).rejects.toThrow();
  });
  it('保存设置不回传凭据，留空保留，切换认证方式必须提供对应凭据',async()=>{
    const s=setup();expect((await configure(s)).status).toBe(200);
    const stored=s.sql.prepare('SELECT encrypted_secret FROM system_settings').get()!.encrypted_secret;
    expect(stored).not.toContain(secret);
    const read=await s.app.request('/settings',{},s.env);const data=await read.json() as {hasSecret:boolean};
    expect(data.hasSecret).toBe(true);expect(JSON.stringify(data)).not.toContain(secret);expect(JSON.stringify(data)).not.toContain(stored);
    const write=(authMode:string)=>s.app.request('/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({zoneId:zone,email:'owner@example.com',authMode,secret:'',enabled:true})},s.env);
    expect((await write('token')).status).toBe(200);expect((await write('key')).status).toBe(400);
    expect(s.sql.prepare('SELECT encrypted_secret FROM system_settings').get()!.encrypted_secret).toBe(stored);
  });
  it('缺少服务器密钥或无效区域ID时拒绝保存凭据',async()=>{
    const s=setup();s.env.SETTINGS_ENCRYPTION_KEY=undefined;expect((await configure(s)).status).toBe(409);
    s.env.SETTINGS_ENCRYPTION_KEY='12'.repeat(32);
    const r=await s.app.request('/settings',{method:'PUT',body:JSON.stringify({zoneId:'bad',authMode:'token',email:'',secret,enabled:true})},s.env);
    expect(r.status).toBe(400);
  });
  it('未登录用户和普通学员均不能访问或修改系统设置',async()=>{
    const s=setup();expect((await workerApp.request('/api/v1/admin/settings',{},s.env)).status).toBe(401);
    s.sql.exec("INSERT INTO users(id,email,password_hash,created_at) VALUES('student','s@example.com','unused','now')");
    const token='b'.repeat(64);s.sql.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await sha256(token),'student',new Date(Date.now()+86400000).toISOString());
    for(const method of ['GET','PUT']){
      const r=await workerApp.request('/api/v1/admin/settings',{method,headers:{Cookie:`classroom_session=${token}`,Origin:s.env.APP_ORIGIN,'X-CSRF-Protection':'1'},body:method==='PUT'?'{}':undefined},s.env);
      expect(r.status).toBe(403);
    }
  });
  it.each(['token','key'])('%s模式发往固定Cloudflare接口并按前缀清理全部封面版本',async(mode)=>{
    const s=setup();await configure(s,mode);await s.env.DB.batch([queueCoverPurge(s.env,'course')]);
    const fetchMock=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({success:true}),{status:200}));
    try{
      await runCachePurge(s.env);expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url,init]=fetchMock.mock.calls[0];expect(url).toBe(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`);
      expect(JSON.parse(init!.body as string)).toEqual({prefixes:['localhost:5173/media/covers/course']});
      const headers=init!.headers as Record<string,string>;expect(mode==='token'?headers.Authorization:headers['X-Auth-Key']).toBe(mode==='token'?`Bearer ${secret}`:secret);
      expect(s.sql.prepare('SELECT * FROM cache_purge_tasks').all()).toHaveLength(0);
      await s.env.DB.batch([queueCoverPurge(s.env,'course')]);await runCachePurge(s.env);
      expect(fetchMock).toHaveBeenCalledTimes(1);expect(s.sql.prepare('SELECT * FROM cache_purge_tasks').all()).toHaveLength(1);
    }finally{fetchMock.mockRestore();}
  });
  it('限流失败保留任务并退避，错误信息不泄漏Cloudflare响应中的凭据',async()=>{
    const s=setup();await configure(s);await s.env.DB.batch([queueCoverPurge(s.env,'course')]);
    const fetchMock=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({success:false,errors:[{message:secret}]}),{status:429}));
    try{await runCachePurge(s.env);const task=s.sql.prepare('SELECT * FROM cache_purge_tasks').get()!;expect(task.attempts).toBe(1);expect(Date.parse(task.next_attempt_at as string)).toBeGreaterThan(Date.now());
      expect(s.sql.prepare('SELECT last_status FROM system_settings').get()!.last_status).not.toContain(secret);
    }finally{fetchMock.mockRestore();}
  });
  it('清理期间同一封面再次变更时保留新任务',async()=>{
    const s=setup();await configure(s);await s.env.DB.batch([queueCoverPurge(s.env,'course')]);
    const fetchMock=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{await s.env.DB.batch([queueCoverPurge(s.env,'course')]);return new Response(JSON.stringify({success:true}));});
    try{await runCachePurge(s.env);expect(s.sql.prepare('SELECT * FROM cache_purge_tasks').all()).toHaveLength(1);}finally{fetchMock.mockRestore();}
  });
  it('删除课程原子登记缓存清理，COMPLETING阻止删除时不登记',async()=>{
    const s=setup();await configure(s);s.add('active','COMPLETING',false,new Date().toISOString());
    await expect(enqueueDelete(s.env,'courses','course')).rejects.toThrow();expect(s.sql.prepare('SELECT * FROM cache_purge_tasks').all()).toHaveLength(0);
    await s.post('active','cancel');s.sql.exec("UPDATE uploads SET state='CANCELLED'");
    await enqueueDelete(s.env,'courses','course');expect(s.sql.prepare('SELECT * FROM cache_purge_tasks').all()).toHaveLength(1);
  });
  it('对象清理与满批缓存清理总共不超过48条D1查询',async()=>{
    const s=setup();await configure(s);for(let i=0;i<20;i++)s.add(`u${i}`,'COMPLETING',true,null);
    for(let i=0;i<20;i++)s.sql.prepare('INSERT INTO cleanup_tasks(id,object_key,next_attempt_at,created_at) VALUES(?,?,?,?)').run(`d${i}`,`d${i}`,'2000','2000');
    await s.env.DB.batch(Array.from({length:6},(_,i)=>queueCoverPurge(s.env,`course${i}`)));
    const before=s.queryCount(),fetchMock=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({success:true})));
    try{await runCleanup(s.env);await runCachePurge(s.env);expect(s.queryCount()-before).toBeLessThanOrEqual(48);expect(fetchMock).toHaveBeenCalledTimes(1);}finally{fetchMock.mockRestore();}
  });
});
