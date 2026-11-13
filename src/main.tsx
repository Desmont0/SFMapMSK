import { Component, lazy, Suspense, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
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
import type { EntryKind, PublicParticipant } from '../shared/participant';
import { defaultMapSettings, mapSettingsSchema } from '../shared/map-settings';
import { matchesPlate } from '../shared/plate';
import { Avatar } from './Card';
import Statistics from './Statistics';
const Admin=lazy(()=>import('./Admin'));
class ErrorBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<main className="recovery-page"><h1>Не удалось открыть SFMap</h1><p>Обновите страницу, чтобы загрузить приложение заново.</p><button className="primary" onClick={()=>location.reload()}>Перезагрузить</button></main>:this.props.children;}
}
const filters:Array<['all'|EntryKind,string]>=[['all','Все'],['person','Участники'],['garage','Гаражи'],['service','Сервисы'],['meetup','Встречи']];
function PublicMap(){
  const [participants,setParticipants]=useState<PublicParticipant[]>([]),[status,setStatus]=useState('');
  const [settings,setSettings]=useState(defaultMapSettings),[filter,setFilter]=useState<'all'|EntryKind>('all');
  const visible=useMemo(()=>filter==='all'?participants:participants.filter(p=>p.kind===filter),[participants,filter]);
  const [theme,setTheme]=useState<'dark'|'light'>(()=>{try{return localStorage.getItem('sfmap-theme')==='light'?'light':'dark';}catch{return 'dark';}});
  const [query,setQuery]=useState(''),[searchOpen,setSearchOpen]=useState(false),[focus,setFocus]=useState<{id:string;version:number}|null>(null);
  const [linked,setLinked]=useState(()=>location.pathname.startsWith('/p/')?location.pathname.slice(3):'');
  const results=visible.filter(p=>matchesPlate(p.plate,query)||(!!query.trim()&&(p.name+' '+p.city+' '+p.address).toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))));
  useEffect(()=>{const pop=()=>setLinked(location.pathname.startsWith('/p/')?location.pathname.slice(3):'');window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[]);
  useEffect(()=>{if(linked){const p=participants.find(p=>p.shareId===linked);if(p){setFilter('all');setFocus({id:p.id,version:Date.now()});setLinked('');}else if(participants.length)setStatus('Эта запись больше не доступна.');}},[linked,participants]);
  useEffect(()=>{try{localStorage.setItem('sfmap-theme',theme);}catch{}},[theme]);
  useEffect(()=>{
    let active=true,pending=false;
    const controller=new AbortController();
    async function load(){
      if(pending||document.visibilityState==='hidden')return;pending=true;
      try{
        const response=await api<{participants:PublicParticipant[];stale:boolean}>('/participants',{signal:controller.signal});
        if(!active)return;
        setParticipants(previous=>JSON.stringify(previous)===JSON.stringify(response.participants)?previous:response.participants);
        setStatus(response.stale?'Показан последний сохранённый снимок':'');
      }catch{if(active)setStatus('Нет связи с сервером. Повторяем подключение…');}
      try{const value=mapSettingsSchema.parse(await api('/map-settings',{signal:controller.signal}));if(active)setSettings(previous=>JSON.stringify(previous)===JSON.stringify(value)?previous:value);}catch{/* Defaults keep the map available when settings cannot be fetched. */}
      finally{pending=false;}
    }
    void load();const interval=setInterval(()=>void load(),15000);
    const resume=()=>void load();window.addEventListener('online',resume);window.addEventListener('pageshow',resume);document.addEventListener('visibilitychange',resume);
    return()=>{active=false;controller.abort();clearInterval(interval);window.removeEventListener('online',resume);window.removeEventListener('pageshow',resume);document.removeEventListener('visibilitychange',resume);};
  },[]);
  function select(p:PublicParticipant){setFocus({id:p.id,version:Date.now()});setSearchOpen(false);}
  return <main className="public-map" data-theme={theme} style={{'--marker-font':settings.fontFamily,'--marker-font-size':settings.fontSize+'px','--marker-size':settings.markerSize+'px'} as CSSProperties}><MapView participants={visible} theme={theme} focus={focus} settings={settings}/><div className="map-toolbar"><div className="wordmark" aria-label="SFMap"><b>SF<span>MAP</span><i/></b><small>МОСКВА И ОБЛАСТЬ</small></div>
    <div className="plate-search" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setSearchOpen(false);}}>
      <form onSubmit={e=>{e.preventDefault();if(results.length===1)select(results[0]);else setSearchOpen(true);}}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
        <input aria-label="Поиск по госномеру, имени или месту" placeholder="Госномер, имя или место" value={query} onChange={e=>{setQuery(e.target.value);setSearchOpen(true);}} onFocus={()=>setSearchOpen(true)} onKeyDown={e=>{if(e.key==='Escape')setSearchOpen(false);}} aria-expanded={searchOpen&&!!query} aria-controls="plate-results" autoComplete="off"/>
        {query&&<button type="button" aria-label="Очистить поиск" onClick={()=>{setQuery('');setSearchOpen(false);}}>×</button>}
      </form>
      {searchOpen&&query&&<div className="plate-results" id="plate-results"><p role="status">{results.length?'Найдено: '+results.length:'Ничего не найдено'}</p>{results.map(p=><button key={p.id} onClick={()=>select(p)}><Avatar participant={p}/><span><b>{p.plate||p.name}</b><small>{p.name} · {p.city}</small></span><i>↗</i></button>)}</div>}
    </div><nav className="map-filters" aria-label="Типы записей на карте">{filters.map(([kind,label])=><button key={kind} type="button" aria-pressed={filter===kind} onClick={()=>{setFilter(kind);setSearchOpen(false);}}>{label}</button>)}</nav></div>
    <button className="theme-toggle" aria-label={theme==='dark'?'Включить светлую тему':'Включить тёмную тему'} title={theme==='dark'?'Светлая тема':'Тёмная тема'} onClick={()=>setTheme(t=>t==='dark'?'light':'dark')}>{theme==='dark'?<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M20 15.4A8.5 8.5 0 0 1 8.6 4a8.5 8.5 0 1 0 11.4 11.4Z"/></svg>}</button>
    <Statistics entries={participants}/>{status&&<div className="connection-status" role="status">{status}</div>}</main>;
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary>{location.pathname==='/'||location.pathname.startsWith('/p/')?<PublicMap/>:<Suspense fallback={<div className="page-loading">Загрузка…</div>}><Admin/></Suspense>}</ErrorBoundary>);
