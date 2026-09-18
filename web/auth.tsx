import { createContext, useContext, useEffect, useState, type ReactNode, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Account } from './api';
import { Modal, ErrorNote } from './ui';
interface Auth {user:Account|null;loading:boolean;setUser:(user:Account|null)=>void;openLogin:()=>void;logout:()=>Promise<void>}
const AuthContext=createContext<Auth>(null!);
export const useAuth=()=>useContext(AuthContext);
export function AuthProvider({children}:{children:ReactNode}){
  const [user,setUser]=useState<Account|null>(null),[loading,setLoading]=useState(true),[modal,setModal]=useState(false);
  const navigate=useNavigate();
  useEffect(()=>{api<{user:Account}>('/auth/me').then(r=>setUser(r.user)).catch(()=>{}).finally(()=>setLoading(false));},[]);
  useEffect(()=>{const expired=()=>{setUser(null);setModal(true);};window.addEventListener('session-expired',expired);return()=>window.removeEventListener('session-expired',expired);},[]);
  async function logout(){await api('/auth/logout','POST');setUser(null);navigate('/');}
  return <AuthContext.Provider value={{user,loading,setUser,openLogin:()=>setModal(true),logout}}>{children}{modal&&<AuthModal onClose={()=>setModal(false)} onSuccess={u=>{setUser(u);setModal(false);navigate('/my-courses');}}/>}</AuthContext.Provider>;
}
function AuthModal({onClose,onSuccess}:{onClose:()=>void;onSuccess:(user:Account)=>void}){
  const [register,setRegister]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError('');const data=Object.fromEntries(new FormData(e.currentTarget));try{onSuccess((await api<{user:Account}>(register?'/auth/register':'/auth/login','POST',data)).user);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <Modal title={register?'创建你的学习账号':'欢迎回来'} onClose={()=>{if(!busy)onClose();}}>
    <p className="muted">{register?'注册后，联系管理员开通对应课程权限。':'登录，继续你的 AI 实践之旅。'}</p>
    <div className="auth-tabs"><button className={!register?'active':''} onClick={()=>{setRegister(false);setError('');}}>登录</button><button className={register?'active':''} onClick={()=>{setRegister(true);setError('');}}>注册</button></div>
    <form onSubmit={submit}>
      {register?<><label>邮箱 <span className="muted">与手机号至少填一项</span><input name="email" type="email" autoComplete="email" placeholder="you@example.com" maxLength={254}/></label><label>手机号<input name="phone" type="tel" autoComplete="tel" placeholder="138xxxxxxxx 或 +国家区号" maxLength={30}/></label></>:<label>手机号 / 邮箱<input name="account" required autoComplete="username" placeholder="输入手机号或邮箱" maxLength={254}/></label>}
      <label>密码<input name="password" type="password" required minLength={6} maxLength={128} autoComplete={register?'new-password':'current-password'} placeholder="6–128 个字符"/></label>
      {register&&<label>确认密码<input name="confirmPassword" type="password" required minLength={6} maxLength={128} autoComplete="new-password" placeholder="再次输入密码"/></label>}
      <ErrorNote message={error}/><button className="button full" disabled={busy}>{busy?'请稍候…':register?'注册并登录':'登录'}</button>
    </form><p className="small muted">忘记密码？请联系管理员重置。本站暂不使用短信或邮箱验证码。</p>
  </Modal>;
}
