import { Hono } from 'hono';
import { AwsClient } from 'aws4fetch';
import type { App, Ctx, Env } from './types';
import { body, exists, fail, text } from './db';
import { inspectMp4 } from './mp4';
import { cancellableUpload } from './cleanup';
import { queueCoverPurge, runCachePurge } from './settings';
export const PART_SIZE=16*1024*1024;
interface Upload {id:string;owner_id:string;lesson_id:string|null;course_id:string|null;kind:'VIDEO'|'COVER';object_key:string;multipart_id:string|null;filename:string;fingerprint:string;expected_size:number;content_type:string;state:string;expires_at:string;locked_at:string|null}
const uploads=new Hono<App>();
async function task(c:Ctx,id:string):Promise<Upload>{
  const u=await c.env.DB.prepare('SELECT * FROM uploads WHERE id=? AND owner_id=?').bind(id,c.get('user').id).first<Upload>();
  if(!u)fail('上传任务不存在',404);return u;
}
async function signed(env:Env,u:Upload,part?:number){
  if(!env.R2_ACCOUNT_ID||!env.R2_BUCKET_NAME||!env.R2_ACCESS_KEY_ID||!env.R2_SECRET_ACCESS_KEY)fail('请配置R2上传密钥',409);
  const url=new URL(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${u.object_key}`);
  if(part){url.searchParams.set('partNumber',String(part));url.searchParams.set('uploadId',u.multipart_id!);}
  url.searchParams.set('X-Amz-Expires','900');
  const client=new AwsClient({accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY,service:'s3',region:'auto'});
  return (await client.sign(url.toString(),{method:'PUT',aws:{signQuery:true}})).url;
}
uploads.get('/',async c=>{
  const list=(await c.env.DB.prepare(`SELECT id,lesson_id,course_id,kind,filename,fingerprint,expected_size,state,expires_at FROM uploads WHERE owner_id=? AND state IN ('UPLOADING','COMPLETING') ORDER BY created_at DESC`).bind(c.get('user').id).all()).results;
  return c.json({uploads:list});
});
uploads.post('/',async c=>{
  const b=await body(c); const kind=b.kind==='COVER'?'COVER':b.kind==='VIDEO'?'VIDEO':fail('上传类型无效');
  const filename=text(b.filename,'文件名',255),fingerprint=text(b.fingerprint,'文件指纹',100);
  if(!/^[a-f0-9]{64}$/.test(fingerprint))fail('文件指纹无效');
  const size=Number(b.size);if(!Number.isSafeInteger(size)||size<=0||size>(kind==='VIDEO'?2_000_000_000:5*1024*1024))fail(kind==='VIDEO'?'视频不能超过2GB':'封面不能超过5MiB');
  const active=await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM uploads WHERE owner_id=? AND state IN ('UPLOADING','COMPLETING')`).bind(c.get('user').id).first<{n:number}>();
  if(active!.n>=20)fail('最多同时保留20个上传任务，请取消或完成旧任务');
  let lessonId:string|null=null,courseId:string|null=null,chapterId:string|null=null;
  let contentType='video/mp4';
  if(kind==='VIDEO'){
    if(!/\.mp4$/i.test(filename))fail('请上传MP4视频');
    chapterId=text(b.chapterId,'章节ID');await exists(c.env.DB,'chapters',chapterId);
    lessonId=crypto.randomUUID();text(b.title||filename.replace(/\.mp4$/i,''),'小节名称');
  }else{
    courseId=text(b.courseId,'课程ID');await exists(c.env.DB,'courses',courseId);
    if(!['image/jpeg','image/png','image/webp'].includes(String(b.contentType)))fail('封面仅支持JPEG、PNG和WebP');
    contentType=String(b.contentType);
  }
  const id=crypto.randomUUID(),key=`${kind==='VIDEO'?'videos':'covers'}/${lessonId||courseId}/${id}.${kind==='VIDEO'?'mp4':contentType.split('/')[1]}`;
  const multipart=kind==='VIDEO'?await c.env.MEDIA.createMultipartUpload(key,{httpMetadata:{contentType}}):null;
  const now=new Date().toISOString(),expires=new Date(Date.now()+6*86400000).toISOString();
  const statements=[];
  if(lessonId)statements.push(c.env.DB.prepare(`INSERT INTO lessons(id,chapter_id,title,sort_order) VALUES(?,?,?,(SELECT COALESCE(MAX(sort_order),-1)+1 FROM lessons WHERE chapter_id=?))`).bind(lessonId,chapterId,text(b.title||filename.replace(/\.mp4$/i,''),'小节名称'),chapterId));
  statements.push(c.env.DB.prepare(`INSERT INTO uploads(id,owner_id,lesson_id,course_id,kind,object_key,multipart_id,filename,fingerprint,expected_size,content_type,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,c.get('user').id,lessonId,courseId,kind,key,multipart?.uploadId||null,filename,fingerprint,size,contentType,now,expires));
  try{await c.env.DB.batch(statements);}catch(e){if(multipart)await multipart.abort();throw e;}
  return c.json({id,lessonId,partSize:PART_SIZE,expiresAt:expires},201);
});
uploads.get('/:id',async c=>{
  const u=await task(c,c.req.param('id'));
  const parts=(await c.env.DB.prepare('SELECT part_number AS partNumber,etag FROM upload_parts WHERE upload_id=? ORDER BY part_number').bind(u.id).all()).results;
  return c.json({id:u.id,kind:u.kind,state:u.state,filename:u.filename,fingerprint:u.fingerprint,size:u.expected_size,partSize:PART_SIZE,parts});
});
uploads.post('/:id/sign',async c=>{
  const u=await task(c,c.req.param('id'));if(u.state!=='UPLOADING'||u.expires_at<=new Date().toISOString())fail('上传任务已过期或不可上传',409);
  const b=await body(c);let part:number|undefined;
  if(u.kind==='VIDEO'){
    part=Number(b.partNumber);if(!Number.isInteger(part)||part<1||part>Math.ceil(u.expected_size/PART_SIZE))fail('分片序号无效');
  }
  const url=c.env.ENVIRONMENT==='local'?`/api/v1/admin/uploads/${u.id}/local/${part||0}`:await signed(c.env,u,part);
  return c.json({url,expiresIn:900,headers:{'Content-Type':u.content_type}});
});
// Local R2 has no S3 HTTP endpoint. Only this explicitly local adapter proxies bytes.
uploads.put('/:id/local/:part',async c=>{
  if(c.env.ENVIRONMENT!=='local')fail('接口不存在',404);
  const u=await task(c,c.req.param('id'));if(u.state!=='UPLOADING')fail('任务不可上传',409);
  const p=Number(c.req.param('part'));const length=Number(c.req.header('Content-Length'));
  const expected=u.kind==='COVER'?u.expected_size:Math.min(PART_SIZE,u.expected_size-(p-1)*PART_SIZE);
  if(!Number.isSafeInteger(length)||length!==expected||!c.req.raw.body)fail('分片大小不符');
  if(u.kind==='VIDEO'){
    if(!Number.isInteger(p)||p<1||p>Math.ceil(u.expected_size/PART_SIZE))fail('分片序号无效');
    const result=await c.env.MEDIA.resumeMultipartUpload(u.object_key,u.multipart_id!).uploadPart(p,c.req.raw.body);
    return new Response(null,{headers:{ETag:result.etag}});
  }
  if(p!==0)fail('分片序号无效');
  const result=await c.env.MEDIA.put(u.object_key,c.req.raw.body,{httpMetadata:{contentType:u.content_type}});
  return new Response(null,{headers:{ETag:result!.httpEtag}});
});
uploads.post('/:id/parts',async c=>{
  const u=await task(c,c.req.param('id'));if(u.state!=='UPLOADING'||u.kind!=='VIDEO')fail('任务不可修改',409);
  const b=await body(c),p=Number(b.partNumber),etag=text(b.etag,'ETag',200);
  if(!Number.isInteger(p)||p<1||p>Math.ceil(u.expected_size/PART_SIZE))fail('分片序号无效');
  await c.env.DB.prepare('INSERT INTO upload_parts(upload_id,part_number,etag) VALUES(?,?,?) ON CONFLICT(upload_id,part_number) DO UPDATE SET etag=excluded.etag').bind(u.id,p,etag.replace(/^"|"$/g,'')).run();
  return c.json({ok:true});
});
uploads.post('/:id/complete',async c=>{
  const u=await task(c,c.req.param('id'));if(u.state==='COMPLETE')return c.json({ok:true,lessonId:u.lesson_id});
  if(u.state==='CANCELLED'||u.expires_at<=new Date().toISOString())fail('任务已取消或过期',409);
  const now=new Date().toISOString();
  const claimed=await c.env.DB.prepare(`UPDATE uploads SET state='COMPLETING',locked_at=? WHERE id=? AND (state='UPLOADING' OR (state='COMPLETING' AND (locked_at IS NULL OR locked_at<?)))`)
    .bind(now,u.id,new Date(Date.now()-15*60000).toISOString()).run();
  if(!claimed.meta.changes)fail('上传正在完成，请稍后重试；中断任务15分钟后可恢复',409);
  try{
    let publishedKey=u.object_key;
    let meta=await c.env.MEDIA.head(u.object_key);
    if(!meta&&u.kind==='VIDEO'){
      const parts=(await c.env.DB.prepare('SELECT part_number AS partNumber,etag FROM upload_parts WHERE upload_id=? ORDER BY part_number').bind(u.id).all<R2UploadedPart>()).results;
      if(parts.length!==Math.ceil(u.expected_size/PART_SIZE))fail('仍有分片未上传，请重试');
      await c.env.MEDIA.resumeMultipartUpload(u.object_key,u.multipart_id!).complete(parts);
      meta=await c.env.MEDIA.head(u.object_key);
    }
    if(!meta||meta.size!==u.expected_size)fail('文件大小校验失败，请取消后重新上传');
    if(u.kind==='VIDEO'){
      await inspectMp4(async(offset,length)=>{
        const object=await c.env.MEDIA.get(u.object_key,{range:{offset,length}});if(!object)fail('文件读取失败');
        return new Uint8Array(await object.arrayBuffer());
      },meta.size).catch(e=>fail((e as Error).message));
    }else{
      const object=await c.env.MEDIA.get(u.object_key,{onlyIf:{etagMatches:meta.etag}});
      if(!object || !('body' in object) || object.size!==u.expected_size)fail('封面已变化，请重新完成上传',409);
      const bytes=new Uint8Array(await object.arrayBuffer());
      if(bytes.length!==u.expected_size)fail('文件大小校验失败');
      const signature=u.content_type==='image/png'?bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71:
        u.content_type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:
        String.fromCharCode(...bytes.subarray(0,4))==='RIFF'&&String.fromCharCode(...bytes.subarray(8,12))==='WEBP';
      if(!signature)fail('封面格式校验失败');
      publishedKey=`covers/${u.course_id}/${crypto.randomUUID()}.${u.content_type.split('/')[1]}`;
      // Register before writing: interrupted publication leaves a retryable cleanup task.
      await c.env.DB.prepare('INSERT INTO cleanup_tasks(id,object_key,next_attempt_at,created_at) VALUES(?,?,?,?)')
        .bind(crypto.randomUUID(),publishedKey,new Date(Date.now()+16*60000).toISOString(),now).run();
      await c.env.MEDIA.put(publishedKey,bytes,{httpMetadata:{contentType:u.content_type}});
    }
    const lease=`EXISTS(SELECT 1 FROM uploads WHERE id=? AND state='COMPLETING' AND locked_at=?)`;
    const statements=[];
    if(u.kind==='VIDEO')statements.push(c.env.DB.prepare(`UPDATE lessons SET video_key=?,status='READY' WHERE id=? AND ${lease}`).bind(u.object_key,u.lesson_id,u.id,now));
    else{
      statements.push(queueCoverPurge(c.env,u.course_id!,lease,[u.id,now]));
      statements.push(c.env.DB.prepare(`INSERT INTO cleanup_tasks(id,object_key,next_attempt_at,created_at) SELECT ?,cover_key,?,? FROM courses WHERE id=? AND cover_key IS NOT NULL AND ${lease}`).bind(crypto.randomUUID(),now,now,u.course_id,u.id,now));
      statements.push(c.env.DB.prepare(`UPDATE courses SET cover_key=? WHERE id=? AND ${lease}`).bind(publishedKey,u.course_id,u.id,now));
      statements.push(c.env.DB.prepare(`DELETE FROM cleanup_tasks WHERE object_key=? AND ${lease}`).bind(publishedKey,u.id,now));
      statements.push(c.env.DB.prepare(`INSERT INTO cleanup_tasks(id,object_key,next_attempt_at,created_at) SELECT ?,object_key,?,? FROM uploads WHERE id=? AND ${lease}`).bind(crypto.randomUUID(),new Date(Date.now()+16*60000).toISOString(),now,u.id,u.id,now));
    }
    statements.push(c.env.DB.prepare(`UPDATE uploads SET state='COMPLETE',locked_at=NULL WHERE id=? AND state='COMPLETING' AND locked_at=?`).bind(u.id,now));
    const results=await c.env.DB.batch(statements);
    if(!results.at(-1)!.meta.changes)fail('任务状态已变化，请刷新后重试',409);
    if(u.kind==='COVER')c.executionCtx.waitUntil(runCachePurge(c.env));
    return c.json({ok:true,lessonId:u.lesson_id});
  }catch(e){
    await c.env.DB.prepare(`UPDATE uploads SET state='UPLOADING',locked_at=NULL WHERE id=? AND state='COMPLETING' AND locked_at=?`).bind(u.id,now).run();throw e;
  }
});
uploads.post('/:id/cancel',async c=>{
  const u=await task(c,c.req.param('id'));if(u.state==='CANCELLED')return c.json({ok:true});
  if(u.state==='COMPLETE')fail('已完成的任务不能取消',409);
  const now=new Date().toISOString();
  const due=new Date(Date.now()+16*60000).toISOString();
  const results=await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO cleanup_tasks(id,object_key,multipart_id,next_attempt_at,created_at) SELECT ?,object_key,multipart_id,?,? FROM uploads WHERE id=? AND ${cancellableUpload}`).bind(crypto.randomUUID(),due,now,u.id),
    c.env.DB.prepare(`UPDATE uploads SET state='CANCELLED',locked_at=NULL WHERE id=? AND ${cancellableUpload}`).bind(u.id),
    ...(u.lesson_id?[c.env.DB.prepare(`DELETE FROM lessons WHERE id=? AND status='UPLOADING' AND EXISTS(SELECT 1 FROM uploads WHERE id=? AND state='CANCELLED')`).bind(u.lesson_id,u.id)]:[])
  ]);if(!results[1].meta.changes)fail('任务状态已变化，请刷新后重试',409);return c.json({ok:true});
});
export default uploads;
