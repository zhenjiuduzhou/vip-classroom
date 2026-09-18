import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { api } from './api';
import { ErrorNote, ErrorState, Loading } from './ui';
interface Config {zoneId:string;email:string;authMode:'token'|'key';enabled:boolean;hasSecret:boolean;encryptionReady:boolean;lastStatus:string;pending:number}
export default function SystemSettings(){
  const [config,setConfig]=useState<Config|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[secret,setSecret]=useState(''),[visible,setVisible]=useState(false),[clear,setClear]=useState(false),[message,setMessage]=useState(''),[actionError,setActionError]=useState('');
  const load=useCallback(()=>api<Config>('/admin/settings').then(r=>{setConfig(r);setError('');}).catch(e=>setError(e.message)),[]);
  useEffect(()=>{void load();},[load]);
  async function save(e:FormEvent){e.preventDefault();if(!config)return;setBusy(true);setMessage('');setActionError('');try{await api('/admin/settings','PUT',{...config,secret,clearSecret:clear});setSecret('');setVisible(false);setClear(false);await load();setMessage('系统设置已保存');}catch(e){setActionError((e as Error).message);}finally{setBusy(false);}}
  async function action(path:string){setBusy(true);setMessage('');setActionError('');try{const r=await api<{message?:string}>(`/admin/settings/${path}`,'POST',{});await load();setMessage(r.message||'已尝试处理待清理任务，请查看状态；请求间隔至少60秒');}catch(e){setActionError((e as Error).message);}finally{setBusy(false);}}
  return <><div className="admin-page-heading"><div><span className="eyebrow">SYSTEM SETTINGS</span><h1>系统设置</h1><p>配置 Cloudflare 缓存清理，让课程封面更新及时生效。</p></div></div>
    {error?<ErrorState message={error} retry={()=>{void load();}}/>:!config?<Loading/>:<section className="settings-card"><div className="settings-title"><ShieldCheck size={22}/><h2>Cloudflare API 配置</h2></div>
      <p className="muted small">视频与用户权限逐次校验。此配置用于替换封面或删除课程后的 CDN 缓存清理，无法撤回已经下载的内容。</p>
      {!config.encryptionReady&&<p className="error-note">服务器尚未配置凭据加密密钥，暂时无法保存 API 凭据。请按部署说明配置 SETTINGS_ENCRYPTION_KEY。</p>}
      <form onSubmit={save}><fieldset disabled={busy} className="settings-fields">
        <label>认证方式<select aria-label="认证方式" value={config.authMode} onChange={e=>{setConfig({...config,authMode:e.target.value as Config['authMode'],hasSecret:false});setSecret('');setClear(false);}}><option value="token">API Token（推荐）</option><option value="key">账户邮箱 + Global API Key</option></select></label>
        <label>区域 ID（Zone ID）<input value={config.zoneId} onChange={e=>setConfig({...config,zoneId:e.target.value.trim()})} maxLength={32} pattern="[a-fA-F0-9]{32}" required={config.enabled} placeholder="本站域名对应的32位区域ID" autoComplete="off"/></label>
        <label>账户邮箱{config.authMode==='token'?'（可选）':''}<input type="email" value={config.email} onChange={e=>setConfig({...config,email:e.target.value})} maxLength={254} required={config.enabled&&config.authMode==='key'} placeholder="Cloudflare 账户邮箱"/></label>
        <label>{config.authMode==='token'?'API Token':'API Key'}<span className="settings-secret"><input aria-label={config.authMode==='token'?'API Token':'API Key'} type={visible?'text':'password'} value={secret} onChange={e=>setSecret(e.target.value)} maxLength={512} autoComplete="new-password" placeholder={config.hasSecret?'已保存；留空保留当前凭据':'请输入凭据'} disabled={!config.encryptionReady||busy}/><button type="button" aria-label={visible?'隐藏凭据':'显示凭据'} onClick={()=>setVisible(!visible)}>{visible?<EyeOff size={18}/>:<Eye size={18}/>}</button></span><small className="muted">凭据加密保存在服务器，不会回传原文。{config.hasSecret?' 当前已有凭据。':''}</small></label>
        {config.hasSecret&&<label className="settings-check"><input type="checkbox" checked={clear} onChange={e=>{setClear(e.target.checked);if(e.target.checked)setConfig({...config,enabled:false});}}/>清除已保存凭据</label>}
        <label className="settings-check"><input type="checkbox" checked={config.enabled} onChange={e=>setConfig({...config,enabled:e.target.checked})}/>启用封面缓存自动清理</label>
        <p className="muted small">API Token 只需本站区域的 Zone → Cache Purge → Purge 权限。区域 ID 位于 Cloudflare 域名概览页。<a href="https://developers.cloudflare.com/fundamentals/api/get-started/create-token/" target="_blank" rel="noreferrer">查看创建 Token 的官方说明 ↗</a></p>
        <ErrorNote message={actionError}/>{message&&<p className="settings-success" role="status">{message}</p>}
        <div className="form-actions"><button className="button" disabled={busy}>{busy?'处理中…':'保存设置'}</button><button type="button" className="button secondary" disabled={busy||!config.enabled||!config.hasSecret||!!secret} onClick={()=>{void action('test');}}>测试已保存配置</button></div>
      </fieldset></form>
      <div className="settings-status"><h3>缓存清理状态</h3><p>待处理：{config.pending} 项</p><p className="muted small">{config.lastStatus||'暂无处理记录。启用后，替换封面或删除课程会自动提交清理。'}</p><button className="button secondary compact" disabled={busy||!config.enabled||!config.pending} onClick={()=>{void action('retry');}}>重试到期任务</button><p className="muted small">每批最多 6 个封面前缀，最多每分钟一次请求；失败自动退避并由每小时任务重试。启用前的历史缓存仍需在 Cloudflare 控制台清理。</p></div>
    </section>}
  </>;
}
