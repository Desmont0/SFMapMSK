import catalog from './locations.json';
export type Location = { id: string; label: string; kind: string; latitude: number; longitude: number; aliases?: string[]; name?: string; municipality?: string; settlementType?: string };
export const locations: Location[] = catalog;
export const locationById = new Map(locations.map(place => [place.id, place]));
export function normalizePlace(value: string) { return value.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^а-яa-z0-9]+/g, ' ').trim(); }
// Normalize once for the whole catalog, rather than on every keystroke.
const index = locations.map(place => ({ place, name: normalizePlace(place.name || place.label), label: normalizePlace(place.label), text: normalizePlace(place.label + ' ' + (place.aliases || []).join(' ') + ' ' + (place.settlementType || '')) }));
export function locationKindLabel(place: Location) { return place.kind === 'district' ? 'Район Москвы' : place.settlementType || (place.kind === 'city' ? 'Город' : 'Населённый пункт'); }
export function searchLocations(query: string, limit = 12) {
  const q = normalizePlace(query), tokens = q.split(/\s+/).filter(Boolean);
  return index.filter(item => tokens.every(token => item.text.includes(token))).sort((a, b) =>
    Number(b.label === q) - Number(a.label === q) || Number(b.name === q) - Number(a.name === q) ||
    Number(b.name.startsWith(q)) - Number(a.name.startsWith(q)) || a.place.label.localeCompare(b.place.label, 'ru')
  ).slice(0, limit).map(item => item.place);
}
