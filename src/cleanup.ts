import type { Env } from './types';
import { fail } from './db';
import { queueCoverPurge } from './settings';
// A completion lease may be reclaimed after 15 minutes, including legacy NULL locks.
export const cancellableUpload = `(state='UPLOADING' OR (state='COMPLETING' AND (locked_at IS NULL OR locked_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-15 minutes'))))`;
export async function enqueueDelete(env:Env,kind:'courses'|'chapters'|'lessons',id:string){
  const where=kind==='courses'?'ch.course_id=?':kind==='chapters'?'l.chapter_id=?':'l.id=?';
  const uploadWhere=kind==='courses'?'u.course_id=? OR u.lesson_id IN (SELECT l.id FROM lessons l JOIN chapters ch ON ch.id=l.chapter_id WHERE ch.course_id=?)':`u.lesson_id IN (SELECT l.id FROM lessons l JOIN chapters ch ON ch.id=l.chapter_id WHERE ${where})`;
  const now=new Date().toISOString();
  const due=new Date(Date.now()+16*60000).toISOString();
  const guard=`NOT EXISTS(SELECT 1 FROM uploads u WHERE (${uploadWhere}) AND u.state='COMPLETING')`;
  const guardArgs=kind==='courses'?[id,id]:[id];
  const results=await env.DB.batch([
    ...(kind==='courses'?[queueCoverPurge(env,id,guard,guardArgs)]:[]),
    env.DB.prepare(`INSERT INTO cleanup_tasks(id,object_key,next_attempt_at,created_at) SELECT lower(hex(randomblob(16))),l.video_key,?,? FROM lessons l JOIN chapters ch ON ch.id=l.chapter_id WHERE ${where} AND l.video_key IS NOT NULL AND ${guard}`).bind(due,now,id,...guardArgs),
    env.DB.prepare(`INSERT INTO cleanup_tasks(id,object_key,multipart_id,next_attempt_at,created_at) SELECT lower(hex(randomblob(16))),u.object_key,CASE WHEN u.state='UPLOADING' THEN u.multipart_id ELSE NULL END,?,? FROM uploads u WHERE (${uploadWhere}) AND ${guard}`).bind(due,now,...guardArgs,...guardArgs),
    ...(kind==='courses'?[env.DB.prepare(`INSERT INTO cleanup_tasks(id,object_key,next_attempt_at,created_at) SELECT lower(hex(randomblob(16))),cover_key,?,? FROM courses WHERE id=? AND cover_key IS NOT NULL AND ${guard}`).bind(due,now,id,...guardArgs)]:[]),
    env.DB.prepare(`DELETE FROM ${kind} WHERE id=? AND ${guard}`).bind(id,...guardArgs)
  ]);
  if(!results.at(-1)!.meta.changes)fail('上传正在完成，请稍后再删除',409);
}
export async function runCleanup(env:Env){
  const now=new Date().toISOString();
  // <= 2 selects + 6*3 expiry statements + 16 task statements + 2 housekeeping
  // = 38 D1 queries; leave room for HTTP authentication under Free's 50-query cap.
  const expired=(await env.DB.prepare(`SELECT id,object_key,multipart_id,lesson_id FROM uploads WHERE ${cancellableUpload} AND expires_at<? LIMIT 6`).bind(now).all<{id:string;object_key:string;multipart_id:string|null;lesson_id:string|null}>()).results;
  for(const u of expired)await env.DB.batch([
    env.DB.prepare(`INSERT INTO cleanup_tasks(id,object_key,multipart_id,next_attempt_at,created_at) SELECT ?,object_key,multipart_id,?,? FROM uploads WHERE id=? AND ${cancellableUpload} AND expires_at<?`).bind(crypto.randomUUID(),new Date(Date.now()+16*60000).toISOString(),now,u.id,now),
    env.DB.prepare(`UPDATE uploads SET state='CANCELLED',locked_at=NULL WHERE id=? AND ${cancellableUpload} AND expires_at<?`).bind(u.id,now),
    ...(u.lesson_id?[env.DB.prepare(`DELETE FROM lessons WHERE id=? AND status='UPLOADING' AND EXISTS(SELECT 1 FROM uploads WHERE id=? AND state='CANCELLED')`).bind(u.lesson_id,u.id)]:[])
  ]);
  const tasks=(await env.DB.prepare('SELECT * FROM cleanup_tasks WHERE next_attempt_at<=? LIMIT 16').bind(now).all<{id:string;object_key:string;multipart_id:string|null;attempts:number}>()).results;
  for(const task of tasks){
    try{
      // R2 multipart abort is idempotent. Deletion remains retryable if abort fails.
      if(task.multipart_id)await env.MEDIA.resumeMultipartUpload(task.object_key,task.multipart_id).abort();
      await env.MEDIA.delete(task.object_key);
      await env.DB.prepare('DELETE FROM cleanup_tasks WHERE id=?').bind(task.id).run();
    }catch{
      await env.DB.prepare('UPDATE cleanup_tasks SET attempts=attempts+1,next_attempt_at=? WHERE id=?').bind(new Date(Date.now()+Math.min(86400000,60000*2**Math.min(task.attempts,10))).toISOString(),task.id).run();
    }
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now),
    env.DB.prepare('DELETE FROM auth_limits WHERE reset_at<=?').bind(Date.now())
  ]);
}
