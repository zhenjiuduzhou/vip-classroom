import { describe, expect, it } from 'vitest';
import { enqueueDelete, runCleanup } from '../src/cleanup';
import type { Env } from '../src/types';
describe('清理任务容错',()=>{
  it('R2删除失败保留任务并退避，不能恢复课程记录',async()=>{
    const executed:{sql:string;args:unknown[]}[]=[];
    const db={prepare(sql:string){let args:unknown[]=[];return{bind(...values:unknown[]){args=values;return this;},async all(){return{results:sql.includes('FROM cleanup_tasks')?[{id:'task',object_key:'videos/one.mp4',multipart_id:null,attempts:2}]:[]};},async run(){executed.push({sql,args});return{meta:{changes:1}};}};},async batch(){return[];}};
    const media={async delete(){throw new Error('network');}};
    await runCleanup({DB:db,MEDIA:media} as unknown as Env);
    expect(executed.some(x=>x.sql.startsWith('DELETE FROM cleanup_tasks'))).toBe(false);
    const retry=executed.find(x=>x.sql.startsWith('UPDATE cleanup_tasks'))!;
    expect(retry.args[1]).toBe('task');expect(Date.parse(retry.args[0] as string)-Date.now()).toBeGreaterThan(230000);
    expect(executed.some(x=>x.sql.includes('INSERT INTO courses'))).toBe(false);
  });
  it('清理成功才删除任务，先abort再delete',async()=>{
    const calls:string[]=[];
    const db={prepare(sql:string){return{bind(){return this;},async all(){return{results:sql.includes('FROM cleanup_tasks')?[{id:'task',object_key:'videos/one.mp4',multipart_id:'mp',attempts:0}]:[]};},async run(){calls.push(sql);return{meta:{changes:1}};}};},async batch(){return[];}};
    const media={resumeMultipartUpload(){return{async abort(){calls.push('abort');}};},async delete(){calls.push('r2delete');}};
    await runCleanup({DB:db,MEDIA:media} as unknown as Env);
    expect(calls).toEqual(['abort','r2delete','DELETE FROM cleanup_tasks WHERE id=?']);
  });
  it('删除批次原子保护正在完成的上传',async()=>{
    let sql:string[]=[];
    const db={prepare(value:string){return{sql:value,bind(){return this;}};},async batch(statements:{sql:string}[]){sql=statements.map(x=>x.sql);return statements.map(()=>({meta:{changes:0}}));}};
    await expect(enqueueDelete({DB:db,APP_ORIGIN:'http://localhost:5173'} as unknown as Env,'courses','course')).rejects.toThrow('上传正在完成');
    expect(sql.every(value=>value.includes("u.state='COMPLETING'"))).toBe(true);
    expect(sql.at(-1)).toContain('DELETE FROM courses');
  });
});
