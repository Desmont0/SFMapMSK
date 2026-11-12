import { useState } from 'react';
import { initials, kindIcons, kindLabels, type PublicParticipant } from '../shared/participant';
export const avatarHue = (name: string) => Array.from(name || 'Участник').reduce((n,c) => n + c.charCodeAt(0), 0) % 36 + 190;
export function Avatar({participant, large=false}: {participant: Pick<PublicParticipant,'name'|'avatar'|'kind'>; large?:boolean}) {
  return <span className={'avatar kind-'+participant.kind+' ' + (large ? 'large' : '')} style={{['--avatar-hue' as string]: String(avatarHue(participant.name))}}>{participant.avatar ? <img key={participant.avatar} src={participant.avatar} alt="" onError={e => {e.currentTarget.style.display='none';}}/> : null}<span>{kindIcons[participant.kind] || initials(participant.name || 'Участник')}</span></span>;
}
export function Card({participant:p, onClose, preview=false}: {participant:PublicParticipant;onClose?:()=>void;preview?:boolean}) {
  const [shareStatus,setShareStatus]=useState(''),[shareFallback,setShareFallback]=useState('');
  async function share() {
    const url=new URL('/p/'+p.shareId,location.origin).href;
    try {
      if(navigator.share){await navigator.share({title:p.name,url});setShareStatus('Ссылка отправлена');}
      else if(navigator.clipboard){await navigator.clipboard.writeText(url);setShareStatus('Ссылка скопирована');}
      else {setShareFallback(url);setShareStatus('Скопируйте ссылку');}
    } catch(error) {if((error as Error).name!=='AbortError'){setShareFallback(url);setShareStatus('Скопируйте ссылку');}}
  }
  const specs = p.kind==='person' ? [p.year && p.year + ' г.','Люкатый: '+p.sunroof,p.color,p.engine && p.engine + ' л',p.transmission,p.aspiration,p.steering && p.steering + ' руль'].filter(Boolean) : [];
  return <article className={'participant-card kind-'+p.kind+' ' + (preview ? 'preview' : 'shareable')} aria-label={kindLabels[p.kind]+' '+p.name}>
    {!preview&&<button className="share-button" onClick={()=>void share()} aria-label="Поделиться" title="Поделиться ссылкой"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4m-6.8 7 6.8 4"/></svg></button>}
    {onClose && <button className="close" onClick={onClose} aria-label="Закрыть карточку">×</button>}
    <div className="card-person"><Avatar participant={p} large/><div><span className="eyebrow">{p.kind==='person'?'СВОИ НА КАРТЕ':kindLabels[p.kind].toUpperCase()}</span><h2>{p.name || 'Имя / название'}</h2><p className="city"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/></svg>{p.city || 'Город'}</p></div></div>
    {shareStatus&&<p className="share-status" role="status">{shareStatus}</p>}
    {shareFallback&&<input className="share-url" aria-label="Ссылка на карточку" readOnly value={shareFallback} onFocus={e=>e.target.select()}/>}
    {p.avatar&&<img className="card-photo" key={p.avatar} src={p.avatar} alt={'Фото: '+p.name} onError={e=>{e.currentTarget.style.display='none';}}/>}
    {p.kind!=='person'&&p.address&&<p className="public-comment">{p.address}</p>}
    {p.plate && <div className="plate"><span>{p.plate}</span><small>RUS <i/></small></div>}
    {specs.length > 0 && <div className="specs">{specs.map((s,i)=><span key={i}>{s}</span>)}</div>}
    {p.comment && <p className="public-comment">{p.comment}</p>}
  </article>;
}
