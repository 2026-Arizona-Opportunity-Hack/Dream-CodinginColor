// Mapping stays editable; request-level source is the stable transaction namespace.
export async function renderImports(root,{api,esc}) {
  root.innerHTML+='<section class="panel"><h2>Import giving history</h2><p>Upload CSV or XLSX. Review mapped fields, payment information and donor ownership before confirming. Phoenix local dates are supported.</p><form id="upload"><label>Source<input name="source" list="sources" value="generic" required></label><datalist id="sources"><option value="generic"><option value="zeffy"><option value="benevity"></datalist><label>Spreadsheet<input type="file" name="file" accept=".csv,.xlsx" required></label><button class="primary">Upload and inspect</button></form><div id="preview" aria-live="polite"></div></section>';
  const target=root.querySelector('#preview');
  root.querySelector('#upload').onsubmit=async event=>{
    event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
    try{
      const [upload,fields]=await Promise.all([api('/imports/preview',{method:'POST',body:new FormData(event.target)}),api('/custom-fields')]);
      const targets=['donor_type','first_name','last_name','display_name','email','secondary_email','phone','company','amount','donation_date','currency','status','campaign','campaign_id','board_contact','program','external_transaction_id','source_donor_id',...fields.filter(f=>f.active!==false).map(f=>`custom:${f.key}`)];
      const choices=(name,label,options)=>`<label>${esc(label)}<select name="${esc(name)}">${options.map(([v,t])=>`<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select></label>`;
      target.innerHTML='<h3>Review column mapping</h3><p>Fields left unmapped are not imported. Benevity exports can use any explicitly selected column names.</p><form id="mapping">'+targets.map(key=>choices(key,key,[['','Not mapped'],...upload.columns.map(c=>[c,c])])).join('')+'<fieldset><legend>Review missing payment information</legend><p>Choose verified values only when supported by the source. These choices fill missing cells only.</p><label>Verified currency for missing cells<input name="review_currency" maxlength="3" pattern="[A-Z]{3}" placeholder="Leave unknown"></label>'+choices('review_status','Verified payment status for missing cells',[['','Leave unknown'],...['completed','pending','refunded','voided'].map(v=>[v,v])])+'<label><span><input type="checkbox" name="keep_unknown"> I reviewed missing payment values and will retain any remaining unknowns. These gifts are excluded from verified reports and thank-yous.</span></label></fieldset><button>Validate mapping</button></form><div id="validated"></div>';
      const form=target.querySelector('#mapping');
      for(const [key,column] of Object.entries(upload.mapping||{}))if(form.elements.namedItem(key))form.elements.namedItem(key).value=column;
      form.onsubmit=async event=>{
        event.preventDefault();const output=target.querySelector('#validated');output.textContent='Validating…';
        try{
          const values=Object.fromEntries(new FormData(form));
          const mapping=Object.fromEntries(targets.filter(k=>values[k]).map(k=>[k,values[k]]));
          const payment_review={...(values.review_currency?{currency:values.review_currency}:{}),...(values.review_status?{status:values.review_status}:{}),keep_unknown:values.keep_unknown==='on'};
          const preview=await api('/imports/preview',{method:'POST',body:{importId:upload.importId,mapping,payment_review}});
          output.innerHTML=`<h3>Review before confirming</h3><p>${esc(preview.validRows)} valid rows · ${esc(preview.existingTransactions)} existing transactions · ${esc(preview.errors.length)} errors</p><pre>${esc(JSON.stringify(preview.rows,null,2))}</pre>`;
          if(preview.errors.length)return;
          const decisions=document.createElement('form');
          for(const row of preview.rows){
            if(row.matching?.candidates.length)decisions.insertAdjacentHTML('beforeend',choices(`donor:${row.row_number}`,`Row ${row.row_number}: donor identity`,[['','Use unambiguous match'],...row.matching.candidates.map(id=>[id,id]),['new','Create a distinct donor']]));
            if(row.possible_duplicate_gift)decisions.insertAdjacentHTML('beforeend',`<label><span><input type="checkbox" name="duplicate:${row.row_number}"> Row ${row.row_number}: I verified this amount/date match is a distinct gift</span></label>`);
            if(row.data.board_contact)decisions.insertAdjacentHTML('beforeend',choices(`owner:${row.row_number}`,`Row ${row.row_number}: review imported contact ${row.data.board_contact}`,[['','Choose ownership decision'],...(row.board_candidates||[]).map(u=>[u.id,`${u.name} (${u.email})`]),['balanced','Keep existing owner / use balanced assignment']]));
          }
          decisions.insertAdjacentHTML('beforeend','<button class="primary">Confirm reviewed import</button>');output.append(decisions);
          decisions.onsubmit=async event=>{
            event.preventDefault();const button=decisions.querySelector('button');button.disabled=true;
            try{
              const chosen=Object.fromEntries(new FormData(decisions)),review={};
              for(const row of preview.rows){
                const donor=chosen[`donor:${row.row_number}`],owner=chosen[`owner:${row.row_number}`];
                if(row.data.board_contact&&!owner)throw new Error(`Review ownership for row ${row.row_number}.`);
                review[row.row_number]={...(donor?{donor_id:donor}:{}),...(chosen[`duplicate:${row.row_number}`]?{allow_possible_duplicate:true}:{}),...(owner==='balanced'?{use_balanced_assignment:true}:owner?{assignee_id:owner}:{})};
              }
              const result=await api('/imports/confirm',{method:'POST',body:{importId:preview.importId,decisions:review}});
              output.innerHTML=`<h3>Import confirmed</h3><p>Existing transaction IDs reuse their original gifts. New verified gifts prepare thank-you drafts; no messages are sent.</p><pre>${esc(JSON.stringify(result.rows,null,2))}</pre>`;
            }catch(error){output.querySelector('[role=alert]')?.remove();const p=document.createElement('p');p.setAttribute('role','alert');p.textContent=error.message;output.append(p);button.disabled=false;}
          };
        }catch(error){output.textContent=error.message;}
      };
    }catch(error){target.textContent=error.message;}finally{button.disabled=false;}
  };
}
