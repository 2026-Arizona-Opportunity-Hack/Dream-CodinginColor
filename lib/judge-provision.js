import {migrate} from './database-setup.js';
import {createSqlStore} from './retention-sql-store.js';
import {bootstrapAdministrator,saveRole,saveUser,validatePassword} from './auth.js';
import {provisioningDiagnostic} from './judge-diagnostics.js';
import {createDonor,addDonation} from './donor-data.js';
import {saveCampaign} from './custom-field-data.js';
import {recordOutcome} from './evidence-data.js';
import {prepareDonationThanks} from './communication-sql.js';
import {DataError} from './data-validation.js';
export const JUDGE_PERMISSIONS=Object.freeze(['donors.read','donors.write','donations.write','imports.manage','assignments.manage','activities.write','tasks.manage','outreach.write','outreach.approve','reports.read','settings.manage']);
export async function provisionJudgeDatabase(database,configuration,accounts,now=new Date()){
 let stage='accounts.validate',queryError;
 try{
 if(!accounts?.operator||!Array.isArray(accounts.judges)||accounts.judges.length<1||accounts.judges.length>10||!Array.isArray(accounts.boards)||accounts.boards.length!==3)throw new DataError('INVALID_JUDGE_ACCOUNTS','Provide an operator, one to ten judges, and three synthetic board accounts.');
 const all=[accounts.operator,...accounts.judges,...accounts.boards];
 const stages=['accounts.operator',...accounts.judges.map((_,i)=>`accounts.judge.${i+1}`),...accounts.boards.map((_,i)=>`accounts.board.${i+1}`)];
 for(const [i,account]of all.entries()){
  stage=stages[i];
  try{validatePassword(account.password);if(account.password.length<20)throw new Error();}catch{throw new DataError('JUDGE_PASSWORD_POLICY','Private password fails the required policy.');}
  if(typeof account.email!=='string'||typeof account.name!=='string')throw new DataError('INVALID_JUDGE_ACCOUNTS','Required private account fields are missing.');
 }
 stage='accounts.uniqueness';
 if(new Set(all.map(a=>a.email.toLowerCase())).size!==all.length||new Set(all.map(a=>a.password)).size!==all.length||all.some(a=>a.password.length<20))throw new DataError('INVALID_JUDGE_ACCOUNTS','Use unique account emails and unique private passwords of at least 20 characters.');
 stage='database.transaction';
 return await database.transaction(async rawQuery=>{
  const query=async(sql,params)=>{try{return await rawQuery(sql,params);}catch(error){queryError=error;throw error;}};
  stage='database.empty-check';
  await query('SELECT pg_advisory_xact_lock(78234901)');
  const tables=await query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
  if(tables.rows.length)throw new DataError('JUDGE_DATABASE_NOT_EMPTY','Provisioning requires a brand-new empty database. No existing records were changed.',409);
  stage='database.migrations';await migrate(query);
  stage='database.identity-marker';
  await query('CREATE TABLE colorloop_judge_environment(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),environment_id uuid NOT NULL,mfa_key_sha256 text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())');
  await query('INSERT INTO colorloop_judge_environment(singleton,environment_id,mfa_key_sha256) VALUES (true,$1,$2)',[configuration.environmentId,configuration.mfaFingerprint]);
  const store=createSqlStore({transaction:work=>work(query)});
  stage='accounts.operator';const operator={...await bootstrapAdministrator(store,accounts.operator,now),administrator:true};
  stage='accounts.role';const role=await saveRole(store,operator,{name:'Judge Demo reviewer',permissions:[...JUDGE_PERMISSIONS]},now);
  for(const [i,account]of accounts.judges.entries()){stage=`accounts.judge.${i+1}`;await saveUser(store,operator,{...account,roleId:role.id,boardMember:false},now);}
  for(const [i,account]of accounts.boards.entries()){stage=`accounts.board.${i+1}`;await saveUser(store,operator,{...account,roleId:'board-member',boardMember:true},now);}
  stage='seed.campaigns';
  const campaigns=[];
  for(const name of ['Synthetic Digital Skills','Synthetic AI Education','Synthetic Mentor Program'])campaigns.push(await saveCampaign(query,{name}));
  const names=['Maya Hernandez','Jordan Ellis','Sofia Patel','Evan Brooks','Avery Chen','Leila Morgan','Noah Rivera','Opportunity Hack (Synthetic)'];
  const gifts=[];const year=now.getUTCFullYear();
  for(const [index,name]of names.entries()){
   stage='seed.donors';
   const donor=await createDonor(query,{donor_type:index===7?'organization':'person',display_name:name,normalized_email:`synthetic-donor-${index+1}@colorloop.invalid`,phone:`202-555-01${String(index).padStart(2,'0')}`,email_consent:true,...(index===7?{organization_name:'Synthetic Opportunity Hack'}:{})},operator.id);
   const periods=index===4?[year-1]:index<2?[year-1,year]:[year];
   stage='seed.gifts';for(const period of periods){const gift=await addDonation(query,{donor_id:donor.id,amount:String(50+index*25),donation_date:`${period}-01-01`,source:'judge-demo',external_transaction_id:`${configuration.environmentId}:${index}:${period}`,currency:'USD',status:'completed',campaign_id:campaigns[index%3].id,program:campaigns[index%3].name});gifts.push(gift.donation.id);}
   stage='seed.outcomes';if(index===0)await recordOutcome(query,{donor_id:donor.id,description:'SYNTHETIC DEMO: introductory coding workshop completed. This is fictional evidence, not an actual CIC impact claim.',evidence_reference:'Synthetic Judge Demo fixture only',verified_at:`${year}-01-01`,period_start:`${year}-01-01`,period_end:`${year}-01-01`,program:campaigns[0].name},operator);
  }
  stage='seed.thank-you-drafts';await prepareDonationThanks(query,gifts,operator.id,now);
  stage='database.commit';
  return {donors:names.length,gifts:gifts.length,campaigns:campaigns.length,judges:accounts.judges.length,boardMembers:3};
 });
 }catch(error){error.provisionDiagnostic=provisioningDiagnostic(queryError||error,stage);throw error;}
}
