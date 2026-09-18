import { Hono } from 'hono';
import type { App, Env } from './types';
import { body, fail } from './db';

interface Config {zone_id:string;email:string;auth_mode:'token'|'key';encrypted_secret:string;enabled:number;last_status:string;updated_at:string}
const settings=new Hono<App>();
const encoder=new TextEncoder();
export function encryptionReady(env:Env){return /^[a-f0-9]{64}$/i.test(env.SETTINGS_ENCRYPTION_KEY||'');}
async function key(env:Env){
  if(!encryptionReady(env))fail('请先为服务器配置 SETTINGS_ENCRYPTION_KEY（32字节随机密钥的64位十六进制文本）',409);
  return crypto.subtle.importKey('raw',new Uint8Array(env.SETTINGS_ENCRYPTION_KEY!.match(/../g)!.map(x=>parseInt(x,16))), 'AES-GCM',false,['encrypt','decrypt']);
}
export async function encryptSecret(env:Env,value:string){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const bytes=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('cloudflare-settings-v1')},await key(env),encoder.encode(value)));
  return `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...bytes))}`;
}
export async function decryptSecret(env:Env,value:string){
  const [iv,data]=value.split('.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:Uint8Array.from(atob(iv),c=>c.charCodeAt(0)),additionalData:encoder.encode('cloudflare-settings-v1')},await key(env),Uint8Array.from(atob(data),c=>c.charCodeAt(0))));
}
async function config(env:Env){return env.DB.prepare('SELECT * FROM system_settings WHERE id=1').first<Config>();}
settings.get('/',async c=>{
  const row=await config(c.env);
  const pending=await c.env.DB.prepare('SELECT COUNT(*) AS n FROM cache_purge_tasks').first<{n:number}>();
  return c.json({zoneId:row?.zone_id||'',email:row?.email||'',authMode:row?.auth_mode||'token',enabled:!!row?.enabled,hasSecret:!!row?.encrypted_secret,encryptionReady:encryptionReady(c.env),lastStatus:row?.last_status||'',pending:pending?.n||0,updatedAt:row?.updated_at||null});
});
settings.put('/',async c=>{
  const b=await body(c),old=await config(c.env);
  if(typeof b.zoneId!=='string'||(b.zoneId!==''&&!/^[a-f0-9]{32}$/i.test(b.zoneId)))fail('区域ID须为32位十六进制文本');
  if(b.authMode!=='token'&&b.authMode!=='key')fail('认证方式无效');
  if(typeof b.email!=='string'||b.email.length>254||(b.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)))fail('账户邮箱格式不正确');
  if(typeof b.enabled!=='boolean'||typeof b.secret!=='string'||b.secret.length>512||/[\r\n\x00]/.test(b.secret))fail('设置格式不正确');
  if(b.clearSecret!==undefined&&typeof b.clearSecret!=='boolean')fail('清除凭据选项无效');
  let encrypted=b.clearSecret?'':old?.encrypted_secret||'';
  if(old&&old.auth_mode!==b.authMode)encrypted='';
  if(b.secret)encrypted=await encryptSecret(c.env,b.secret);
  if(b.enabled&&(!b.zoneId||!encrypted||(b.authMode==='key'&&!b.email)))fail('启用前请填写区域ID及相应凭据');
  if(b.enabled&&!encryptionReady(c.env))fail('服务器尚未配置凭据加密密钥',409);
  await c.env.DB.prepare(`INSERT INTO system_settings(id,zone_id,email,auth_mode,encrypted_secret,enabled,updated_at) VALUES(1,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET zone_id=excluded.zone_id,email=excluded.email,auth_mode=excluded.auth_mode,encrypted_secret=excluded.encrypted_secret,enabled=excluded.enabled,last_status='',updated_at=excluded.updated_at`)
    .bind(b.zoneId,b.email,b.authMode,encrypted,b.enabled?1:0,new Date().toISOString()).run();
  return c.json({ok:true});
});

// Transactional outbox: called inside the same batch that changes/deletes the course.
export function queueCoverPurge(env:Env,id:string,guard='1',args:unknown[]=[]){
  const prefix=`${new URL(env.APP_ORIGIN).origin}/media/covers/${encodeURIComponent(id)}`;
  const now=new Date().toISOString();
  return env.DB.prepare(`INSERT INTO cache_purge_tasks(prefix,revision,next_attempt_at,created_at)
    SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM system_settings WHERE id=1 AND enabled=1) AND ${guard}
    ON CONFLICT(prefix) DO UPDATE SET revision=excluded.revision,next_attempt_at=excluded.next_attempt_at,attempts=0`).bind(prefix,crypto.randomUUID(),now,now,...args);
}
async function purge(env:Env,row:Config,prefixes:string[]){
  const secret=await decryptSecret(env,row.encrypted_secret);
  const headers:Record<string,string>={'Content-Type':'application/json'};
  if(row.auth_mode==='token')headers.Authorization=`Bearer ${secret}`;
  else {headers['X-Auth-Email']=row.email;headers['X-Auth-Key']=secret;}
  const response=await fetch(`https://api.cloudflare.com/client/v4/zones/${row.zone_id}/purge_cache`,{method:'POST',headers,body:JSON.stringify({prefixes:prefixes.map(p=>p.replace(/^https?:\/\//,''))}),signal:AbortSignal.timeout(10000)});
  const result=await response.json().catch(()=>null) as {success?:boolean}|null;
  if(!response.ok||result?.success!==true)throw new Error(response.status===429?'Cloudflare 请求限流，稍后自动重试':`Cloudflare 未接受清理请求（HTTP ${response.status}），请检查区域ID、凭据及 Cache Purge 权限`);
}
async function claim(env:Env){
  const now=new Date().toISOString();
  const result=await env.DB.prepare('UPDATE system_settings SET next_purge_at=? WHERE id=1 AND enabled=1 AND next_purge_at<=?')
    .bind(new Date(Date.now()+60000).toISOString(),now).run();return !!result.meta.changes;
}
export async function runCachePurge(env:Env){
  const row=await config(env);if(!row?.enabled)return;
  const tasks=(await env.DB.prepare('SELECT prefix,revision,attempts FROM cache_purge_tasks WHERE next_attempt_at<=? LIMIT 6').bind(new Date().toISOString()).all<{prefix:string;revision:string;attempts:number}>()).results;
  if(!tasks.length||!await claim(env))return;
  try{
    await purge(env,row,tasks.map(t=>t.prefix));
    await env.DB.batch(tasks.map(t=>env.DB.prepare('DELETE FROM cache_purge_tasks WHERE prefix=? AND revision=?').bind(t.prefix,t.revision)));
    await env.DB.prepare("UPDATE system_settings SET last_status=? WHERE id=1").bind('Cloudflare 已接受清理请求；实际缓存状态需以访问结果确认').run();
  }catch(e){
    await env.DB.batch(tasks.map(t=>env.DB.prepare('UPDATE cache_purge_tasks SET attempts=attempts+1,next_attempt_at=? WHERE prefix=? AND revision=?').bind(new Date(Date.now()+Math.min(86400000,60000*2**Math.min(t.attempts,10))).toISOString(),t.prefix,t.revision)));
    // Never log or expose Cloudflare response bodies or credentials.
    await env.DB.prepare('UPDATE system_settings SET last_status=? WHERE id=1').bind(e instanceof Error&&e.message.startsWith('Cloudflare ')?e.message:'清理连接失败或凭据无法解密，稍后自动重试').run();
  }
}
settings.post('/test',async c=>{
  const row=await config(c.env);if(!row?.enabled)fail('请先保存并启用配置',409);
  if(!await claim(c.env))fail('请间隔至少60秒再提交清理请求',409);
  try{await purge(c.env,row,[`${new URL(c.env.APP_ORIGIN).origin}/media/covers/__settings_probe__`]);}
  catch(e){fail(e instanceof Error&&e.message.startsWith('Cloudflare ')?e.message:'连接失败或凭据无法解密，请检查服务器配置',409);}
  return c.json({ok:true,message:'Cloudflare 已接受测试清理请求；请确认区域ID对应本站域名'});
});
settings.post('/retry',async c=>{await runCachePurge(c.env);return c.json({ok:true});});
export default settings;
