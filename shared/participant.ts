import { z } from 'zod';
import { locationById } from './locations.ts';
const text = (max: number) => z.string().trim().max(max).default('');
export const kindLabels = { person: 'Участник', garage: 'Гараж', service: 'Сервис', meetup: 'Место встречи' } as const;
export type EntryKind = keyof typeof kindLabels;
export const kindIcons: Record<EntryKind, string> = { person: '', garage: '⌂', service: '⚒', meetup: '⚑' };
export const participantSchema = z.preprocess(input => {
  if (input && typeof input === 'object' && (!('kind' in input) || input.kind === 'person')) {
    return {...input, latitude:0, longitude:0};
  }
  return input;
}, z.object({
  kind: z.enum(['person', 'garage', 'service', 'meetup']).default('person'),
  name: z.string().trim().min(1, 'Укажите имя или название').max(80),
  telegram: z.string().trim().regex(new RegExp('^(?:https://t[.]me/[a-zA-Z][a-zA-Z0-9_]{3,31}/?|)$'), 'Нужна ссылка https://t.me/username').default('').transform(v => v.endsWith('/') ? v.slice(0, -1) : v),
  locationId: z.string().refine(id => locationById.has(id), 'Выберите район или город из списка'),
  address: text(240),
  latitude: z.number().min(-90).max(90).default(0), longitude: z.number().min(-180).max(180).default(0),
  plate: text(24), color: text(40), year: text(4).refine(v => !v || (/^\d{4}$/.test(v) && +v >= 1900 && +v <= new Date().getFullYear() + 1), 'Проверьте год'),
  sunroof: z.enum(['Да', 'Нет']).default('Нет'),
  engine: text(20), transmission: z.enum(['', 'МКПП', 'АКПП', 'Робот', 'Вариатор']).default(''),
  aspiration: z.enum(['', 'Атмо', 'Турбо']).default(''), steering: z.enum(['', 'Левый', 'Правый']).default(''),
  comment: text(1000), adminComment: text(2000),
}).superRefine((value, ctx) => {
  if (value.kind !== 'person' && ((value.latitude === 0) !== (value.longitude === 0))) ctx.addIssue({code:'custom',path:['latitude'],message:'Укажите обе координаты или оставьте обе равными 0'});
}).transform(value => {
  const place = locationById.get(value.locationId)!;
  const point = value.kind !== 'person' && value.latitude !== 0 && value.longitude !== 0;
  return { ...value, city: place.label, latitude: point ? value.latitude : place.latitude, longitude: point ? value.longitude : place.longitude,
    ...(value.kind !== 'person' ? {plate:'',color:'',year:'',sunroof:'Нет' as const,engine:'',transmission:'' as const,aspiration:'' as const,steering:'' as const} : {address:''}),
  };
}));
export type ParticipantInput = z.infer<typeof participantSchema>;
export type Participant = ParticipantInput & { id: string; shareId: string; updatedAt: string; revision: string };
export type PublicParticipant = Omit<Participant, 'telegram' | 'adminComment' | 'revision'> & { avatar: string | null };
export const fields = ['id','shareId','kind','name','telegram','city','address','plate','color','year','sunroof','engine','transmission','aspiration','steering','comment','latitude','longitude','adminComment','updatedAt','locationId'] as const;
export const fieldLabels: Record<string, string> = { id:'ID', shareId:'Короткая ссылка', kind:'Тип записи', name:'Имя / название', telegram:'Telegram', city:'Город', address:'Адрес', plate:'Госномер', color:'Цвет', year:'Год выпуска', sunroof:'Люкатый', engine:'Объём двигателя', transmission:'КПП', aspiration:'Атмо / турбо', steering:'Руль', comment:'Комментарий для карты', latitude:'Широта', longitude:'Долгота', adminComment:'Комментарий администратора', updatedAt:'Изменено', locationId:'Район или город' };
export function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map(v => v[0]).join('').toUpperCase(); }
export const emptyParticipant: ParticipantInput = { kind:'person', name:'', telegram:'', locationId:'', city:'', address:'', plate:'', color:'', year:'', sunroof:'Нет', engine:'', transmission:'', aspiration:'', steering:'', comment:'', adminComment:'', latitude:0, longitude:0 };
