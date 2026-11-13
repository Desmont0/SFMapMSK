import fs from 'node:fs/promises';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { inRegion } from '../server/geography.ts';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import type { Location } from '../shared/locations.ts';

// Rebuild the local place catalog from attributed public reference data.
const districtUrl = 'https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/moscow.geojson';
const cityUrl = 'https://raw.githubusercontent.com/hflabs/city/master/city.csv';
async function source(file: string, url: string) {
  try { return await fs.readFile(file, 'utf8'); } catch {
    const response = await fetch(url); if (!response.ok) throw new Error(url + ': ' + response.status);
    const body = await response.text(); await fs.mkdir('data', { recursive: true }); await fs.writeFile(file, body); return body;
  }
}
function csv(text: string) {
  const rows: string[][] = []; let row: string[] = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === ',' || c === '\n')) { row.push(value.replace(/\r$/, '')); value = ''; if (c === '\n') { rows.push(row); row = []; } }
    else value += c;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  return rows.slice(1).map(row => Object.fromEntries(rows[0].map((key, i) => [key, row[i] || ''])));
}
type Place = Location;
const places: Place[] = [];
const boundaries: FeatureCollection<Polygon | MultiPolygon> = { type: 'FeatureCollection', features: [] };
const districts = JSON.parse(await source('data/location-districts-source.json', districtUrl)) as FeatureCollection<Polygon | MultiPolygon>;
for (const feature of districts.features) {
  const name = String(feature.properties!.name).replace(/^район /, '').replace(/ район$/, '');
  if (['Матушкино', 'Силино', 'Старое Крюково', 'Крюково', 'Савёлки'].includes(name)) continue;
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  const ring = [...polygons].sort((a, b) => b[0].length - a[0].length)[0][0];
  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
  const left = Math.min(...xs), right = Math.max(...xs), bottom = Math.min(...ys), top = Math.max(...ys);
  let point = [(left + right) / 2, (bottom + top) / 2];
  if (!booleanPointInPolygon(point, feature)) {
    const candidates = Array.from({ length: 81 }, (_, i) => [left + (right - left) * ((i % 9) + 1) / 10, bottom + (top - bottom) * (Math.floor(i / 9) + 1) / 10]);
    point = candidates.sort((a, b) => Math.hypot(a[0] - point[0], a[1] - point[1]) - Math.hypot(b[0] - point[0], b[1] - point[1])).find(p => booleanPointInPolygon(p, feature)) || ring[0];
  }
  const id = 'moscow-' + String(feature.properties!.cartodb_id);
  places.push({ id, label: 'Москва, ' + name, kind: 'district', latitude: +point[1].toFixed(5), longitude: +point[0].toFixed(5) });
  boundaries.features.push({ ...feature, properties: { locationId: id } });
}
// New Moscow after the 2024 reform; these are illustrative district centers.
for (const [name, latitude, longitude] of [
  ['Бекасово', 55.434, 36.805], ['Вороново', 55.322, 37.155], ['Коммунарка', 55.569, 37.489],
  ['Краснопахорский', 55.432, 37.273], ['Филимонковский', 55.557, 37.347],
] as const) places.push({ id: 'new-moscow-' + name, label: 'Москва, ' + name, kind: 'district', latitude, longitude });
places.push({ id: 'city-zelenograd', label: 'Зеленоград', kind: 'city', latitude: 55.9825, longitude: 37.1814, aliases: ['Москва Зеленоград', 'Матушкино', 'Силино', 'Старое Крюково', 'Крюково', 'Савелки'] });
places.push({ id: 'city-troitsk', label: 'Троицк', kind: 'city', latitude: 55.484, longitude: 37.305, aliases: ['Москва Троицк'] });
places.push({ id: 'city-shcherbinka', label: 'Щербинка', kind: 'city', latitude: 55.5097, longitude: 37.5597, aliases: ['Москва Щербинка'] });
for (const row of csv(await source('data/location-cities-source.csv', cityUrl))) {
  if (row.region !== 'Московская') continue;
  const label = row.city_type === 'г' ? row.city : !row.city && row.area_type === 'г' ? row.area : '';
  if (!label || places.some(p => p.label === label)) continue;
  places.push({ id: 'city-' + row.fias_id, label, kind: 'city', latitude: +Number(row.geo_lat).toFixed(5), longitude: +Number(row.geo_lon).toFixed(5) });
}
// Rebuilding legacy sources must not erase the imported settlements.
const saved = JSON.parse(await fs.readFile('shared/locations.json', 'utf8')) as Location[];
for (const place of saved) if (place.id.startsWith('osm-')) places.push(place);
places.sort((a, b) => a.label.localeCompare(b.label, 'ru'));
for (const p of places) if (!inRegion(p.latitude, p.longitude)) throw new Error('Outside region: ' + p.label);
await fs.writeFile('shared/locations.json', JSON.stringify(places, null, 2) + '\n');
await fs.writeFile('server/location-boundaries.json', JSON.stringify(boundaries));
console.log('Locations:', places.length, 'districts:', places.filter(p => p.kind === 'district').length, 'cities:', places.filter(p => p.kind === 'city').length);
