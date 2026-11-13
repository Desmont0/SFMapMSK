import fs from 'node:fs/promises';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import type { Feature, FeatureCollection, Polygon, MultiPolygon, Point, Position } from 'geojson';
import { region, inRegion } from '../server/geography.ts';
import type { Location } from '../shared/locations.ts';

// Input: osmtogeojson export of place nodes/polygons and complete level-6
// municipalities from the Moscow Oblast extract. No runtime network access.
const source = process.argv[2];
if (!source) throw new Error('Usage: node --import tsx scripts/import-settlements.ts <osm-places.geojson>');
type Tags = Record<string, string>;
type Area = Feature<Polygon | MultiPolygon, { tags: Tags; tainted?: boolean }>;
type SourceFeature = Feature<Point | Polygon | MultiPolygon, Area['properties']>;
const input = JSON.parse(await fs.readFile(source, 'utf8')) as FeatureCollection;
const oblast = region.features.find(f => f.properties?.shapeISO === 'RU-MOS')!;
const norm = (value: string) => value.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^а-яa-z0-9]+/g, ' ').trim();
const supported = new Set(['city', 'town', 'village', 'hamlet', 'isolated_dwelling']);
const features = input.features.filter(f => ['Point', 'Polygon', 'MultiPolygon'].includes(f.geometry.type)).map(f => ({ ...f, properties: { tags: f.properties?.tags || f.properties || {}, tainted: f.properties?.tainted } })) as SourceFeature[];
function validArea(f: SourceFeature): f is Area {
  if (f.properties.tainted || f.geometry.type === 'Point') return false;
  const rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat();
  return rings.length > 0 && rings.every(r => r.length >= 4 && r[0][0] === r.at(-1)![0] && r[0][1] === r.at(-1)![1]);
}
const districts = features.filter(f => f.properties.tags.admin_level === '6' && f.properties.tags['addr:region'] === 'Московская область').filter(validArea);
const placeFeatures = features.filter(f => supported.has(f.properties.tags.place) && (f.properties.tags['name:ru'] || f.properties.tags.name));
const nameOf = (f: SourceFeature) => (f.properties.tags['name:ru'] || f.properties.tags.name).trim();
const points = placeFeatures.filter(f => f.geometry.type === 'Point');
const pointNames = new Map<string, SourceFeature[]>();
for (const p of points) { const key = norm(nameOf(p)); const group = pointNames.get(key) || []; group.push(p); pointNames.set(key, group); }
function centre(f: SourceFeature): Position {
  if (f.geometry.type === 'Point') return f.geometry.coordinates;
  const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const ring = [...polygons].sort((a, b) => b[0].length - a[0].length)[0][0];
  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
  const left = Math.min(...xs), right = Math.max(...xs), bottom = Math.min(...ys), top = Math.max(...ys);
  const middle = [(left + right) / 2, (bottom + top) / 2];
  if (booleanPointInPolygon(middle, f as Area)) return middle;
  const candidates = Array.from({ length: 361 }, (_, i) => [left + (right - left) * ((i % 19) + 1) / 20, bottom + (top - bottom) * (Math.floor(i / 19) + 1) / 20]);
  return candidates.sort((a, b) => Math.hypot(a[0] - middle[0], a[1] - middle[1]) - Math.hypot(b[0] - middle[0], b[1] - middle[1])).find(p => booleanPointInPolygon(p, f as Area)) || ring[0];
}
const candidates = [...points];
let polygonOnly = 0;
for (const f of placeFeatures.filter(validArea)) {
  const names = [nameOf(f), ...(f.properties.tags.alt_name || '').split(';')].map(norm);
  if (names.some(name => pointNames.get(name)?.some(p => booleanPointInPolygon(centre(p), f)))) continue;
  const point = centre(f);
  if (!booleanPointInPolygon(point, oblast)) continue;
  // Relations and outer ways can describe the same village.
  if (candidates.some(p => names.includes(norm(nameOf(p))) && booleanPointInPolygon(centre(p), f))) continue;
  candidates.push(f); polygonOnly++;
}
const previous = JSON.parse(await fs.readFile('shared/locations.json', 'utf8')) as Location[];
const original = previous.filter(p => !p.id.startsWith('osm-'));
const additions: Location[] = [];
let duplicateCities = 0;
for (const f of candidates) {
  const tags = f.properties.tags, name = nameOf(f), [lon, lat] = centre(f);
  if (!booleanPointInPolygon([lon, lat], oblast)) continue;
  const status = (tags.official_status || '').replace(/^ru:/, '');
  if ((status === 'город' || ['city', 'town'].includes(tags.place)) && original.some(p => p.kind === 'city' && norm(p.label) === norm(name) && Math.hypot(p.latitude - lat, (p.longitude - lon) * .56) < .08)) { duplicateCities++; continue; }
  const district = districts.find(d => booleanPointInPolygon([lon, lat], d));
  if (!district) throw new Error('No municipality for ' + name + ' (' + f.id + ')');
  const municipality = district.properties.tags.name;
  const aliases = [...new Set((tags.alt_name || '').split(';').map(a => a.trim()).filter(a => a && norm(a) !== norm(name)))];
  const latitude = +lat.toFixed(5), longitude = +lon.toFixed(5);
  const point: Location = { id: 'osm-' + String(f.id).replace('/', '-'), label: name + ', ' + municipality, name, kind: 'settlement', municipality, settlementType: status || 'Населённый пункт', latitude, longitude, ...(aliases.length ? { aliases } : {}) };
  if (!inRegion(latitude, longitude)) throw new Error('Outside region after rounding: ' + name);
  additions.push(point);
}
// Nearby place names distinguish namesakes within the same municipality.
const labels = new Map<string, Location[]>();
for (const p of additions) { const key = norm(p.label); const group = labels.get(key) || []; group.push(p); labels.set(key, group); }
for (const group of labels.values()) if (group.length > 1) {
  const used = new Set<string>();
  for (const p of group) {
    const neighbours = additions.filter(n => n.municipality === p.municipality && norm(n.name!) !== norm(p.name!)).sort((a, b) => Math.hypot(a.latitude - p.latitude, (a.longitude - p.longitude) * .56) - Math.hypot(b.latitude - p.latitude, (b.longitude - p.longitude) * .56));
    const neighbour = neighbours.find(n => !used.has(norm(n.name!)));
    if (!neighbour) throw new Error('Cannot distinguish ' + p.label);
    used.add(norm(neighbour.name!)); p.label += ' (рядом с ' + neighbour.name + ')';
  }
}
const places = [...original, ...additions].sort((a, b) => a.label.localeCompare(b.label, 'ru'));
if (new Set(places.map(p => p.id)).size !== places.length) throw new Error('Duplicate location IDs');
if (new Set(places.map(p => norm(p.label))).size !== places.length) throw new Error('Duplicate location labels');
if (additions.length < 5800) throw new Error('Incomplete source: fewer than 5800 additions');
await fs.writeFile('shared/locations.json', JSON.stringify(places, null, 2) + String.fromCharCode(10));
console.log(JSON.stringify({ original: original.length, added: additions.length, total: places.length, polygonOnly, duplicateCities, municipalities: districts.length, sameNameWithinMunicipality: [...labels.values()].filter(g => g.length > 1).length }, null, 2));
