import { test } from 'node:test';
import assert from 'node:assert/strict';
import { participantSchema, emptyParticipant } from '../shared/participant.ts';
import { inRegion, region } from '../server/geography.ts';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { locations, searchLocations, locationById } from '../shared/locations.ts';
import { matchesPlate } from '../shared/plate.ts';
import { migrateLocation } from '../server/locations.ts';
import { isIpAllowed } from '../server/config.ts';
test('administrative geography includes Moscow, New Moscow, Zelenograd and oblast; excludes neighbouring regions', () => {
  for (const [name, lat, lon] of [['Moscow',55.7558,37.6173],['Troitsk',55.485,37.305],['Zelenograd',55.982,37.181],['Kolomna',55.093,38.768],['Serpukhov',54.917,37.415]] as const) assert.equal(inRegion(lat,lon),true,name);
  for (const [lat,lon] of [[56.858,35.9],[54.514,36.261],[59.93,30.31],[0,0]]) assert.equal(inRegion(lat,lon),false);
  const border = region.features[1].geometry.type === 'Polygon' ? region.features[1].geometry.coordinates[0][0] : region.features[1].geometry.coordinates[0][0][0];
  assert.equal(inRegion(border[1],border[0]),true,'a point on the saved administrative boundary is allowed');
  assert.equal(region.features.some(f => booleanPointInPolygon([37.181,55.982],f)),true);
});
test('catalog autocomplete, whole cities, legacy migration and shared district positions', () => {
  assert.equal(searchLocations('Москва, Яс')[0].label,'Москва, Ясенево');
  assert.equal(searchLocations('москва ясен')[0].id,'moscow-137');
  assert.equal(searchLocations('Королев')[0].label,'Королёв');
  assert.deepEqual(searchLocations('Зеленоград').map(p=>p.label),['Зеленоград']);
  assert.equal(searchLocations('Крюково')[0].label,'Зеленоград');
  assert.equal(new Set(locations.map(p=>p.id)).size,locations.length);
  assert.ok(locations.length>180);
  for(const p of locations) assert.equal(inRegion(p.latitude,p.longitude),true,p.label);
  const legacy=migrateLocation({city:'Москва',latitude:55.76,longitude:37.57});
  assert.equal(locationById.get(legacy.locationId!)?.kind,'district');
  assert.equal(migrateLocation({city:'Зеленоград',latitude:55.99,longitude:37.2}).locationId,'city-zelenograd');
  assert.equal(migrateLocation({city:'Несуществующий город',latitude:55.76,longitude:37.57}).locationId,'');
  assert.equal(migrateLocation({city:'Москва',latitude:59.93,longitude:30.31}).locationId,'');
});
test('plate search accepts partial numbers, digits, separators and matching keyboard alphabets', () => {
  for(const query of ['777','77','а777','A777AA','аа 777','A 777 AА-777']) assert.equal(matchesPlate('А777АА 777',query),true,query);
  assert.equal(matchesPlate('М034ММ 799','034'),true);
  assert.equal(matchesPlate('М034ММ 799','M034M'),true);
  for(const query of ['', '  - ', '000', 'A034']) assert.equal(matchesPlate('М034ММ 799',query),false,query);
});
test('remote admin allowlist accepts only the configured address', () => {
  const allowlist = ['203.0.113.10'];
  assert.equal(isIpAllowed('203.0.113.10', allowlist), true);
  assert.equal(isIpAllowed('::ffff:203.0.113.10', allowlist), true);
  assert.equal(isIpAllowed('203.0.113.11', allowlist), false);
  assert.equal(isIpAllowed('127.0.0.1', allowlist), false);
  assert.equal(isIpAllowed(undefined, allowlist), false);
  assert.equal(isIpAllowed('127.0.0.1', []), true);
});
test('validation preserves text fields, normalizes Telegram and rejects missing or hostile URLs', () => {
  const input={...emptyParticipant,locationId:'moscow-137',name:'  Тест  ',city:'Москва',telegram:'https://t.me/sfmap_test/',plate:'00123',phone:'+7 000 000-00-00',comment:'<img src=x onerror=alert(1)>'};
  const parsed=participantSchema.parse(input);
  assert.equal('phone' in parsed,false,'legacy phone input is discarded');
  assert.equal(parsed.telegram,'https://t.me/sfmap_test'); assert.equal(parsed.plate,'00123'); assert.equal(parsed.name,'Тест'); assert.equal(parsed.comment,input.comment);
  for (const telegram of ['https://t.me.evil.test/user','javascript:alert(1)','https://t.me/user?redirect=x','http://t.me/user','https://t.me/@user']) assert.equal(participantSchema.safeParse({...input,telegram}).success,false);
  assert.equal(parsed.city,'Москва, Ясенево');
  assert.equal(participantSchema.parse({...input,latitude:NaN,longitude:30}).latitude,55.61563,'coordinates are derived from catalog');
  assert.equal(participantSchema.safeParse({...input,locationId:''}).success,false);
  assert.equal(participantSchema.safeParse({...input,locationId:'unknown'}).success,false);
  assert.equal(participantSchema.safeParse({...input,name:''}).success,false);
});
