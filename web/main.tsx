import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link, NavLink, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { ArrowUpRight, ChevronDown, LogOut, ShieldCheck, Sparkles } from 'lucide-react';
import { AuthProvider, useAuth } from './auth';
import { dateLabel, isExpired, vipLabel } from './api';
import { Loading, Empty } from './ui';
import Home from './home';
import { CourseList, CourseDetail, Player } from './student';
import Admin from './admin';
import Bootstrap from './bootstrap';
import DeploymentTools from './deployment-tools';
import './styles.css';
export function Brand(){return <Link className="brand" to="/"><span className="brand-icon"><Sparkles size={21}/></span><span>AI FDE<span className="brand-small">ACADEMY</span></span></Link>;}
function Header(){
  const {user,loading,openLogin,logout}=useAuth(),location=useLocation();const landing=location.pathname==='/';const [menu,setMenu]=useState(false),[error,setError]=useState('');
  useEffect(()=>{setMenu(false);},[location.pathname]);
  useEffect(()=>{const close=(e:MouseEvent)=>{if(!(e.target as Element).closest('.account-menu'))setMenu(false);};document.addEventListener('click',close);return()=>document.removeEventListener('click',close);},[]);
  return <header className="site-header"><div className="header-inner"><Brand/>{landing?<nav className="landing-nav"><a href="#curriculum">课程</a><a href="#advantages">课程优势</a><a href="#outcomes">学员成果</a></nav>:<nav className="student-nav"><NavLink to="/my-courses">我的课程</NavLink><NavLink to="/courses">全部课程</NavLink></nav>}
    <div className="header-actions">{user?<><Link className="header-course" to={user.role==='ADMIN'?'/admin':'/my-courses'}>{user.role==='ADMIN'?'管理后台':'进入课堂'}<ArrowUpRight size={15}/></Link><div className="account-menu"><button className="account-trigger" aria-label="我的" aria-expanded={menu} onClick={()=>setMenu(!menu)}><span className="avatar">{(user.name||user.email||user.phone||'我').slice(0,1).toUpperCase()}</span><span>我的</span><ChevronDown size={14}/></button>{menu&&<div className="dropdown"><strong>{user.name||'学员'}</strong><p className="small muted account-id">{user.email||user.phone}</p><div className="dropdown-vip"><ShieldCheck size={18}/><span>{vipLabel(user)}{isExpired(user)?' · 已到期':''}<small>{user.vipLevel?dateLabel(user.vipExpiresAt):'请联系管理员开通'}</small></span></div><button onClick={()=>logout().catch(e=>setError(e.message))}><LogOut size={16}/>退出登录</button>{error&&<p className="error-note">{error}</p>}</div>}</div></>:<button className="button compact" onClick={openLogin} disabled={loading}>登录 / 注册<ArrowUpRight size={15}/></button>}</div>
  </div></header>;
}
function Guard({admin=false,children}:{admin?:boolean;children:React.ReactNode}){const {user,loading,openLogin}=useAuth();if(loading)return <Loading/>;if(!user)return <main className="page"><Empty title="登录后开始学习"><p className="muted">使用手机号或邮箱登录你的账号。</p><button className="button" onClick={openLogin}>登录 / 注册</button></Empty></main>;if(admin&&user.role!=='ADMIN')return <Empty title="需要管理员权限"/>;return <>{children}</>;}
function Scroll(){const {pathname}=useLocation();useEffect(()=>{window.scrollTo(0,0);},[pathname]);return null;}
function App(){return <BrowserRouter><AuthProvider><Scroll/><Header/><Routes>
  <Route path="/setup" element={<Bootstrap/>}/>
  <Route path="/deployment-tools" element={<DeploymentTools/>}/>
  <Route path="/" element={<Home/>}/><Route path="/my-courses" element={<Guard><CourseList mine/></Guard>}/><Route path="/courses" element={<Guard><CourseList/></Guard>}/><Route path="/courses/:id" element={<Guard><CourseDetail/></Guard>}/><Route path="/lessons/:id" element={<Guard><Player/></Guard>}/><Route path="/admin/*" element={<Guard admin><Admin/></Guard>}/><Route path="*" element={<Empty title="页面不存在"><Link className="button" to="/">返回首页</Link></Empty>}/>
  </Routes></AuthProvider></BrowserRouter>;}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

