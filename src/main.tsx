import { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@fontsource/manrope/cyrillic-400.css';
import '@fontsource/manrope/cyrillic-500.css';
import '@fontsource/manrope/cyrillic-600.css';
import '@fontsource/manrope/cyrillic-700.css';
import '@fontsource/manrope/cyrillic-800.css';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/manrope/latin-800.css';
import './style.css';
import MapView from './MapView';
import { api } from './api';
import type { PublicParticipant } from '../shared/participant';
import { matchesPlate } from '../shared/plate';
import { Avatar } from './Card';
import Statistics from './Statistics';
const Admin=lazy(()=>import('./Admin'));
function PublicMap(){
  const [participants,setParticipants]=useState<PublicParticipant[]>([]),[status,setStatus]=useState('');
  const [theme,setTheme]=useState<'dark'|'light'>(()=>{try{return localStorage.getItem('sfmap-theme')==='light'?'light':'dark';}catch{return 'dark';}});
  const [query,setQuery]=useState(''),[searchOpen,setSearchOpen]=useState(false),[focus,setFocus]=useState<{id:string;version:number}|null>(null);
  const [linked,setLinked]=useState(()=>location.pathname.startsWith('/p/')?location.pathname.slice(3):'');
  const results=participants.filter(p=>matchesPlate(p.plate,query)||(!!query.trim()&&(p.name+' '+p.city+' '+p.address).toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))));
  useEffect(()=>{const pop=()=>setLinked(location.pathname.startsWith('/p/')?location.pathname.slice(3):'');window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[]);
  useEffect(()=>{if(linked){const p=participants.find(p=>p.shareId===linked);if(p){setFocus({id:p.id,version:Date.now()});setLinked('');}else if(participants.length)setStatus('Эта запись больше не доступна.');}},[linked,participants]);
  useEffect(()=>{try{localStorage.setItem('sfmap-theme',theme);}catch{}},[theme]);
  useEffect(()=>{
    let active=true;
    async function load(){try{const response=await api<{participants:PublicParticipant[];stale:boolean}>('/participants');if(!active)return;setParticipants(response.participants);setStatus(response.stale?'Показан последний сохранённый снимок':'');}catch{if(active)setStatus('Нет связи с сервером. Повторяем подключение…');}}
    void load();const interval=setInterval(()=>void load(),15000);return()=>{active=false;clearInterval(interval);};
  },[]);
  function select(p:PublicParticipant){setFocus({id:p.id,version:Date.now()});setSearchOpen(false);}
  return <main className="public-map" data-theme={theme}><MapView participants={participants} theme={theme} focus={focus}/><div className="wordmark" aria-label="SFMap"><b>SF<span>MAP</span><i/></b><small>МОСКВА И ОБЛАСТЬ</small></div>
    <div className="plate-search" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setSearchOpen(false);}}>
      <form onSubmit={e=>{e.preventDefault();if(results.length===1)select(results[0]);else setSearchOpen(true);}}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
        <input aria-label="Поиск по госномеру, имени или месту" placeholder="Госномер, имя или место" value={query} onChange={e=>{setQuery(e.target.value);setSearchOpen(true);}} onFocus={()=>setSearchOpen(true)} onKeyDown={e=>{if(e.key==='Escape')setSearchOpen(false);}} aria-expanded={searchOpen&&!!query} aria-controls="plate-results" autoComplete="off"/>
        {query&&<button type="button" aria-label="Очистить поиск" onClick={()=>{setQuery('');setSearchOpen(false);}}>×</button>}
      </form>
      {searchOpen&&query&&<div className="plate-results" id="plate-results"><p role="status">{results.length?'Найдено: '+results.length:'Ничего не найдено'}</p>{results.map(p=><button key={p.id} onClick={()=>select(p)}><Avatar participant={p}/><span><b>{p.plate||p.name}</b><small>{p.name} · {p.city}</small></span><i>↗</i></button>)}</div>}
    </div>
    <button className="theme-toggle" aria-label={theme==='dark'?'Включить светлую тему':'Включить тёмную тему'} title={theme==='dark'?'Светлая тема':'Тёмная тема'} onClick={()=>setTheme(t=>t==='dark'?'light':'dark')}>{theme==='dark'?<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M20 15.4A8.5 8.5 0 0 1 8.6 4a8.5 8.5 0 1 0 11.4 11.4Z"/></svg>}</button>
    <Statistics entries={participants}/>{status&&<div className="connection-status" role="status">{status}</div>}</main>;
}
createRoot(document.getElementById('root')!).render(location.pathname==='/'||location.pathname.startsWith('/p/')?<PublicMap/>:<Suspense fallback={<div className="page-loading">Загрузка…</div>}><Admin/></Suspense>);
