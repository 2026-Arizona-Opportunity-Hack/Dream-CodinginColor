import { endpoint } from './data-api.js';
import { createDonor, editDonor, getDonor, listDonors, donorDonations, addDonation } from './donor-data.js';
import { previewImport, confirmImport } from './import-data.js';
import { mergeCandidates, mergeDonors } from './matching.js';
import { saveField, listFields, saveCampaign, listCampaigns } from './custom-field-data.js';

const route = (permission, work, status) => ({ permission, status, run: ({ request, user, db }) => db.transaction((query) => work(query, request, user)) });
export const routes = {
  donors: {
    GET: route('donors.read', (query, req) => listDonors(query, req.query ?? {})),
    POST: route('donors.write', (query, req) => createDonor(query, req.body), 201),
  },
  donor: {
    GET: route('donors.read', (query, req) => getDonor(query, req.query.id)),
    PATCH: route('donors.write', (query, req) => editDonor(query, req.query.id, req.body)),
  },
  history: { GET: route('donors.read', (query, req) => donorDonations(query, req.query.id, req.query)) },
  donations: { POST: route('donations.write', (query, req) => addDonation(query, req.body), 201) },
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
