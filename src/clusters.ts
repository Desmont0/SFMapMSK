import Supercluster from 'supercluster';
import type { PublicParticipant } from '../shared/participant';
export function clusterEntries(entries:PublicParticipant[],radius:number) {
  const sorted=[...entries].sort((a,b)=>a.id.localeCompare(b.id));
  const index=new Supercluster<{id:string}>({radius,maxZoom:12,minPoints:2});
  const byId=new Map(sorted.map(p=>[p.id,p]));
  index.load(sorted.map(p=>({type:'Feature',properties:{id:p.id},geometry:{type:'Point',coordinates:[p.longitude,p.latitude]}})));
  return (zoom:number)=>{
    const groups=radius===0?sorted.map(p=>[p]):index.getClusters([-180,-85,180,85],zoom).map(feature=>{
      const properties=feature.properties;
      if('cluster' in properties&&properties.cluster)return index.getLeaves(properties.cluster_id,Infinity).map(f=>byId.get(f.properties.id)!).sort((a,b)=>a.id.localeCompare(b.id));
      return [byId.get((properties as {id:string}).id)!];
    });
    // Anchor groups to a real record, never quantized tile coordinates or a drifting centroid.
    return groups.map(members=>({members,coordinates:[members[0].longitude,members[0].latitude] as [number,number]}));
  };
}
