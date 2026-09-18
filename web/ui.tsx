import { useEffect, useRef, type ReactNode } from 'react';
import { X, LoaderCircle, AlertCircle, FolderOpen } from 'lucide-react';
export function Modal({title,onClose,children,wide=false}:{title:string;onClose:()=>void;children:ReactNode;wide?:boolean}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=ref.current!;dialog.showModal();return()=>dialog.close();},[]);
  return <dialog className={`modal ${wide?'wide':''}`} ref={ref} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={20}/></button></div>{children}
  </dialog>;
}
export function Loading(){return <div className="state"><LoaderCircle className="spin"/><p>正在加载…</p></div>;}
export function ErrorState({message,retry}:{message:string;retry?:()=>void}){return <div className="state error"><AlertCircle/><p>{message}</p>{retry&&<button className="button secondary" onClick={retry}>重新加载</button>}</div>;}
export function Empty({title,children}:{title:string;children?:ReactNode}){return <div className="state empty"><span className="empty-icon"><FolderOpen size={32}/></span><h3>{title}</h3>{children}</div>;}
export function ErrorNote({message}:{message:string}){return message?<p className="error-note" role="alert"><AlertCircle size={16}/>{message}</p>:null;}
export function Confirm({title,message,onClose,onConfirm,busy,error}:{title:string;message:string;onClose:()=>void;onConfirm:()=>void;busy:boolean;error:string}){
  return <Modal title={title} onClose={()=>{if(!busy)onClose();}}><p className="muted">{message}</p><ErrorNote message={error}/><div className="form-actions"><button className="button secondary" disabled={busy} onClick={onClose}>取消</button><button className="button danger" disabled={busy} onClick={onConfirm}>{busy?'处理中…':'确认'}</button></div></Modal>;
}
