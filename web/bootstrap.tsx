import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api';
import { useAuth } from './auth';
import { ErrorNote, Loading } from './ui';

export default function Bootstrap() {
  const [state,setState] = useState<'loading'|'ready'|'disabled'|'completed'|'error'>('loading');
  const [error,setError] = useState(''),[busy,setBusy] = useState(false),[created,setCreated] = useState(false);
  const { openLogin } = useAuth();
  async function load() {
    setError('');setState('loading');
    try { setState((await api<{state:'ready'|'disabled'|'completed'}>('/auth/bootstrap')).state); }
    catch(e) {setState('error');setError((e as Error).message);}
  }
  useEffect(()=>{void load();},[]);
  async function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();const form=e.currentTarget;setBusy(true);setError('');
    try {await api('/auth/bootstrap','POST',Object.fromEntries(new FormData(form)));form.reset();setCreated(true);setState('completed');}
    catch(e) {setError((e as Error).message);}
    finally {setBusy(false);}
  }
  return <main className="page bootstrap-page"><section className="settings-card bootstrap-card">
    <span className="eyebrow">首次安装</span><h1>创建首任管理员</h1>
    {state==='loading'?<Loading/>:state==='completed'?<><p>{created?'管理员已创建，请使用刚设置的邮箱和密码登录。':'本站已完成初始化，创建入口已关闭。'}</p><button className="button" onClick={openLogin}>登录</button><Link className="button secondary" to="/">返回首页</Link></>:state==='ready'?<>
      <p className="muted">输入部署时设置的初始化密钥，创建本站的第一个管理员账号。此操作只能完成一次。</p>
      <form onSubmit={submit}><fieldset className="settings-fields" disabled={busy}>
        <label>初始化密钥<input name="token" type="password" required minLength={32} maxLength={256} autoComplete="off"/></label>
        <label>管理员邮箱<input name="email" type="email" required maxLength={254} autoComplete="username"/></label>
        <label>管理员密码<input name="password" type="password" required minLength={6} maxLength={128} autoComplete="new-password"/></label>
        <label>确认密码<input name="confirmPassword" type="password" required minLength={6} maxLength={128} autoComplete="new-password"/></label>
        <ErrorNote message={error}/><button className="button full" disabled={busy}>{busy?'正在创建…':'创建管理员'}</button>
      </fieldset></form></>:<><p>{state==='disabled'?'初始化尚未启用，请由部署者在 Cloudflare 设置初始化密钥后重试。':'暂时无法读取初始化状态，请稍后重试。'}</p><ErrorNote message={error}/><button className="button secondary" onClick={()=>void load()}>重新检查</button></>}
  </section></main>;
}
