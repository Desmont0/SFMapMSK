import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { difference } from '@turf/difference';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { initials, type PublicParticipant } from '../shared/participant';
import { Avatar, Card, avatarHue } from './Card';
maplibregl.setWorkerUrl(workerUrl);

export const DISTRICT_ZOOM = 12;
const MIN_ZOOM = 6.3;
function enhanceRoadContrast(style: StyleSpecification, theme: 'dark' | 'light') {
  const colors = theme === 'dark'
    ? { casing: '#63776e', inner: '#b8cabe', subtle: '#7e9487', minor: '#637b6d', path: '#566b60' }
    : { casing: '#71877a', inner: '#ffffff', subtle: '#7b9182', minor: '#83988b', path: '#99aa9e' };
  for (const layer of style.layers) {
    if (layer.type !== 'line' || !/^(highway_|tunnel_)/.test(layer.id)) continue;
    const color = /casing/.test(layer.id) ? colors.casing
      : /subtle/.test(layer.id) ? colors.subtle
      : /minor/.test(layer.id) ? colors.minor
      : /path/.test(layer.id) ? colors.path : colors.inner;
    layer.paint = { ...layer.paint, 'line-color': color, 'line-opacity': .95 };
  }
}
type Props = { participants: PublicParticipant[]; theme: 'dark' | 'light'; focus: { id: string; version: number } | null };
const compareParticipants = (a: PublicParticipant, b: PublicParticipant) =>
  a.city.localeCompare(b.city, 'ru') || a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id);
function markerElement(p: PublicParticipant) {
  const button = document.createElement('button');
  button.className = 'map-avatar'; button.type = 'button'; button.title = p.name + ' · ' + p.city;
  button.setAttribute('aria-label', 'Открыть: ' + p.name + ', ' + p.city);
  button.style.setProperty('--avatar-hue', String(avatarHue(p.name)));
  const label = document.createElement('span'); label.textContent = initials(p.name || 'Участник'); button.append(label);
  if (p.avatar) { const img = document.createElement('img'); img.src = p.avatar; img.alt = ''; img.onerror = () => img.remove(); button.append(img); }
  return button;
}
function clusterElement(pointCount: number, leaves: PublicParticipant[]) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'cluster';
  button.setAttribute('aria-label', 'Открыть группу: ' + pointCount + ' участников');
  const stack = document.createElement('span'); stack.className = 'cluster-stack';
  leaves.slice(0, 3).forEach((p, index) => {
    const avatar = document.createElement('span'); avatar.className = 'cluster-avatar';
    avatar.style.setProperty('--stack-index', String(index));
    avatar.style.setProperty('--avatar-hue', String(avatarHue(p.name)));
    const label = document.createElement('span');
    label.className = 'cluster-initials';
    label.textContent = initials(p.name || 'Участник');
    avatar.append(label);
    if (index === 0) {
      const count = document.createElement('span');
      count.className = 'cluster-count';
      count.textContent = String(pointCount);
      avatar.append(count);
    }
    if (p.avatar) {
      const image = document.createElement('img'); image.src = p.avatar; image.alt = '';
      image.onerror = () => image.remove(); avatar.append(image);
    }
    stack.append(avatar);
  });
  button.append(stack);
  return button;
}
export default function MapView({ participants, theme, focus }: Props) {
  const container = useRef<HTMLDivElement>(null), map = useRef<maplibregl.Map | null>(null);
  const data = useRef(participants), markers = useRef<maplibregl.Marker[]>([]);
  const view = useRef<{center: [number, number]; zoom: number}>({center: [37.58,55.77], zoom: 9.15});
  const appliedFocus = useRef<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null), [group, setGroup] = useState<string[]>([]);
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  const [zoom, setZoom] = useState(view.current.zoom);
  data.current = participants;
  useEffect(() => {
    let disposed = false; setReady(false); setError('');
    const controller = new AbortController();
    async function create() {
      try {
        const [styleResponse, regionResponse] = await Promise.all([fetch('https://tiles.openfreemap.org/styles/' + (theme === 'light' ? 'positron' : 'dark'), {signal: controller.signal}), fetch('/geo/region.geojson', {signal: controller.signal})]);
        if (!styleResponse.ok || !regionResponse.ok) throw new Error('Не удалось загрузить карту');
        const style: StyleSpecification = await styleResponse.json();
        enhanceRoadContrast(style, theme);
        const region: FeatureCollection<Polygon | MultiPolygon> = await regionResponse.json();
        for (const layer of style.layers) {
          if (layer.type === 'symbol' && layer.layout?.['text-field']) layer.layout['text-field'] = ['coalesce',['get','name:ru'],['get','name'],['get','name:latin']];
          if (layer.type === 'background') layer.paint = {...layer.paint, 'background-color': theme === 'light' ? '#e9eee8' : '#171d20'};
        }
        if (disposed) return;
        const m = new maplibregl.Map({container: container.current!, style, ...view.current, minZoom:MIN_ZOOM, maxZoom:DISTRICT_ZOOM, maxBounds:[[34.7,54.1],[41,57.2]], attributionControl:{compact:true}, renderWorldCopies:false, pitchWithRotate:false, dragRotate:false, locale:{'ScaleControl.Meters':'м','ScaleControl.Kilometers':'км'}});
        m.touchZoomRotate.disableRotation(); map.current = m;
        m.addControl(new maplibregl.ScaleControl({maxWidth:110,unit:'metric'}), 'bottom-left');
        m.on('zoom', () => setZoom(m.getZoom()));
        setZoom(m.getZoom());
        m.on('load', () => {
          const world: GeoJSON.Feature<Polygon> = {type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[-180,-85],[180,-85],[180,85],[-180,85],[-180,-85]]]}};
          const mask = difference({type:'FeatureCollection',features:[world,...region.features]});
          m.addSource('outside', {type:'geojson',data:mask!});
          m.addLayer({id:'outside',type:'fill',source:'outside',paint:{'fill-color':theme === 'light' ? '#e4e9e2' : '#101517','fill-opacity':1}});
          m.addSource('region', {type:'geojson',data:region});
          m.addLayer({id:'region-border',type:'line',source:'region',paint:{'line-color':theme === 'light' ? '#526f5c' : '#809890','line-width':1,'line-opacity':.3}});
          m.addSource('people', {type:'geojson',data:{type:'FeatureCollection',features:[]},cluster:true,clusterMaxZoom:DISTRICT_ZOOM,clusterRadius:48});
          m.addLayer({id:'people-hidden',type:'circle',source:'people',paint:{'circle-radius':0,'circle-opacity':0}});
          setReady(true);
        });
        m.on('click', () => { setSelected(null); setGroup([]); });
        m.on('moveend', () => { view.current = {center:[m.getCenter().lng,m.getCenter().lat],zoom:m.getZoom()}; if(container.current) container.current.dataset.zoom=String(m.getZoom()); });
        m.on('error', e => { if (!m.isStyleLoaded()) setError('Карта загружается дольше обычного. Проверьте подключение к интернету.'); console.warn('Map source:',e.error?.message); });
        m.on('idle', () => setError(''));
      } catch(e) { if (!disposed) setError(e instanceof Error ? e.message : 'Карта недоступна'); }
    }
    void create();
    return () => { disposed=true; controller.abort(); const m=map.current; if(m) view.current={center:[m.getCenter().lng,m.getCenter().lat],zoom:m.getZoom()}; markers.current.forEach(marker=>marker.remove()); markers.current=[]; m?.remove(); map.current=null; };
  }, [theme]);
  useEffect(() => {
    const m=map.current; if (!ready || !m || !m.getSource('people')) return;
    const source=m.getSource('people') as GeoJSONSource;
    source.setData({type:'FeatureCollection',features:participants.map(p=>({type:'Feature',geometry:{type:'Point',coordinates:[p.longitude,p.latitude]},properties:{id:p.id}}))});
    let drawToken = 0;
    async function draw() {
      if (!m || !m.isStyleLoaded()) return;
      const token = ++drawToken;
      const nextMarkers: Array<{element: HTMLButtonElement; coords: [number, number]}> = [];
      const seen=new Set<string>();
      for (const feature of m.querySourceFeatures('people')) {
        if (token !== drawToken || map.current !== m) return;
        const properties=feature.properties!; const key=properties.cluster ? 'c'+properties.cluster_id : String(properties.id);
        if (seen.has(key) || feature.geometry.type !== 'Point') continue; seen.add(key);
        const coords=feature.geometry.coordinates as [number,number];
        let element: HTMLButtonElement;
        if (properties.cluster) {
          const pointCount = Number(properties.point_count) || 0;
          const leaves = (await source.getClusterLeaves(Number(properties.cluster_id), Math.max(pointCount, 3), 0))
            .map(feature => data.current.find(p => p.id === String(feature.properties?.id)))
            .filter((p): p is PublicParticipant => !!p).sort(compareParticipants).slice(0, 3);
          if (token !== drawToken || map.current !== m) return;
          element=clusterElement(pointCount, leaves);
          element.onclick=async e=>{
            e.stopPropagation();
            try {
              const leaves=await source.getClusterLeaves(Number(properties.cluster_id),1000,0);
              if(map.current !== m) return;
              setSelected(null); setGroup(leaves.map(f=>String(f.properties!.id)));
            } catch { setError('Не удалось открыть группу. Нажмите ещё раз.'); }
          };
        } else {
          const p=data.current.find(p=>p.id===properties.id); if (!p) continue;
          element=markerElement(p); element.onclick=e=>{e.stopPropagation();setGroup([]);setSelected(p.id);};
        }
        nextMarkers.push({element, coords});
      }
      if (token !== drawToken || map.current !== m) return;
      markers.current.forEach(marker=>marker.remove());
      markers.current=nextMarkers.map(({element,coords})=>new maplibregl.Marker({element}).setLngLat(coords).addTo(m));
    }
    m.on('moveend',draw);m.on('sourcedata',draw);void draw();
    return()=>{drawToken++;m.off('moveend',draw);m.off('sourcedata',draw);};
  },[participants,ready,theme]);
  useEffect(()=>{
    if(!focus || !ready || appliedFocus.current === focus.version) return;
    const p=data.current.find(p=>p.id===focus.id); if(!p) return;
    setGroup([]);setSelected(p.id);
    appliedFocus.current=focus.version;
    map.current?.easeTo({center:[p.longitude,p.latitude],zoom:Math.max(view.current.zoom,10.5),duration:500});
  },[focus,ready]);
  const p=participants.find(p=>p.id===selected);
  const members=participants.filter(p=>group.includes(p.id)).sort(compareParticipants);
  const places=new Set(members.map(p=>p.city));
  function changeZoom(value: number, animate = false) {
    const m = map.current;
    if (!m || !ready) return;
    const next = Math.min(DISTRICT_ZOOM, Math.max(MIN_ZOOM, value));
    m.stop();
    if (animate) m.easeTo({zoom:next,duration:220});
    else m.setZoom(next);
  }
  return <div className="map-shell"><div className="map-canvas" ref={container} data-zoom={view.current.zoom} aria-label="Карта участников Москвы и Московской области"/>
    {!ready&&!error&&<div className="map-loading"><span className="loading-ring"/>Загружаем карту</div>}
    {error&&<div className="map-error" role="status">{error}</div>}
    <div className="zoom-controls" role="group" aria-label="Масштаб карты">
      <button type="button" aria-label="Приблизить карту" title="Приблизить" disabled={!ready||zoom>=DISTRICT_ZOOM-.001} onClick={()=>changeZoom((map.current?.getZoom()??zoom)+1,true)}>+</button>
      <input type="range" aria-label="Приближение карты" aria-orientation="vertical" aria-valuetext={zoom>=DISTRICT_ZOOM-.01?'Максимальное приближение: район':zoom<=MIN_ZOOM+.01?'Минимальное приближение: область':'Уровень приближения '+zoom.toFixed(1)} min={MIN_ZOOM} max={DISTRICT_ZOOM} step="0.01" value={zoom} disabled={!ready} onChange={e=>changeZoom(Number(e.target.value))}/>
      <button type="button" aria-label="Отдалить карту" title="Отдалить" disabled={!ready||zoom<=MIN_ZOOM+.001} onClick={()=>changeZoom((map.current?.getZoom()??zoom)-1,true)}>−</button>
    </div>
    {members.length>0&&!p&&<section className="group-panel" aria-label="Участники группы"><button className="close" aria-label="Закрыть список" onClick={()=>setGroup([])}>×</button>
      <span className="eyebrow">СВОИ РЯДОМ · {members.length}</span><h2>{places.size===1 ? members[0].city : 'Участники в этой области'}</h2>
      <p className="group-hint">Выберите участника, чтобы открыть карточку</p><div className="group-members">{members.map(p=><button key={p.id} onClick={()=>setSelected(p.id)}><Avatar participant={p}/><span><b>{p.name}</b><small>{p.city}</small><em>{p.plate||'Госномер не указан'}</em></span><i>↗</i></button>)}</div>
    </section>}
    {p&&<><Card participant={p} onClose={()=>setSelected(null)}/>{members.length>0&&<button className="back-to-group" onClick={()=>setSelected(null)}>← К списку участников</button>}</>}
  </div>;
}
