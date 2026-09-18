import { Hono } from 'hono';
import type { App } from './types';
import { body, exists, fail, level, text } from './db';
import { canAccess } from './security';
import { enqueueDelete } from './cleanup';
import { runCachePurge } from './settings';
const catalog = new Hono<App>();
type Course = { id:string; title:string; description:string; required_vip:number; cover_key:string|null; sort_order:number; revision:number };
const display = (course: Course, accessible: boolean) => ({ id:course.id, title:course.title, description:course.description,
  requiredVip:course.required_vip, coverUrl:course.cover_key ? `/media/covers/${course.id}?v=${encodeURIComponent(course.cover_key)}`:null, accessible, sortOrder:course.sort_order });
catalog.get('/courses', async c => {
  const user=c.get('user');
  const courses=(await c.env.DB.prepare(`SELECT * FROM courses ORDER BY sort_order,id`).all<Course>()).results;
  return c.json({ courses:courses.map(course=>display(course,canAccess(user,course.required_vip))).filter(course=>c.req.query('mine')!=='1'||course.accessible) });
});
catalog.get('/courses/:id', async c => {
  const course=await c.env.DB.prepare('SELECT * FROM courses WHERE id=?').bind(c.req.param('id')).first<Course>();
  if(!course)fail('课程不存在',404);
  if(!canAccess(c.get('user'),course.required_vip))fail('VIP等级不足或已到期',403);
  const chapters=(await c.env.DB.prepare('SELECT id,title FROM chapters WHERE course_id=? ORDER BY sort_order,id').bind(course.id).all<{id:string;title:string}>()).results;
  const lessons=(await c.env.DB.prepare(`SELECT l.id,l.chapter_id,l.title FROM lessons l JOIN chapters ch ON ch.id=l.chapter_id WHERE ch.course_id=? AND l.status='READY' ORDER BY l.sort_order,l.id`).bind(course.id).all<{id:string;chapter_id:string;title:string}>()).results;
  return c.json({course:{...display(course,true),chapters:chapters.map(ch=>({...ch,lessons:lessons.filter(l=>l.chapter_id===ch.id).map(l=>({id:l.id,title:l.title}))}))}});
});
catalog.get('/lessons/:id', async c => {
  const lesson=await c.env.DB.prepare(`SELECT l.id,l.title,ch.course_id,c.title AS course_title,c.required_vip FROM lessons l JOIN chapters ch ON ch.id=l.chapter_id JOIN courses c ON c.id=ch.course_id WHERE l.id=? AND l.status='READY'`).bind(c.req.param('id')).first<{id:string;title:string;course_id:string;course_title:string;required_vip:number}>();
  if(!lesson)fail('小节不存在',404);
  if(!canAccess(c.get('user'),lesson.required_vip))fail('VIP等级不足或已到期',403);
  const ordered=(await c.env.DB.prepare(`SELECT l.id FROM lessons l JOIN chapters ch ON ch.id=l.chapter_id WHERE ch.course_id=? AND l.status='READY' ORDER BY ch.sort_order,ch.id,l.sort_order,l.id`).bind(lesson.course_id).all<{id:string}>()).results;
  const index=ordered.findIndex(l=>l.id===lesson.id);
  return c.json({lesson:{id:lesson.id,title:lesson.title,courseId:lesson.course_id,courseTitle:lesson.course_title,videoUrl:`/media/lessons/${lesson.id}`,nextId:ordered[index+1]?.id||null}});
});
export const adminCatalog=new Hono<App>();
adminCatalog.get('/tree',async c=>{
  const [courses,chapters,lessons]=await Promise.all([
    c.env.DB.prepare('SELECT * FROM courses ORDER BY sort_order,id').all<Course>(),
    c.env.DB.prepare('SELECT * FROM chapters ORDER BY sort_order,id').all<{id:string;course_id:string;title:string;revision:number}>(),
    c.env.DB.prepare('SELECT id,chapter_id,title,status,sort_order FROM lessons ORDER BY sort_order,id').all<{id:string;chapter_id:string;title:string;status:string}>()
  ]);
  return c.json({courses:courses.results.map(course=>({...display(course,true),revision:course.revision,chapters:chapters.results.filter(ch=>ch.course_id===course.id).map(ch=>({id:ch.id,title:ch.title,revision:ch.revision,lessons:lessons.results.filter(l=>l.chapter_id===ch.id)}))}))});
});
adminCatalog.post('/courses',async c=>{
  const b=await body(c), id=crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO courses(id,title,description,required_vip,sort_order,created_at) VALUES(?,?,?,?,(SELECT COALESCE(MAX(sort_order),-1)+1 FROM courses),?)`)
    .bind(id,text(b.title,'课程名称'),text(b.description||'','课程简介',5000,true),level(b.requiredVip),new Date().toISOString()).run();
  return c.json({id},201);
});
adminCatalog.patch('/courses/:id',async c=>{
  await exists(c.env.DB,'courses',c.req.param('id')); const b=await body(c);
  await c.env.DB.prepare('UPDATE courses SET title=?,description=?,required_vip=?,revision=revision+1 WHERE id=?').bind(text(b.title,'课程名称'),text(b.description||'','简介',5000,true),level(b.requiredVip),c.req.param('id')).run();
  return c.json({ok:true});
});
adminCatalog.post('/chapters',async c=>{
  const b=await body(c), courseId=text(b.courseId,'课程ID'), id=crypto.randomUUID(); await exists(c.env.DB,'courses',courseId);
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO chapters(id,course_id,title,sort_order) VALUES(?,?,?,(SELECT COALESCE(MAX(sort_order),-1)+1 FROM chapters WHERE course_id=?))`).bind(id,courseId,text(b.title,'章节名称'),courseId),
    c.env.DB.prepare('UPDATE courses SET revision=revision+1 WHERE id=?').bind(courseId)
  ]);return c.json({id},201);
});
adminCatalog.patch('/chapters/:id',async c=>{
  await exists(c.env.DB,'chapters',c.req.param('id')); const b=await body(c);
  await c.env.DB.prepare('UPDATE chapters SET title=? WHERE id=?').bind(text(b.title,'章节名称'),c.req.param('id')).run();return c.json({ok:true});
});
adminCatalog.patch('/lessons/:id',async c=>{
  await exists(c.env.DB,'lessons',c.req.param('id'));const b=await body(c);
  await c.env.DB.prepare('UPDATE lessons SET title=? WHERE id=?').bind(text(b.title,'小节名称'),c.req.param('id')).run();return c.json({ok:true});
});
for(const kind of ['courses','chapters','lessons'] as const){
  adminCatalog.delete(`/${kind}/:id`,async c=>{
    const id=c.req.param('id'); await exists(c.env.DB,kind,id);
    await enqueueDelete(c.env,kind,id);
    if(kind==='courses')c.executionCtx.waitUntil(runCachePurge(c.env));
    return c.json({ok:true});
  });
}
adminCatalog.post('/move',async c=>{
  const b=await body(c); if(b.kind!=='chapters'&&b.kind!=='lessons')fail('仅章节或小节可以移动');
  const kind=b.kind, id=text(b.id,'ID'), target=text(b.targetId,'目标ID');
  const parent=kind==='chapters'?'courses':'chapters', column=kind==='chapters'?'course_id':'chapter_id';
  await exists(c.env.DB,parent,target);
  const row=await c.env.DB.prepare(`SELECT ${column} AS parent FROM ${kind} WHERE id=?`).bind(id).first<{parent:string}>();if(!row)fail('记录不存在',404);
  if(row.parent===target)return c.json({ok:true});
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE ${kind} SET ${column}=?,sort_order=(SELECT COALESCE(MAX(sort_order),-1)+1 FROM ${kind} WHERE ${column}=?) WHERE id=?`).bind(target,target,id),
    c.env.DB.prepare(`UPDATE ${parent} SET revision=revision+1 WHERE id IN (?,?)`).bind(row.parent,target)
  ]);return c.json({ok:true});
});
adminCatalog.post('/sort',async c=>{
  const b=await body(c); const kind=b.kind;
  if(!['courses','chapters','lessons'].includes(String(kind)))fail('排序类型无效');
  if(!Array.isArray(b.ids)||b.ids.length>1000||b.ids.some(id=>typeof id!=='string')||new Set(b.ids).size!==b.ids.length)fail('排序列表无效');
  const ids=b.ids as string[], table=kind as 'courses'|'chapters'|'lessons';
  const column=table==='chapters'?'course_id':'chapter_id';
  const parentId=table==='courses'?null:text(b.parentId,'父级ID');
  const current=(await c.env.DB.prepare(`SELECT id FROM ${table}${parentId?' WHERE '+column+'=?':''}`).bind(...(parentId?[parentId]:[])).all<{id:string}>()).results;
  if(current.length!==ids.length||current.some(row=>!ids.includes(row.id)))fail('内容已变化，请刷新后重试',409);
  if(ids.length)await c.env.DB.batch(ids.map((id,i)=>c.env.DB.prepare(`UPDATE ${table} SET sort_order=? WHERE id=?`).bind(i,id)));
  return c.json({ok:true});
});
export default catalog;
