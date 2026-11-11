import { z } from 'zod';
import { locationById } from './locations.ts';
const text = (max: number) => z.string().trim().max(max).default('');
export const participantSchema = z.object({
  name: z.string().trim().min(1, 'Укажите имя').max(80),
  telegram: z.string().trim().regex(/^https:\/\/t\.me\/[a-zA-Z][a-zA-Z0-9_]{3,31}\/?$/, 'Нужна ссылка https://t.me/username').transform(v => v.endsWith('/') ? v.slice(0, -1) : v),
  locationId: z.string().refine(id => locationById.has(id), 'Выберите район или город из списка'),
  plate: text(24), color: text(40), year: text(4).refine(v => !v || (/^\d{4}$/.test(v) && +v >= 1900 && +v <= new Date().getFullYear() + 1), 'Проверьте год'),
  generation: z.enum(['', 'Рест', 'Дорест']).default(''),
  engine: text(20), transmission: z.enum(['', 'МКПП', 'АКПП', 'Робот', 'Вариатор']).default(''),
  aspiration: z.enum(['', 'Атмо', 'Турбо']).default(''), steering: z.enum(['', 'Левый', 'Правый']).default(''),
  comment: text(1000), adminComment: text(2000),
}).transform(value => {
  const place = locationById.get(value.locationId)!;
  return { ...value, city: place.label, latitude: place.latitude, longitude: place.longitude };
});
export type ParticipantInput = z.infer<typeof participantSchema>;
export type Participant = ParticipantInput & { id: string; updatedAt: string; revision: string };
export type AvatarState = { status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'; checkedAt: number | null };
export type PublicParticipant = Omit<Participant, 'telegram' | 'adminComment' | 'revision'> & { avatar: string | null };
export const fields = ['id','name','telegram','city','plate','color','year','generation','engine','transmission','aspiration','steering','comment','latitude','longitude','adminComment','updatedAt','locationId'] as const;
export const fieldLabels: Record<string, string> = { id: 'ID', name: 'Имя', telegram: 'Telegram', city: 'Город', plate: 'Госномер', color: 'Цвет', year: 'Год выпуска', generation: 'Поколение', engine: 'Объём двигателя', transmission: 'КПП', aspiration: 'Атмо / турбо', steering: 'Руль', comment: 'Комментарий для карты', latitude: 'Широта', longitude: 'Долгота', adminComment: 'Комментарий администратора', updatedAt: 'Изменено' };
export function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map(v => v[0]).join('').toUpperCase(); }
fieldLabels.locationId = 'Район или город';
export const emptyParticipant: ParticipantInput = { name: '', telegram: '', locationId: '', city: '', plate: '', color: '', year: '', generation: '', engine: '', transmission: '', aspiration: '', steering: '', comment: '', adminComment: '', latitude: 0, longitude: 0 };
