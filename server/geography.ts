import fs from 'node:fs';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
export const region = JSON.parse(fs.readFileSync(new URL('../public/geo/region.geojson', import.meta.url), 'utf8')) as FeatureCollection<Polygon | MultiPolygon>;
export function inRegion(latitude: number, longitude: number) { return region.features.some(f => booleanPointInPolygon([longitude, latitude], f)); }
export function requireRegion(latitude: number, longitude: number) { if (!inRegion(latitude, longitude)) throw Object.assign(new Error('Точка находится за административной границей Москвы и Московской области'), { status: 400 }); }
