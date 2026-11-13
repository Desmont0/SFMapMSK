import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { difference } from '@turf/difference';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { initials, kindIcons, kindLabels, type PublicParticipant } from '../shared/participant';
import type { MapSettings } from '../shared/map-settings';
import { clusterEntries } from './clusters';
import { fetchWithTimeout } from './network';
import { Avatar, Card, avatarHue } from './Card';
maplibregl.setWorkerUrl(workerUrl);
maplibregl.setWorkerCount(2);

export const DISTRICT_ZOOM = 12;
const MIN_ZOOM = 6.3;
let regionData: Promise<{region:FeatureCollection<Polygon|MultiPolygon>;mask:ReturnType<typeof difference>}> | null = null;
function loadRegion() {
  if(!regionData) regionData=(async()=>{
    const response=await fetchWithTimeout('/geo/region.geojson');
    if(!response.ok)throw new Error('Не удалось загрузить границы карты');
    const region=await response.json() as FeatureCollection<Polygon|MultiPolygon>;
    const world:GeoJSON.Feature<Polygon>={type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[-180,-85],[180,-85],[180,85],[-180,85],[-180,-85]]]}};
    return {region,mask:difference({type:'FeatureCollection',features:[world,...region.features]})};
  })().catch(error=>{regionData=null;throw error;});
  return regionData;
}
function enhanceRoadContrast(style:StyleSpecification,theme:'dark'|'light') {
  const colors=theme==='dark'?{casing:'#63776e',inner:'#b8cabe',subtle:'#7e9487',minor:'#637b6d',path:'#566b60'}:{casing:'#71877a',inner:'#ffffff',subtle:'#7b9182',minor:'#83988b',path:'#99aa9e'};
  for(const layer of style.layers) {
    if(layer.type==='line'&&/^(highway_|tunnel_)/.test(layer.id)) layer.paint={...layer.paint,'line-color':/casing/.test(layer.id)?colors.casing:/subtle/.test(layer.id)?colors.subtle:/minor/.test(layer.id)?colors.minor:/path/.test(layer.id)?colors.path:colors.inner,'line-opacity':.95};
    if(layer.type==='symbol'&&layer.layout?.['text-field'])layer.layout['text-field']=['coalesce',['get','name:ru'],['get','name'],['get','name:latin']];
    if(layer.type==='background')layer.paint={...layer.paint,'background-color':theme==='light'?'#e9eee8':'#171d20'};
  }
}
type Props={participants:PublicParticipant[];theme:'dark'|'light';focus:{id:string;version:number}|null;settings:MapSettings};
const compareParticipants=(a:PublicParticipant,b:PublicParticipant)=>a.city.localeCompare(b.city,'ru')||a.name.localeCompare(b.name,'ru')||a.id.localeCompare(b.id);
function markerElement(p:PublicParticipant) {
  const button=document.createElement('button');button.className='map-avatar kind-'+p.kind;button.type='button';button.title=kindLabels[p.kind]+' · '+p.name+' · '+p.city;button.dataset.entryId=p.id;
  button.setAttribute('aria-label','Открыть: '+p.name+', '+p.city);button.style.setProperty('--avatar-hue',String(avatarHue(p.name)));
  const label=document.createElement('span');label.textContent=kindIcons[p.kind]||initials(p.name);button.append(label);
  if(p.avatar){const img=document.createElement('img');img.src=p.avatar;img.alt='';img.onerror=()=>img.remove();button.append(img);}
  return button;
}
function clusterElement(leaves:PublicParticipant[]) {
  const button=document.createElement('button');button.type='button';button.className='cluster';button.setAttribute('aria-label','Открыть группу: '+leaves.length+' записей');
  const stack=document.createElement('span');stack.className='cluster-stack';
  leaves.slice(0,3).forEach((p,index)=>{
    const avatar=document.createElement('span');avatar.className='cluster-avatar kind-'+p.kind;avatar.style.setProperty('--stack-index',String(index));avatar.style.setProperty('--avatar-hue',String(avatarHue(p.name)));
    const label=document.createElement('span');label.className='cluster-initials';label.textContent=kindIcons[p.kind]||initials(p.name);avatar.append(label);
    if(p.avatar){const img=document.createElement('img');img.src=p.avatar;img.alt='';img.onerror=()=>img.remove();avatar.append(img);}
    if(index===0){const count=document.createElement('span');count.className='cluster-count';count.textContent=String(leaves.length);avatar.append(count);}
    stack.append(avatar);
  });button.append(stack);return button;
}
export default function MapView({participants,theme,focus,settings}:Props) {
  const container=useRef<HTMLDivElement>(null),map=useRef<maplibregl.Map|null>(null),markers=useRef<maplibregl.Marker[]>([]);
  const view=useRef<{center:[number,number];zoom:number}>({center:[37.58,55.77],zoom:9.15});
  const [selected,setSelected]=useState<string|null>(null),[group,setGroup]=useState<string[]>([]),[ready,setReady]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[zoom,setZoom]=useState(view.current.zoom);
  const appliedFocus=useRef<number|null>(null),retries=useRef(0),readyRef=useRef(false);
  const retry=()=>{retries.current=0;setAttempt(v=>v+1);};
  useEffect(()=>{
    let disposed=false,initialized=false;setReady(false);readyRef.current=false;setError('');
    const controller=new AbortController();
    const watchdog=setTimeout(()=>{if(!disposed&&!initialized){controller.abort();setError('Загрузка карты прервана. Повторяем подключение…');}},20000);
    const cleanups:Array<()=>void>=[];
    void (async()=>{try{
      const [response,{region,mask}]=await Promise.all([fetchWithTimeout('/map-cache/styles/'+(theme==='light'?'positron':'dark'),{signal:controller.signal}),loadRegion()]);
      if(!response.ok)throw new Error('Сервер карты временно недоступен');
      const style=await response.json() as StyleSpecification;
      if(disposed)return;
      const absolute=(url:string)=>new URL(url,location.origin).href.replace(/%7B/gi,'{').replace(/%7D/gi,'}');
      if(typeof style.sprite==='string')style.sprite=absolute(style.sprite);if(style.glyphs)style.glyphs=absolute(style.glyphs);
      await Promise.all(Object.values(style.sources).map(async source=>{
        if(source.type!=='vector'&&source.type!=='raster')return;
        // Resolve TileJSON under a deadline, before handing templates to map workers.
        if(source.url){
          const tileResponse=await fetchWithTimeout(absolute(source.url),{signal:controller.signal});
          if(!tileResponse.ok)throw new Error('Не удалось загрузить источник карты');
          const tileJson=await tileResponse.json();
          for(const key of ['tiles','minzoom','maxzoom','attribution','scheme'] as const)if(tileJson[key]!==undefined&&source[key]===undefined)Object.assign(source,{[key]:tileJson[key]});
          if(source.type==='raster'&&source.tileSize===undefined&&tileJson.tileSize!==undefined)source.tileSize=tileJson.tileSize;
          delete source.url;
        }
        if(source.tiles)source.tiles=source.tiles.map(absolute);
        source.bounds=[34.7,54.1,41,57.2];
      }));
      if(disposed)return;
      enhanceRoadContrast(style,theme);
      const m=new maplibregl.Map({container:container.current!,style,...view.current,minZoom:MIN_ZOOM,maxZoom:DISTRICT_ZOOM,maxBounds:[[34.7,54.1],[41,57.2]],pixelRatio:Math.min(window.devicePixelRatio||1,2),canvasContextAttributes:{antialias:false},attributionControl:{compact:true},renderWorldCopies:false,pitchWithRotate:false,dragRotate:false,transformRequest:url=>({url:absolute(url)}),locale:{'ScaleControl.Meters':'м','ScaleControl.Kilometers':'км'}});
      map.current=m;m.touchZoomRotate.disableRotation();m.addControl(new maplibregl.ScaleControl({maxWidth:100,unit:'metric'}),'bottom-left');
      m.on('zoom',()=>setZoom(m.getZoom()));setZoom(m.getZoom());
      // style.load does not wait forever for unavailable tiles before showing people and controls.
      m.once('style.load',()=>{if(disposed)return;try{
        if(mask){m.addSource('outside',{type:'geojson',data:mask});m.addLayer({id:'outside',type:'fill',source:'outside',paint:{'fill-color':theme==='light'?'#e4e9e2':'#101517','fill-opacity':1}});}
        m.addSource('region',{type:'geojson',data:region});m.addLayer({id:'region-border',type:'line',source:'region',paint:{'line-color':theme==='light'?'#526f5c':'#809890','line-width':1,'line-opacity':.3}});
        initialized=true;clearTimeout(watchdog);readyRef.current=true;setReady(true);setError('');
      }catch{setError('Не удалось подготовить карту. Нажмите «Повторить».');}});
      m.on('click',()=>{setSelected(null);setGroup([]);});
      m.on('moveend',()=>{view.current={center:[m.getCenter().lng,m.getCenter().lat],zoom:m.getZoom()};if(container.current)container.current.dataset.zoom=String(m.getZoom());});
      m.on('error',()=>{if(!disposed)setError('Часть карты не загрузилась. Нажмите «Повторить» для восстановления.');});
      m.on('idle',()=>{if(!disposed&&initialized){retries.current=0;setError('');}});
      m.on('webglcontextlost',()=>{if(!disposed){readyRef.current=false;setReady(false);setError('Восстанавливаем карту после сбоя графики…');}});
      m.on('webglcontextrestored',()=>{if(!disposed)setAttempt(v=>v+1);});
      const resize=()=>{if(!disposed)m.resize();};const observer=new ResizeObserver(resize);observer.observe(container.current!);
      window.visualViewport?.addEventListener('resize',resize);window.addEventListener('orientationchange',resize);
      cleanups.push(()=>{observer.disconnect();window.visualViewport?.removeEventListener('resize',resize);window.removeEventListener('orientationchange',resize);});
    }catch(e){if(!disposed)setError((e as Error).name==='AbortError'?'Не удалось дождаться ответа сервера. Повторяем…':(e as Error).message||'Карта недоступна');}})();
    return()=>{disposed=true;clearTimeout(watchdog);controller.abort();cleanups.forEach(fn=>fn());const m=map.current;if(m)view.current={center:[m.getCenter().lng,m.getCenter().lat],zoom:m.getZoom()};markers.current.forEach(marker=>marker.remove());markers.current=[];m?.remove();map.current=null;};
  },[theme,attempt]);
  useEffect(()=>{if(!error||retries.current>=3)return;const timer=setTimeout(()=>{retries.current++;setAttempt(v=>v+1);},6000);return()=>clearTimeout(timer);},[error]);
  useEffect(()=>{const resume=()=>{if(document.visibilityState==='hidden')return;if(!readyRef.current)retry();else map.current?.resize();};window.addEventListener('online',resume);window.addEventListener('pageshow',resume);document.addEventListener('visibilitychange',resume);return()=>{window.removeEventListener('online',resume);window.removeEventListener('pageshow',resume);document.removeEventListener('visibilitychange',resume);};},[]);
  useEffect(()=>{
    const m=map.current;if(!ready||!m)return;
    const clusters=clusterEntries(participants,settings.clusterRadius);
    const draw=()=>{
      if(map.current!==m)return;
      const next=clusters(Math.floor(m.getZoom()));
      markers.current.forEach(marker=>marker.remove());
      markers.current=next.map(({members,coordinates})=>{
        const element=members.length===1?markerElement(members[0]):clusterElement(members);
        element.onclick=e=>{e.stopPropagation();if(members.length===1){setGroup([]);setSelected(members[0].id);}else {setSelected(null);setGroup(members.map(p=>p.id));}};
        return new maplibregl.Marker({element,anchor:'center',subpixelPositioning:true}).setLngLat(coordinates).addTo(m);
      });
    };draw();m.on('zoomend',draw);
    return()=>{m.off('zoomend',draw);markers.current.forEach(marker=>marker.remove());markers.current=[];};
  },[participants,ready,settings.clusterRadius,theme]);
  useEffect(()=>{
    if(!focus||appliedFocus.current===focus.version)return;const p=participants.find(p=>p.id===focus.id);if(!p)return;
    setSelected(p.id);setGroup([]);
    if(ready){appliedFocus.current=focus.version;map.current?.easeTo({center:[p.longitude,p.latitude],zoom:Math.max(view.current.zoom,10.5),duration:350});}
  },[focus,ready,participants]);
  const p=participants.find(p=>p.id===selected),members=participants.filter(p=>group.includes(p.id)).sort(compareParticipants),places=new Set(members.map(p=>p.city));
  function changeZoom(value:number){if(ready)map.current?.easeTo({zoom:Math.min(DISTRICT_ZOOM,Math.max(MIN_ZOOM,value)),duration:180});}
  return <div className="map-shell"><div className="map-canvas" ref={container} data-zoom={view.current.zoom} aria-label="Карта участников Москвы и Московской области"/>
    {!ready&&!error&&<div className="map-loading"><span className="loading-ring"/>Загружаем карту</div>}
    {error&&<div className="map-error" role="status">{error} <button className="text-button" onClick={retry}>Повторить</button></div>}
    <div className="zoom-controls" role="group" aria-label="Масштаб карты"><button type="button" aria-label="Приблизить карту" disabled={!ready||zoom>=DISTRICT_ZOOM-.001} onClick={()=>changeZoom(zoom+1)}>+</button><input type="range" aria-label="Приближение карты" aria-orientation="vertical" min={MIN_ZOOM} max={DISTRICT_ZOOM} step="0.01" value={zoom} disabled={!ready} onChange={e=>{map.current?.stop();map.current?.setZoom(Number(e.target.value));}}/><button type="button" aria-label="Отдалить карту" disabled={!ready||zoom<=MIN_ZOOM+.001} onClick={()=>changeZoom(zoom-1)}>−</button></div>
    {members.length>0&&!p&&<section className="group-panel" aria-label="Участники группы"><button className="close" aria-label="Закрыть список" onClick={()=>setGroup([])}>×</button><span className="eyebrow">СВОИ РЯДОМ · {members.length}</span><h2>{places.size===1?members[0].city:'Записи в этой области'}</h2><p className="group-hint">Выберите запись, чтобы открыть карточку</p><div className="group-members">{members.map(p=><button key={p.id} onClick={()=>setSelected(p.id)}><Avatar participant={p}/><span><b>{p.name}</b><small>{p.city}</small><em>{p.kind==='person'?p.plate||'Госномер не указан':kindLabels[p.kind]}</em></span><i>↗</i></button>)}</div></section>}
    {p&&<><Card key={p.id} participant={p} onClose={()=>setSelected(null)}/>{members.length>0&&<button className="back-to-group" onClick={()=>setSelected(null)}>← К списку</button>}</>}
  </div>;
}
