import { useState } from 'react';
import type { PublicParticipant } from '../shared/participant';
import { statistics } from '../shared/statistics';
export default function Statistics({entries}:{entries:PublicParticipant[]}) {
  const [open,setOpen]=useState(false),data=statistics(entries);
  return <>
    <button className="statistics-toggle" aria-expanded={open} aria-controls="statistics-panel" onClick={()=>setOpen(v=>!v)}>▥ Статистика <span>{data.people}</span></button>
    {open&&<section className="statistics-panel" id="statistics-panel" aria-label="Статистика сообщества">
      <button className="close" aria-label="Закрыть статистику" onClick={()=>setOpen(false)}>×</button>
      <span className="eyebrow">СООБЩЕСТВО В ЦИФРАХ</span><h2>Статистика</h2>
      <div className="statistics-totals"><div><b>{data.people}</b><span>Участников</span></div><div><b>{data.places}</b><span>Мест</span></div></div>
      {data.sections.filter(s=>s.rows.length).map(section=><details key={section.title}><summary>{section.title}</summary><table><thead><tr><th>Значение</th><th>Кол-во</th><th>%</th></tr></thead><tbody>{section.rows.map(([label,count])=><tr key={label}><td>{label}</td><td>{count}</td><td>{section.total?Math.round(count/section.total*100):0}</td></tr>)}</tbody></table></details>)}
      {!entries.length&&<p>Записей пока нет.</p>}
      <p className="statistics-note">Автомобильная статистика учитывает только участников. Неуказанные параметры показаны отдельно.</p>
    </section>}
  </>;
}
