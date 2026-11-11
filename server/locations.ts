import boundaries from './location-boundaries.json';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import { locations, normalizePlace } from '../shared/locations.ts';
import { inRegion } from './geography.ts';

// Only legacy storage imports use coordinates. New writes require a catalog ID.
export function migrateLocation<T extends { city?: string; locationId?: string; latitude?: unknown; longitude?: unknown }>(record: T) {
  if (record.locationId) return record as T & { locationId: string };
  const city = normalizePlace(record.city || '').replace(/^(г|город) /, '');
  const exact = locations.find(p => normalizePlace(p.label) === city || p.aliases?.some(a => normalizePlace(a) === city));
  if (exact) return { ...record, locationId: exact.id } as T & { locationId: string };
  const lat = Number(String(record.latitude).replace(',', '.')), lon = Number(String(record.longitude).replace(',', '.'));
  if (city === 'москва' && Number.isFinite(lat) && Number.isFinite(lon) && inRegion(lat, lon)) {
    const district = boundaries.features.find(f => booleanPointInPolygon([lon, lat], f as Feature<Polygon | MultiPolygon>));
    if (district) return { ...record, locationId: district.properties.locationId } as T & { locationId: string };
    // Zelenograd and New Moscow have common city/district reference points.
    const nearest = locations.filter(p => p.label.startsWith('Москва,') || ['Зеленоград','Троицк','Щербинка'].includes(p.label)).sort((a, b) =>
      Math.hypot(a.latitude - lat, (a.longitude - lon) * .56) - Math.hypot(b.latitude - lat, (b.longitude - lon) * .56))[0];
    if (nearest) return { ...record, locationId: nearest.id } as T & { locationId: string };
  }
  return { ...record, locationId: '' } as T & { locationId: string };
}
