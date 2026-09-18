import { execFileSync } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { hashPassword } from '../src/security';
const quote=(s:string)=>"'"+s.replaceAll("'","''")+"'";
const password='Demo-Classroom-2026';
const accounts=[['demo-admin','admin@example.com','管理员','ADMIN',null,null],['demo-student','student@example.com','演示学员','USER',3,null],['demo-pending','pending@example.com','待开通学员','USER',null,null],['demo-expired','expired@example.com','到期学员','USER',5,'2020-01-01T00:00:00.000Z']] as const;
const sql:string[]=['DELETE FROM auth_limits;'];
for(const [id,email,name,role,vip,expiry] of accounts){
  const hash=await hashPassword(password);
  sql.push(`INSERT INTO users(id,email,password_hash,name,role,vip_level,vip_expires_at,created_at) VALUES(${quote(id)},${quote(email)},${quote(hash)},${quote(name)},${quote(role)},${vip??'NULL'},${expiry?quote(expiry):'NULL'},${quote(new Date().toISOString())}) ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash,vip_level=excluded.vip_level,vip_expires_at=excluded.vip_expires_at;`);
  sql.push(`DELETE FROM sessions WHERE user_id=${quote(id)};`);
}
const courses=[['demo-course-1','AI Agent 从零到实战','从基础认知、工作流到第一个可演示的 Agent，建立清晰的项目实践路径。',1],['demo-course-2','Claude Code 与 Vibe Coding','把想法做成应用，练习开发、调试与部署。',2],['demo-course-3','n8n 自动化系统','连接工具与业务流程，构建可交付的自动化方案。',3],['demo-course-4','RAG 企业知识库','将企业资料转化为有用的问答助手。',4],['demo-course-5','AI Voice Agent 应用','探索语音 Agent 的场景与客户服务方案。',5]] as const;
for(const [id,title,description,vip] of courses){sql.push(`INSERT OR IGNORE INTO courses(id,title,description,required_vip,sort_order,created_at) VALUES(${quote(id)},${quote(title)},${quote(description)},${vip},${vip},${quote(new Date().toISOString())});`);}
sql.push("INSERT OR IGNORE INTO chapters(id,course_id,title,sort_order) VALUES('demo-chapter-1','demo-course-1','第一章 · AI Agent 基础',0),('demo-chapter-2','demo-course-1','第二章 · 项目实践',1);");
sql.push("INSERT OR IGNORE INTO lessons(id,chapter_id,title,video_key,status,sort_order) VALUES('demo-lesson-1','demo-chapter-1','1.1 演示视频：播放与权限测试','fixtures/sample.mp4','READY',0),('demo-lesson-2','demo-chapter-1','1.2 演示视频：下一节','fixtures/sample.mp4','READY',1);");
const path='.local-seed.sql';await writeFile(path,sql.join('\n'));
const wrangler=(args:string[])=>execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
try{
  wrangler(['d1','execute','classroom','--local','--file',path]);
  wrangler(['r2','object','put','classroom-private/fixtures/sample.mp4','--local','--file','tests/fixtures/sample.mp4','--content-type','video/mp4']);
}finally{await unlink(path);}
console.log('\n仅本地演示数据已就绪。账号：admin / student / pending / expired @example.com；密码：'+password+'。不要将演示数据导入生产。');
