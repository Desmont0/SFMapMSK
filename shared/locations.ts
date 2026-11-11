import catalog from './locations.json';
export type Location = { id: string; label: string; kind: string; latitude: number; longitude: number; aliases?: string[] };
export const locations: Location[] = catalog;
export const locationById = new Map(locations.map(place => [place.id, place]));
export function normalizePlace(value: string) { return value.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^а-яa-z0-9]+/g, ' ').trim(); }
export function searchLocations(query: string, limit = 12) {
  const tokens = normalizePlace(query).split(/\s+/).filter(Boolean);
  return locations.filter(place => {
    const text = normalizePlace(place.label + ' ' + (place.aliases || []).join(' '));
    return tokens.every(token => text.includes(token));
  }).sort((a, b) => {
    const q = normalizePlace(query);
    return Number(normalizePlace(b.label) === q) - Number(normalizePlace(a.label) === q) || a.label.localeCompare(b.label, 'ru');
  }).slice(0, limit);
}
