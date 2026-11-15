import { loadRetentionState,persistRetentionState } from './retention-sql-store.js';
import { prepareThankYou } from './outreach.js';

// Caller holds the shared lock and database transaction; imports load state once.
export async function prepareDonationThanks(query,donationIds,actorId,now=new Date()) {
  if(!donationIds.length||!actorId)return;
  const before=await loadRetentionState(query),next=structuredClone(before);
  for(const id of donationIds)prepareThankYou(next,id,actorId,now);
  await persistRetentionState(query,before,next);
}
