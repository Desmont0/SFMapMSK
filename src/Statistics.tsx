import { useEffect, useRef, useState } from 'react';
import type { PublicParticipant } from '../shared/participant';
import { statistics } from '../shared/statistics';
export default function Statistics({entries}:{entries:PublicParticipant[]}) {
  const [open,setOpen]=useState(false),data=statistics(entries);
  const panel=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!open)return;const outside=(e:PointerEvent)=>{if(!panel.current?.contains(e.target as Node))setOpen(false);};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};},[open]);
  return <div ref={panel} className="statistics">
    <button className="statistics-toggle" aria-expanded={open} aria-controls="statistics-panel" onClick={()=>setOpen(v=>!v)}>▥ Статистика <span>{data.people}</span></button>
    {open&&<section className="statistics-panel" id="statistics-panel" aria-label="Статистика сообщества">
      <button className="close" aria-label="Закрыть статистику" onClick={()=>setOpen(false)}>×</button>
      <span className="eyebrow">СООБЩЕСТВО В ЦИФРАХ</span><h2>Статистика</h2>
      <p className="statistics-totals">Участников: <b>{data.people}</b> · Мест: <b>{data.places}</b></p>
      {data.sections.filter(s=>s.rows.length).map(section=><details key={section.title}><summary>{section.title}</summary><table><thead><tr><th>Значение</th><th>Кол-во</th><th>%</th></tr></thead><tbody>{section.rows.map(([label,count])=><tr key={label}><td>{label}</td><td>{count}</td><td>{section.total?Math.round(count/section.total*100):0}</td></tr>)}</tbody></table></details>)}
      {!entries.length&&<p>Записей пока нет.</p>}
      <p className="statistics-note">Автомобильная статистика учитывает только участников. Неуказанные параметры показаны отдельно.</p>
    </section>}
  </div>;
}
