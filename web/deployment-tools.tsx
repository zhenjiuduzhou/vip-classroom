import { useState } from 'react';
import { ErrorNote } from './ui';
function randomSecret() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
}
export default function DeploymentTools() {
  const [token,setToken]=useState(''),[key,setKey]=useState(''),[origin,setOrigin]=useState(''),[cors,setCors]=useState(''),[error,setError]=useState('');
  function generateCors() {
    setError('');setCors('');
    try {
      const url=new URL(origin);
      if(url.protocol!=='https:' || origin!==url.origin || url.username || url.password) throw new Error();
      setCors(JSON.stringify([{AllowedOrigins:[origin],AllowedMethods:['PUT'],AllowedHeaders:['Content-Type'],ExposeHeaders:['ETag'],MaxAgeSeconds:3600}],null,2));
    } catch {setError('请输入完整的 HTTPS 网站来源，不带结尾斜杠或路径。');}
  }
  return <main className="page bootstrap-page"><section className="settings-card bootstrap-card">
    <span className="eyebrow">部署工具</span><h1>准备首次安装配置</h1>
    <p className="muted">密钥由当前浏览器随机生成，不发送到服务器，不保存到浏览器存储。复制后请妥善保存，刷新页面会清空。</p>
    <div className="settings-fields">
      <button className="button" onClick={()=>{setToken(randomSecret());setKey(randomSecret());}}>生成两份独立密钥</button>
      <label>BOOTSTRAP_TOKEN<input value={token} readOnly autoComplete="off" onFocus={e=>e.target.select()}/></label>
      <label>SETTINGS_ENCRYPTION_KEY<input value={key} readOnly autoComplete="off" onFocus={e=>e.target.select()}/></label>
      <p className="small muted">将这两份值分别填入 Worker 的同名 Secret。重新生成不会修改 CF 中已保存的值；加密密钥部署后应保持稳定。</p>
      <label>正式网站来源<input value={origin} onChange={e=>{setOrigin(e.target.value);setCors('');}} placeholder="https://classroom.yourdomain.com"/></label>
      <button className="button secondary" onClick={generateCors}>生成 R2 网页 CORS 配置</button><ErrorNote message={error}/>
      {cors&&<label>复制到 R2 → Settings → CORS Policy<textarea value={cors} readOnly rows={15} onFocus={e=>e.target.select()}/></label>}
    </div>
  </section></main>;
}
