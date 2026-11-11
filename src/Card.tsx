import { initials, type PublicParticipant } from '../shared/participant';
export const avatarHue = (name: string) => Array.from(name || 'Участник').reduce((n,c) => n + c.charCodeAt(0), 0) % 36 + 190;
export function Avatar({participant, large=false}: {participant: Pick<PublicParticipant,'name'|'avatar'>; large?:boolean}) {
  return <span className={'avatar ' + (large ? 'large' : '')} style={{['--avatar-hue' as string]: String(avatarHue(participant.name))}}>{participant.avatar ? <img key={participant.avatar} src={participant.avatar} alt="" onError={e => {e.currentTarget.style.display='none';}}/> : null}<span>{initials(participant.name || 'Участник')}</span></span>;
}
export function Card({participant:p, onClose, preview=false}: {participant:PublicParticipant;onClose?:()=>void;preview?:boolean}) {
  const specs = [p.year && p.year + ' г.',p.generation && 'Поколение: ' + p.generation,p.color,p.engine && p.engine + ' л',p.transmission,p.aspiration,p.steering && p.steering + ' руль'].filter(Boolean);
  return <article className={'participant-card ' + (preview ? 'preview' : '')} aria-label={'Участник ' + p.name}>
    {onClose && <button className="close" onClick={onClose} aria-label="Закрыть карточку">×</button>}
    <div className="card-person"><Avatar participant={p} large/><div><span className="eyebrow">СВОИ НА КАРТЕ</span><h2>{p.name || 'Имя участника'}</h2><p className="city"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/></svg>{p.city || 'Город'}</p></div></div>
    {p.plate && <div className="plate"><span>{p.plate}</span><small>RUS <i/></small></div>}
    {specs.length > 0 && <div className="specs">{specs.map((s,i)=><span key={i}>{s}</span>)}</div>}
    {p.comment && <p className="public-comment">{p.comment}</p>}
  </article>;
}
