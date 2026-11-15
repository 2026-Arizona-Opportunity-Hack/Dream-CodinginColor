// The shared writer lock makes this durable audit cursor safe across processes.
export const ROTATION_ACTION='assignments.auto-rotate';
export function rotationCursor(events){
 const last=events.filter(e=>e.action===ROTATION_ACTION).sort((a,b)=>Number(b.details?.sequence||0)-Number(a.details?.sequence||0))[0];
 return {lastId:last?.entityId||last?.entity_id||null,sequence:Number(last?.details?.sequence||0)+1};
}
export function leastLoadedAfter(members,load,lastId){
 if(!members.length)return null;
 const minimum=Math.min(...members.map(load)),tied=members.filter(u=>load(u)===minimum).sort((a,b)=>a.id.localeCompare(b.id));
 return tied.find(u=>lastId&&u.id>lastId)||tied[0];
}
