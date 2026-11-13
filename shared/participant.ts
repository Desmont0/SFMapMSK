import { z } from 'zod';
import { locationById } from './locations.ts';
const text = (max: number) => z.string().trim().max(max).default('');
export const kindLabels = { person: 'Участник', garage: 'Гараж', service: 'Сервис', meetup: 'Место встречи' } as const;
export type EntryKind = keyof typeof kindLabels;
export const kindIcons: Record<EntryKind, string> = { person: '', garage: '⌂', service: '⚒', meetup: '⚑' };
export const participantSchema = z.object({
  kind: z.enum(['person', 'garage', 'service', 'meetup']).default('person'),
  name: z.string().trim().min(1, 'Укажите имя или название').max(80),
  telegram: z.string().trim().regex(new RegExp('^(?:https://t[.]me/[a-zA-Z][a-zA-Z0-9_]{3,31}/?|)$'), 'Нужна ссылка https://t.me/username').default('').transform(v => v.endsWith('/') ? v.slice(0, -1) : v),
  locationId: z.string().refine(id => locationById.has(id), 'Выберите район или город из списка'),
  address: text(240),
  ownerId: text(80),
  exactLatitude: z.number().min(-90).max(90).nullable().default(null),
  exactLongitude: z.number().min(-180).max(180).nullable().default(null),
  // Output coordinates are always derived below; only exact* fields accept user coordinates.
  latitude: z.unknown().transform(() => 0), longitude: z.unknown().transform(() => 0),
  plate: text(24), color: text(40), year: text(4).refine(v => !v || (/^\d{4}$/.test(v) && +v >= 1900 && +v <= new Date().getFullYear() + 1), 'Проверьте год'),
  sunroof: z.enum(['Да', 'Нет']).default('Нет'),
  engine: text(20), transmission: z.enum(['', 'МКПП', 'АКПП']).default(''),
  aspiration: z.enum(['', 'Атмо', 'Турбо']).default(''), market: z.enum(['', 'JDM', 'USDM', 'EDM']).default(''),
  comment: text(1000), adminComment: text(2000),
}).superRefine((value, ctx) => {
  if ((value.exactLatitude === null) !== (value.exactLongitude === null)) ctx.addIssue({code:'custom',path:['exactLatitude'],message:'Укажите обе точные координаты или оставьте оба поля пустыми'});
}).transform(value => {
  const place = locationById.get(value.locationId)!;
  return { ...value, city: place.label, latitude: value.exactLatitude ?? place.latitude, longitude: value.exactLongitude ?? place.longitude,
    ...(value.kind !== 'person' ? {plate:'',color:'',year:'',sunroof:'Нет' as const,engine:'',transmission:'' as const,aspiration:'' as const,market:'' as const} : {address:''}),
    ownerId: value.kind === 'garage' ? value.ownerId : '',
  };
});
// Read old records without inventing a market from the steering wheel side.
export function storedParticipant(input: Record<string, unknown>) {
  const legacyPoint = input.kind && input.kind !== 'person' && !('exactLatitude' in input);
  return participantSchema.parse({...input,
    transmission: ['Робот','Вариатор'].includes(String(input.transmission)) ? '' : input.transmission,
    ...(legacyPoint ? {exactLatitude: input.latitude ?? null, exactLongitude: input.longitude ?? null} : {}),
  });
}
export type ParticipantInput = z.infer<typeof participantSchema>;
export type Participant = ParticipantInput & { id: string; shareId: string; updatedAt: string; revision: string };
export type PublicParticipant = Omit<Participant, 'telegram' | 'adminComment' | 'revision' | 'exactLatitude' | 'exactLongitude'> & { avatar: string | null; owner?: {name:string;shareId:string} | null };
export const fields = ['id','shareId','kind','name','telegram','city','address','ownerId','plate','color','year','sunroof','engine','transmission','aspiration','market','comment','latitude','longitude','exactLatitude','exactLongitude','adminComment','updatedAt','locationId'] as const;
export const fieldLabels: Record<string, string> = { id:'ID', shareId:'Короткая ссылка', kind:'Тип записи', name:'Имя / название', telegram:'Telegram', city:'Город', address:'Адрес', ownerId:'Владелец гаража (ID)', plate:'Госномер', color:'Цвет', year:'Год выпуска', sunroof:'Люкатый', engine:'Объём двигателя', transmission:'КПП', aspiration:'Атмо / турбо', market:'Рынок', comment:'Комментарий для карты', latitude:'Широта', longitude:'Долгота', exactLatitude:'Точная широта', exactLongitude:'Точная долгота', adminComment:'Комментарий администратора', updatedAt:'Изменено', locationId:'Район или город' };
export function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map(v => v[0]).join('').toUpperCase(); }
export const emptyParticipant: ParticipantInput = { kind:'person', name:'', telegram:'', locationId:'', city:'', address:'', ownerId:'', exactLatitude:null, exactLongitude:null, plate:'', color:'', year:'', sunroof:'Нет', engine:'', transmission:'', aspiration:'', market:'', comment:'', adminComment:'', latitude:0, longitude:0 };
