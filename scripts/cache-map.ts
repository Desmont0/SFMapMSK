import { warmMapCache } from '../server/map-cache.ts';
const status=await warmMapCache();
console.log(JSON.stringify(status,null,2));
if(!status.ready)process.exitCode=1;
