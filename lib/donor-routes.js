import {listPresets,savePreset,BUILTIN_PRESETS} from './import-presets.js';
import { endpoint } from './data-api.js';
import { createDonor, editDonor, getDonor, listDonors, donorDonations, addDonation,reviewDonation } from './donor-data.js';
import { previewImport, confirmImport } from './import-data.js';
import { mergeCandidates, mergeDonors } from './matching.js';
import { saveField, listFields, saveCampaign, listCampaigns } from './custom-field-data.js';
import { prepareDonationThanks } from './communication-sql.js';
import { recordOutcome } from './evidence-data.js';
import {assignmentScoped} from './donor-access.js';
import {ensure,uuid} from './data-validation.js';

const route = (permission, work, status,scope='directory') => ({ permission, status, run: ({ request, user, db }) => db.transaction(async(query) => {
  if(assignmentScoped(user)){
    ensure(permission!=='imports.manage'&&permission!=='settings.manage','Organization-wide administration requires a staff account.','FORBIDDEN',403);
    if(permission==='donors.write')ensure(scope==='donor','Organization-wide donor creation or merges require a staff account.','FORBIDDEN',403);
    let donorId=scope==='donor'?request.query?.id:null;
    if(permission==='donations.write'){
      donorId=request.body?.donor_id;
      if(!donorId&&request.query?.id)donorId=(await query('SELECT donor_id FROM donations WHERE id=$1',[uuid(request.query.id)])).rows[0]?.donor_id;
    }
    if(donorId)ensure((await query('SELECT id FROM donors WHERE id=$1 AND assigned_board_member_id=$2',[uuid(donorId),user.id])).rows.length,'This donor is outside your board assignments.','DONOR_ACCESS_DENIED',403);
    if(permission==='donors.write'&&!donorId)ensure(false,'Organization-wide donor creation or merges require a staff account.','FORBIDDEN',403);
  }
  return work(query,request,user);
}) });
export const routes = {
  presets:{GET:route('imports.manage',async(query,req)=>({builtins:BUILTIN_PRESETS,saved:await listPresets(query,req.query)})),POST:route('imports.manage',(query,req,user)=>savePreset(query,req.body,user),201)},
  donors: {
    GET: route('donors.read', (query, req,user) => listDonors(query, req.query ?? {},user)),
    POST: route('donors.write', (query, req, user) => createDonor(query, req.body, user.id), 201),
  },
  donor: {
    GET: route('donors.read', (query, req) => getDonor(query, req.query.id),undefined,'donor'),
    PATCH: route('donors.write', (query, req, user) => editDonor(query, req.query.id, req.body, user.id),undefined,'donor'),
  },
  history: { GET: route('donors.read', (query, req) => donorDonations(query, req.query.id, req.query),undefined,'donor') },
  donations: { POST: route('donations.write', async (query, req, user) => {
    const result=await addDonation(query,req.body);if(!result.duplicate)await prepareDonationThanks(query,[result.donation.id],user.id);return result;
  }, 201) },
  donation: {PATCH:route('donations.write',(query,req,user)=>reviewDonation(query,req.query.id,req.body,user))},
  outcomes: {POST:route('settings.manage',(query,req,user)=>recordOutcome(query,req.body,user),201)},
  preview: { POST: route('imports.manage', (query, req, user) => previewImport(query, req.body, user), 201) },
  confirm: { POST: route('imports.manage', (query, req, user) => confirmImport(query, req.body, user)) },
  candidates: { GET: route('donors.write', (query, req) => mergeCandidates(query, req.query ?? {})) },
  merges: { POST: route('donors.write', (query, req, user) => mergeDonors(query, req.body, user)) },
  fields: {
    GET: route('donors.read', (query, req) => listFields(query, req.query ?? {})),
    POST: route('settings.manage', (query, req) => saveField(query, req.body), 201),
  },
  field: { PATCH: route('settings.manage', (query, req) => saveField(query, req.body, req.query.id)) },
  campaigns: {
    GET: route('donors.read', (query, req) => listCampaigns(query, req.query ?? {})),
    POST: route('settings.manage', (query, req) => saveCampaign(query, req.body), 201),
  },
  campaign: { PATCH: route('settings.manage', (query, req) => saveCampaign(query, req.body, req.query.id)) },
};
export const handlerFor = (name, options) => endpoint(routes[name], options);
