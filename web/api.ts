export class ApiError extends Error { constructor(message:string, public status:number){super(message);} }
export async function api<T=Record<string,unknown>>(path:string,method='GET',data?:unknown):Promise<T>{
  const response=await fetch(`/api/v1${path}`,{method,credentials:'same-origin',headers:method==='GET'?{}:{'Content-Type':'application/json','X-CSRF-Protection':'1'},body:data===undefined?undefined:JSON.stringify(data)});
  const result=await response.json().catch(()=>({error:'服务返回了异常响应'})) as {error?:string};
  if(!response.ok){if(response.status===401&&!path.startsWith('/auth/'))window.dispatchEvent(new Event('session-expired'));throw new ApiError(result.error||'请求失败',response.status);}
  return result as T;
}
export interface Account {id:string;email:string|null;phone:string|null;name:string;role:'USER'|'ADMIN';vipLevel:number|null;vipExpiresAt:string|null;createdAt:string}
export interface Lesson {id:string;title:string;status?:string;chapter_id?:string}
export interface Chapter {id:string;title:string;revision?:number;lessons:Lesson[]}
export interface Course {id:string;title:string;description:string;requiredVip:number;coverUrl:string|null;accessible:boolean;chapters?:Chapter[]}
export interface TreeCourse extends Course {chapters:Chapter[]}
export function vipLabel(user:Account){return user.vipLevel?`VIP${user.vipLevel}`:'未开通';}
export function isExpired(user:Account){return !!user.vipExpiresAt&&Date.parse(user.vipExpiresAt)<=Date.now();}
export function dateLabel(value:string|null){return value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'永久有效';}
export function expiryInput(value:string|null){return value?new Date(Date.parse(value)-1+8*3600000).toISOString().slice(0,10):'';}
