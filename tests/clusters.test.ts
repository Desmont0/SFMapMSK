import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterEntries } from '../src/clusters.ts';
import { emptyParticipant, participantSchema, type PublicParticipant } from '../shared/participant.ts';

test('northern and southern markers retain full precision at every zoom and deterministic grouping',()=>{
  const entries:PublicParticipant[]=[['north',56.751234567,37.621234567],['near',56.7513,37.6213],['south',54.921234567,37.411234567]].map(([id,lat,lon])=>({...participantSchema.parse({...emptyParticipant,name:id,locationId:'moscow-137',exactLatitude:lat,exactLongitude:lon}),id:String(id),shareId:'testlink',updatedAt:'',avatar:null}));
  const groups=clusterEntries(entries,56),reverse=clusterEntries([...entries].reverse(),56);
  for(let zoom=6;zoom<=12;zoom++){
    const result=groups(zoom);assert.deepEqual(result,reverse(zoom));
    assert.equal(result.reduce((n,g)=>n+g.members.length,0),entries.length);
    for(const group of result)assert.deepEqual(group.coordinates,[group.members[0].longitude,group.members[0].latitude]);
  }
  for(let zoom=6;zoom<=12;zoom++)assert.equal(clusterEntries(entries,0)(zoom).every(g=>g.members.length===1),true);
  const exact=groups(12).flatMap(g=>g.members);assert.deepEqual(new Set(exact.map(p=>p.id)),new Set(entries.map(p=>p.id)));
});
