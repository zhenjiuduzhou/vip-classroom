import { Hono } from 'hono';
import { body, exists, fail, level, text } from './db';
import { expiryForBeijingDate, hashPassword, normalizeEmail, normalizePhone, validPassword } from './security';
import { publicUser, type App, type User } from './types';
const users=new Hono<App>();
users.get('/',async c=>{
  const search=(c.req.query('search')||'').slice(0,200); const page=Math.max(1,Math.min(100000,Number(c.req.query('page'))||1));
  const escaped=search.replace(/[\\%_]/g,'\\$&');const pattern=`%${escaped}%`;
  const where=`WHERE email LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\'`;
  const [list,count]=await Promise.all([
    c.env.DB.prepare(`SELECT * FROM users ${where} ORDER BY created_at DESC,id LIMIT 20 OFFSET ?`).bind(pattern,pattern,pattern,(page-1)*20).all<User>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS total FROM users ${where}`).bind(pattern,pattern,pattern).first<{total:number}>()
  ]);return c.json({users:list.results.map(publicUser),total:count!.total,page,pageSize:20});
});
users.patch('/:id',async c=>{
  const id=c.req.param('id');await exists(c.env.DB,'users',id);const b=await body(c);
  let email:string|null,phone:string|null,expires:string|null=null;
  try {email=normalizeEmail(String(b.email||''));phone=normalizePhone(String(b.phone||''));if(b.expiresDate)expires=expiryForBeijingDate(String(b.expiresDate));}
  catch(e){fail((e as Error).message);}
  if(!email&&!phone)fail('至少保留一种联系方式');
  const vip=level(b.vipLevel,true);if(vip===null)expires=null;
  if(await c.env.DB.prepare('SELECT id FROM users WHERE id<>? AND (email=? OR phone=?)').bind(id,email,phone).first())fail('联系方式已被其他账号使用',409);
  try{await c.env.DB.prepare('UPDATE users SET email=?,phone=?,name=?,vip_level=?,vip_expires_at=? WHERE id=?').bind(email,phone,text(b.name||'','姓名',100,true),vip,expires,id).run();}
  catch(e){if((e as Error).message.includes('UNIQUE'))fail('联系方式已被使用',409);throw e;}
  return c.json({ok:true});
});
users.post('/:id/password',async c=>{
  const id=c.req.param('id');await exists(c.env.DB,'users',id);const b=await body(c);if(!validPassword(b.password))fail('密码须为6–128个字符');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(await hashPassword(b.password),id),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id)
  ]);return c.json({ok:true});
});
users.delete('/:id',async c=>{
  const id=c.req.param('id');await exists(c.env.DB,'users',id);
  if(id===c.get('user').id)fail('不能删除当前登录的管理员');
  const target=await c.env.DB.prepare('SELECT role FROM users WHERE id=?').bind(id).first<{role:string}>();
  if(target?.role==='ADMIN')fail('管理员账号请通过部署命令管理，后台仅删除学员');
  const active=(await c.env.DB.prepare(`SELECT object_key,multipart_id,state FROM uploads WHERE owner_id=? AND state IN ('UPLOADING','COMPLETING')`).bind(id).all<{object_key:string;multipart_id:string|null;state:string}>()).results;
  if(active.some(u=>u.state==='COMPLETING'))fail('上传正在完成，请稍后重试',409);
  const now=new Date().toISOString();await c.env.DB.batch([
    ...active.map(u=>c.env.DB.prepare('INSERT INTO cleanup_tasks(id,object_key,multipart_id,next_attempt_at,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),u.object_key,u.multipart_id,now,now)),
    c.env.DB.prepare('DELETE FROM users WHERE id=?').bind(id)
  ]);return c.json({ok:true});
});
export default users;
