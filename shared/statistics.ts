import { kindLabels } from './entry.ts';
import type { PublicParticipant } from './participant.ts';
export function statistics(entries: PublicParticipant[]) {
  const people=entries.filter(p=>p.kind==='person');
  const counts=(values:string[])=>Object.entries(values.reduce<Record<string,number>>((result,value)=>{const key=value.trim()||'Не указано';result[key]=(result[key]||0)+1;return result;},{})).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'ru'));
  return {
    people:people.length,places:entries.length-people.length,
    sections:[
      {title:'Точки на карте',total:entries.length-people.length,rows:counts(entries.filter(p=>p.kind!=='person').map(p=>kindLabels[p.kind]))},
      ...([['city','Районы и населённые пункты'],['year','Год выпуска'],['color','Цвет'],['engine','Двигатель, л'],['transmission','КПП'],['aspiration','Атмо / турбо'],['market','Рынок'],['sunroof','Люкатый']] as const).map(([key,title])=>({title,total:people.length,rows:counts(people.map(p=>p[key]))})),
    ],
  };
}
