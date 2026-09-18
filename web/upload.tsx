import { useEffect, useRef, useState } from 'react';
import { UploadCloud, FileVideo, RotateCcw, X, CheckCircle2 } from 'lucide-react';
import { api } from './api';
import { inspectMp4 } from '../src/mp4';
import { ErrorNote } from './ui';
export async function fingerprint(file:File){
  const first=await file.slice(0,1024*1024).arrayBuffer(),last=await file.slice(Math.max(0,file.size-1024*1024)).arrayBuffer();
  const meta=new TextEncoder().encode(`${file.name}:${file.size}:${file.lastModified}`);
  const bytes=new Uint8Array(first.byteLength+last.byteLength+meta.byteLength);bytes.set(new Uint8Array(first));bytes.set(new Uint8Array(last),first.byteLength);bytes.set(meta,first.byteLength+last.byteLength);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function put(url:string,blob:Blob,headers:Record<string,string>,signal:AbortSignal,progress:(loaded:number)=>void):Promise<string>{
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();const abort=()=>xhr.abort();if(signal.aborted){reject(new Error('已取消'));return;}
    signal.addEventListener('abort',abort,{once:true});xhr.open('PUT',url);xhr.timeout=5*60000;
    Object.entries(headers).forEach(([key,value])=>xhr.setRequestHeader(key,value));
    if(url.startsWith('/'))xhr.setRequestHeader('X-CSRF-Protection','1');
    xhr.upload.onprogress=e=>progress(e.loaded);
    const finish=()=>signal.removeEventListener('abort',abort);
    xhr.onload=()=>{finish();if(xhr.status>=200&&xhr.status<300){const etag=xhr.getResponseHeader('ETag');if(!etag)reject(new Error('缺少ETag，请检查R2 CORS配置'));else resolve(etag.replace(/^"|"$/g,''));}else reject(new Error(`分片上传失败（${xhr.status}），可重试`));};
    xhr.onerror=()=>{finish();reject(new Error('上传网络中断，可重试'));};xhr.ontimeout=()=>{finish();reject(new Error('上传超时，可重试'));};xhr.onabort=()=>{finish();reject(new Error('已取消'));};xhr.send(blob);
  });
}
export async function uploadCover(file:File,courseId:string){
  const types:Record<string,string>={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'};
  const type=types[file.name.split('.').pop()!.toLowerCase()];if(!type||file.size>5*1024*1024)throw new Error('请选择5MiB以内的JPEG、PNG或WebP封面');
  const task=await api<{id:string}>('/admin/uploads','POST',{kind:'COVER',filename:file.name,size:file.size,fingerprint:await fingerprint(file),contentType:type,courseId});
  try{const sign=await api<{url:string;headers:Record<string,string>}>(`/admin/uploads/${task.id}/sign`,'POST',{});await put(sign.url,file,sign.headers,new AbortController().signal,()=>{});await api(`/admin/uploads/${task.id}/complete`,'POST',{});}
  catch(e){await api(`/admin/uploads/${task.id}/cancel`,'POST',{}).catch(()=>{});throw e;}
}
interface Item {key:string;file:File;chapterId:string;taskId?:string;state:'waiting'|'uploading'|'done'|'error'|'cancelled';percent:number;error:string;title:string}
interface Pending {id:string;filename:string;fingerprint:string;expected_size:number;kind:string;state:string;lesson_id:string|null}
export default function UploadPanel({chapterId,onComplete,droppedFiles}:{chapterId:string|null;onComplete:()=>void;droppedFiles:File[]|null}){
  const [items,setItems]=useState<Item[]>([]),[pending,setPending]=useState<Pending[]>([]),[error,setError]=useState('');
  const itemsRef=useRef(items);itemsRef.current=items;const running=useRef(false);const controllers=useRef(new Map<string,AbortController>());
  const input=useRef<HTMLInputElement>(null),resume=useRef<HTMLInputElement>(null),resumeTask=useRef<Pending|null>(null);
  function refresh(){api<{uploads:Pending[]}>('/admin/uploads').then(r=>setPending(r.uploads.filter(u=>u.kind==='VIDEO'))).catch(e=>setError(e.message));}
  useEffect(refresh,[]);
  function add(files:File[]){if(!chapterId){setError('先进入一个章节，再上传视频。');return;}setError('');setItems(list=>[...list,...files.map(file=>({key:crypto.randomUUID(),file,chapterId,state:'waiting' as const,percent:0,error:'',title:file.name.replace(/\.mp4$/i,'')}))]);}
  useEffect(()=>{if(droppedFiles?.length)add(droppedFiles);},[droppedFiles]);
  function update(key:string,patch:Partial<Item>){setItems(list=>list.map(item=>item.key===key?{...item,...patch}:item));}
  useEffect(()=>{
    if(running.current)return;const next=items.find(item=>item.state==='waiting');if(!next)return;
    running.current=true;run(next).finally(()=>{running.current=false;setItems(list=>[...list]);});
  },[items]);
  async function run(item:Item){
    const controller=new AbortController();controllers.current.set(item.key,controller);update(item.key,{state:'uploading',error:''});let taskId=item.taskId;
    try{
      if(!/\.mp4$/i.test(item.file.name))throw new Error('仅支持MP4视频');
      await inspectMp4(async(offset,length)=>new Uint8Array(await item.file.slice(offset,offset+length).arrayBuffer()),item.file.size);
      const mark=await fingerprint(item.file);
      if(!taskId){
        const task=await api<{id:string}>('/admin/uploads','POST',{kind:'VIDEO',chapterId:item.chapterId,title:item.title,filename:item.file.name,size:item.file.size,fingerprint:mark});taskId=task.id;update(item.key,{taskId});
      }
      if(controller.signal.aborted)throw new Error('已取消');
      const info=await api<{size:number;fingerprint:string;partSize:number;state:string;parts:{partNumber:number;etag:string}[]}>(`/admin/uploads/${taskId}`);
      if(info.size!==item.file.size||info.fingerprint!==mark)throw new Error('文件与原任务不一致，请重新选择原文件');
      if(info.state==='COMPLETE'){update(item.key,{state:'done',percent:100});onComplete();return;}
      if(info.state==='COMPLETING'){await api(`/admin/uploads/${taskId}/complete`,'POST',{});update(item.key,{state:'done',percent:100});onComplete();refresh();return;}
      const count=Math.ceil(item.file.size/info.partSize);const completed=new Set(info.parts.map(p=>p.partNumber));
      const loaded=new Map<number,number>();completed.forEach(p=>loaded.set(p,Math.min(info.partSize,item.file.size-(p-1)*info.partSize)));
      const report=()=>update(item.key,{percent:Math.min(99,Math.floor([...loaded.values()].reduce((n,l)=>n+l,0)/item.file.size*100))});report();
      let cursor=1;
      async function worker(){
        while(cursor<=count){const part=cursor++;if(completed.has(part))continue;const chunk=item.file.slice((part-1)*info.partSize,Math.min(part*info.partSize,item.file.size));let success=false;
          for(let attempt=0;attempt<3;attempt++){
            if(controller.signal.aborted)throw new Error('已取消');
            try{const sign=await api<{url:string;headers:Record<string,string>}>(`/admin/uploads/${taskId}/sign`,'POST',{partNumber:part});const etag=await put(sign.url,chunk,sign.headers,controller.signal,n=>{loaded.set(part,n);report();});await api(`/admin/uploads/${taskId}/parts`,'POST',{partNumber:part,etag});success=true;break;}
            catch(e){loaded.set(part,0);report();if(controller.signal.aborted||attempt===2)throw e;}
          }
          if(!success)throw new Error('分片上传失败');
        }
      }
      // Wait for all in-flight parts before leaving a failed task; no background PUT remains.
      const results=await Promise.allSettled([worker(),worker(),worker()]);const rejected=results.find(r=>r.status==='rejected');if(rejected?.status==='rejected')throw rejected.reason;
      if(controller.signal.aborted)throw new Error('已取消');
      await api(`/admin/uploads/${taskId}/complete`,'POST',{});update(item.key,{state:'done',percent:100});onComplete();refresh();
    }catch(e){
      if(controller.signal.aborted){if(taskId)await api(`/admin/uploads/${taskId}/cancel`,'POST',{}).catch(err=>setError(err.message));update(item.key,{state:'cancelled',error:'已取消'});onComplete();refresh();}
      else{update(item.key,{state:'error',error:(e as Error).message});refresh();}
    }finally{controllers.current.delete(item.key);}
  }
  async function cancel(item:Item){const ctrl=controllers.current.get(item.key);if(ctrl){ctrl.abort();return;}try{if(item.taskId)await api(`/admin/uploads/${item.taskId}/cancel`,'POST',{});update(item.key,{state:'cancelled',error:'已取消'});onComplete();refresh();}catch(e){setError((e as Error).message);}}
  const visiblePending=pending.filter(task=>!items.some(item=>item.taskId===task.id));
  return <section className="upload-panel"><input ref={input} hidden type="file" accept=".mp4" multiple onChange={e=>{add(Array.from(e.target.files||[]));e.target.value='';}}/><input ref={resume} hidden type="file" accept=".mp4" onChange={async e=>{const file=e.target.files?.[0],task=resumeTask.current;e.target.value='';if(!file||!task)return;if(await fingerprint(file)!==task.fingerprint){setError('请选择原任务对应的文件，名称、大小和修改时间须一致。');return;}setItems(list=>[...list,{key:crypto.randomUUID(),file,chapterId:'',taskId:task.id,state:'waiting',percent:0,error:'',title:file.name}]);}}/>
    <button className="upload-drop" disabled={!chapterId} onClick={()=>input.current?.click()}><UploadCloud size={27}/><strong>{chapterId?'拖入 MP4，或点击上传视频':'进入章节后上传视频'}</strong><span>H.264 / AAC · 单个 ≤ 2GB · 多文件队列</span></button><ErrorNote message={error}/>
    {!!items.length&&<div className="upload-queue"><div className="queue-heading"><strong>上传队列</strong><button onClick={()=>setItems(list=>list.filter(i=>!['done','cancelled'].includes(i.state)))}>清除已结束</button></div>{items.map(item=><div key={item.key} className="upload-item"><FileVideo size={20}/><div className="upload-item-body"><strong>{item.file.name}</strong><div className="progress"><i style={{width:`${item.percent}%`}}/></div><small>{item.state==='done'?'上传完成':item.state==='waiting'?'等待上传':item.state==='uploading'?`${item.percent}% · 上传中`:item.error||'已取消'}</small></div>{item.state==='done'?<CheckCircle2 size={19} className="green"/>:<>{item.state==='error'&&<button aria-label="重试上传" className="icon-button" onClick={()=>update(item.key,{state:'waiting'})}><RotateCcw size={17}/></button>}{item.state!=='cancelled'&&<button aria-label="取消上传" className="icon-button" onClick={()=>cancel(item)}><X size={17}/></button>}</>}</div>)}</div>}
    {!!visiblePending.length&&<div className="resume-list"><strong>可恢复的上传任务</strong>{visiblePending.map(task=><div key={task.id}><span>{task.filename}<small>{task.state==='COMPLETING'?'正在完成，15分钟后可恢复中断任务':'重新选择原文件继续'}</small></span><button className="text-button" onClick={()=>{resumeTask.current=task;resume.current?.click();}}>恢复</button><button className="icon-button" aria-label={`取消任务 ${task.filename}`} onClick={()=>api(`/admin/uploads/${task.id}/cancel`,'POST',{}).then(()=>{refresh();onComplete();}).catch(e=>setError(e.message))}><X size={16}/></button></div>)}</div>}
  </section>;
}
