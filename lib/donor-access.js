import {fail} from './retention-http.js';
export const assignmentScoped=actor=>(actor?.boardMember===true||actor?.roleId==='board-member')&&actor?.administrator!==true;
export function canAccessDonor(state,actor,donorId){
 return !assignmentScoped(actor)||state.assignments.some(a=>a.active&&a.donorId===donorId&&a.assigneeId===actor.id);
}
export function assertDonorAccess(state,actor,donorId){
 if(!canAccessDonor(state,actor,donorId))fail(403,'DONOR_ACCESS_DENIED','This donor is outside your board assignments.');
}
export function assertDraftAccess(state,actor,draft){
 if(!assignmentScoped(actor))return;
 if(draft.audience==='board'){if(draft.userId!==actor.id)fail(403,'DONOR_ACCESS_DENIED','This board summary belongs to another account.');}
 else assertDonorAccess(state,actor,draft.donorId);
}
