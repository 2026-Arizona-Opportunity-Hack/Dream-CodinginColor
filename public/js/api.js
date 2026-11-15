// Translate the existing CIC screens to the shared backend contracts.
export function createApiClient(fetcher = globalThis.fetch) {
  let csrfToken = null;
  const drafts = new Map(), fields = new Map(), donors = new Map();
  const uploads = new Map();
  async function raw(path, method = 'GET', body) {
    if (!['GET','HEAD'].includes(method) && path !== '/auth/login' && !csrfToken) await raw('/auth/me');
    const response = await fetcher(`/api${path}`, { method, credentials:'same-origin',
      headers:{'Content-Type':'application/json', ...(csrfToken ? {'X-CSRF-Token':csrfToken} : {})},
      body:body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.error) {
      const error = new Error(result.error?.message || `Service unavailable (${response.status}).`);
      Object.assign(error,{status:response.status,code:result.error?.code});
      if (response.status === 401) csrfToken = null;
      throw error;
    }
    if (!Object.hasOwn(result,'data')) throw new Error('The server returned an unsupported response.');
    if (result.data?.csrfToken) csrfToken = result.data.csrfToken;
    return result.data;
  }
  async function all(path) {
    const result = [];
    for (let offset=0; offset<=100000; offset+=100) {
      const page = await raw(`${path}${path.includes('?')?'&':'?'}limit=100&offset=${offset}`);
      result.push(...page);
      if (page.length < 100) return result;
    }
    throw new Error('This collection is too large to load completely. Narrow the search.');
  }
  const task = t => ({...t,title:t.nextAction,donor_id:t.donorId,due_date:t.dueAt?.slice(0,10),assignee_id:t.assigneeId});
  function fieldView(f) { return {...f,type:({boolean:'checkbox',select:'dropdown'})[f.field_type]||f.field_type,options:f.validation_rules.options||[]}; }
  async function loadFields() {
    const list = await all('/custom-fields'); list.forEach(f=>fields.set(f.id,f)); return list.map(fieldView);
  }
  return async function api(path, {method='GET',body}={}) {
    const url = new URL(path,'https://local.invalid'), p = url.pathname;
    const segments = p.split('/').filter(Boolean).map(decodeURIComponent);
    if (p === '/auth/me' || p === '/auth/login') { const result=await raw(p,method,body); return result.user; }
    if (p === '/auth/logout') { const value=await raw(p,'POST',{}); csrfToken=null; drafts.clear();donors.clear();fields.clear();uploads.clear();return value; }
    if (p === '/board-members' && method === 'GET') return (await raw('/assignments/members')).map(u=>({...u,role:u.roleId}));
    if (segments[0] === 'board-members') {
      const {role,...values}=body;
      if (!values.password) delete values.password;
      return raw('/users',method === 'POST'?'POST':'PATCH',{...values,roleId:role,boardMember:true,...(segments[1]?{id:segments[1]}:{})});
    }
    if (p === '/roles' && method === 'GET') return (await raw(p)).map(r=>({...r,name:r.id,label:r.name}));
    if (p === '/users' && method==='PATCH') {const input={...body};if(!input.password)delete input.password;return raw(p,method,input);}
    if (p === '/roles/retire') return raw(p,method,body);
    if (segments[0] === 'roles' && segments[1]) {
      const roles=await raw('/roles'), role=roles.find(r=>r.id===segments[1]);
      if (!role) throw new Error('Role no longer exists.');
      return raw('/roles','PATCH',{id:role.id,name:role.name,permissions:body.permissions});
    }
    if (p === '/custom-fields' && method === 'GET') return loadFields();
    if (segments[0] === 'custom-fields' && method !== 'GET') {
      const {type,options,...rest}=body, existing=fields.get(segments[1]);
      const field_type=existing?.field_type||({checkbox:'boolean',dropdown:'select'})[type]||type;
      const values={...rest,validation_rules:{...(existing?.validation_rules||{}),...(field_type==='select'?{options}:{})}};
      if (!segments[1]) { values.field_type=field_type;values.key=('field_'+rest.label.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')).slice(0,64); }
      return raw(p,method,values);
    }
    if (p === '/campaigns' && method === 'GET') return (await all(p)).map(c=>({...c,archived:!!c.archived_at}));
    if (p === '/donors' && method === 'GET') {
      return (await all(`/donors?q=${encodeURIComponent(url.searchParams.get('search')||'')}`))
        .map(d=>({...d,name:d.display_name,email:d.normalized_email,total_donated:d.verified_usd_total}));
    }
    if (segments[0] === 'donors' && segments[2] === 'donations') {
      if (method === 'GET') return (await all(p)).map(g=>({...g,donated_at:g.donation_date?.slice(0,10)}));
      const {donated_at,...rest}=body;
      return raw('/donations','POST',{...rest,donor_id:segments[1],donation_date:donated_at});
    }
    if (segments[0] === 'donors') {
      if (method === 'GET') {
        if (!fields.size) await loadFields();
        const d=await raw(p);donors.set(d.id,d);
        return {...d,name:d.display_name,email:d.normalized_email,
          custom_fields:Object.fromEntries([...fields.values()].map(f=>[f.id,d.custom_data[f.key]]))};
      }
      const {name,email,custom_fields,...rest}=body;
      const values={...rest,...(name!==undefined?{display_name:name}:{}),...(email!==undefined?{normalized_email:email}:{}),
        ...(method==='POST'?{donor_type:body.donor_type||'person'}:{})};
      if (custom_fields) {
        const custom_data={...(donors.get(segments[1])?.custom_data||{})};
        for (const [id,value] of Object.entries(custom_fields)) {
          const f=fields.get(id);if(!f)throw new Error('Custom fields changed. Reload the donor.');
          if(value===''||value===undefined)delete custom_data[f.key];else custom_data[f.key]=value;
        }
        // Preserve inactive values by omitting unchanged custom_data entirely.
        if (JSON.stringify(custom_data)!==JSON.stringify(donors.get(segments[1])?.custom_data||{})) values.custom_data=custom_data;
      }
      return raw(p,method,values);
    }
    if (p === '/activities') {
      if(method==='GET')return (await raw(path)).map(a=>({...a,note:a.content,created_at:a.occurredAt}));
      const {donor_id,note,type,program}=body;return raw(p,'POST',{donorId:donor_id,type:type||'note',content:note,...(program?{program}:{})});
    }
    if (p === '/tasks/reminders') return raw(p,method,body);
    if (segments[0] === 'tasks') {
      if(method==='GET'){const collection=await raw(url.searchParams.has('donorId')?`/tasks?donorId=${encodeURIComponent(url.searchParams.get('donorId'))}`:'/tasks');return (url.searchParams.get('status')==='open'?collection.filter(t=>['open','in_progress'].includes(t.status)):collection).map(task);}
      const {title,donor_id,due_date,assignee_id,...rest}=body;
      const values={...rest,...(title?{nextAction:title}:{}),...(donor_id?{donorId:donor_id}:{}),
        ...(due_date?{dueAt:`${due_date}T23:59:59.999Z`}:{}),...(assignee_id?{assigneeId:assignee_id}:{})};
      return raw('/tasks',method,{...values,...(segments[1]?{id:segments[1]}:{})});
    }
    if (p === '/outreach/drafts' && method==='GET') { const list=await raw(path);list.forEach(d=>drafts.set(d.id,d));return list; }
    if (segments[0] === 'outreach' && segments[1] === 'drafts' && segments[2]) {
      const draft=drafts.get(segments[2]);if(!draft)throw new Error('Reopen this draft before changing it.');
      return raw(segments[3]?`/outreach/${segments[3]}`:'/outreach/drafts',method,
        {id:draft.id,revision:draft.revision,...(body||{})});
    }
    if (p === '/outreach/drafts' && method==='POST') {
      if(body.type==='quarterly_board_summary')return raw('/tasks/reminders','POST',{kind:'quarterly'});
      return raw(p,'POST',{donorId:body.donor_id,templateId:body.templateId||(body.type==='thank_you'?'thank-you-email':'follow-up')});
    }
    if (p === '/outreach/history') return (await raw(path)).map(h=>({...h,subject:h.subject||'Message status update',sent_at:h.status==='sent'?h.at:null,status_label:h.providerId==='human-attested'?'Human-reported sent':h.status}));
    if (p === '/retention/at-risk' && method==='GET') return (await raw(path)).map(d=>({...d,name:d.donorName,last_gift_date:d.lastDonationAt.slice(0,10),next_action:d.reason}));
    if (p === '/merges/candidates') {
      const list=await all(p), unique=new Map();for(const pair of list){unique.set(pair.donor_id,{id:pair.donor_id,name:pair.display_name});unique.set(pair.candidate_id,{id:pair.candidate_id,name:pair.candidate_name});}return [...unique.values()];
    }
    if (p === '/merges/preview') {
      const [source,target,gifts]=await Promise.all([raw(`/donors/${encodeURIComponent(body.sourceId)}`),raw(`/donors/${encodeURIComponent(body.targetId)}`),all(`/donors/${encodeURIComponent(body.sourceId)}/donations`)]);
      return {source:source.display_name,retain:target.display_name,sourceGiftCount:gifts.length,
        warning:'All live tasks, activities and messages move to the retained donor. Opt-outs are preserved; consent is combined conservatively.'};
    }
    if (p === '/merges') return raw(p,'POST',{canonical_donor_id:body.targetId,merged_donor_id:body.sourceId,reason:body.reason||'Human-reviewed duplicate identity'});
    if (p === '/imports/preview' && body instanceof FormData) {
      const file=body.get('file');if(!file||file.size>1000000)throw new Error('Choose a CSV/XLSX file of at most 1 MB.');
      const bytes=new Uint8Array(await file.arrayBuffer());let encoded='';for(const byte of bytes)encoded+=String.fromCharCode(byte);
      const upload={filename:file.name,source:body.get('source'),content_base64:btoa(encoded)};
      const preview=await raw(p,'POST',upload);uploads.set(preview.batch_id,upload);
      return {importId:preview.batch_id,columns:preview.headers,mapping:Object.fromEntries(Object.entries(preview.mapping||{}).map(([key,index])=>[key,preview.headers[index]]))};
    }
    if (p === '/imports/preview') {
      const upload=uploads.get(body.importId);if(!upload)throw new Error('Upload this file again.');
      const aliases={name:'display_name',donated_at:'donation_date'};
      const mapping=Object.fromEntries(Object.entries(body.mapping).filter(([,v])=>v).map(([k,v])=>[aliases[k]||k,v]));
      const preview=await raw(p,'POST',{...upload,mapping,payment_review:body.payment_review||{}});
      return {...preview,importId:preview.batch_id,validRows:preview.counts.valid,
        existingTransactions:preview.rows.filter(r=>!r.errors.length&&r.matching?.reason==='existing_transaction').length,
        duplicates:preview.rows.filter(r=>r.matching?.candidates.length||r.possible_duplicate_gift),errors:preview.rows.flatMap(r=>r.errors)};
    }
    if (p === '/imports/confirm') return raw(p,'POST',{batch_id:body.importId,decisions:body.decisions||{}});
    return raw(path,method,body);
  };
}
export const api = createApiClient();
export const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const money = value => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value||0));
export const rows = data => Array.isArray(data)?data:data?.items||[];
