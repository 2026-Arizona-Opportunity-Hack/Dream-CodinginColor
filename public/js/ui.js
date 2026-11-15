export function donorChoices(donors,query=''){
 const search=query.trim().toLowerCase();
 const label=d=>[d.name||d.display_name||'Unnamed donor',d.email||d.normalized_email||'No email',d.company].filter(Boolean).join(', ');
 const counts=new Map();for(const donor of donors)counts.set(label(donor),(counts.get(label(donor))||0)+1);
 return donors.filter(d=>[d.name,d.display_name,d.email,d.normalized_email].some(v=>String(v||'').toLowerCase().includes(search))).map(d=>({id:d.id,label:label(d)+(counts.get(label(d))>1?`, record ${d.id}`:'')}));
}
export function mountDonorSelector(parent,donors){
 const container=document.createElement('div');container.className='donor-selector';
 container.innerHTML='<label for="follow-up-search">Search donors by name or email<input id="follow-up-search" type="search" autocomplete="off" aria-describedby="donor-choice-help"></label><label for="follow-up-donor">Donor<select id="follow-up-donor" name="donor_id" size="5" required aria-describedby="donor-choice-help"></select></label><p id="donor-choice-help" class="muted" role="status"></p>';
 parent.prepend(container);const search=container.querySelector('input'),select=container.querySelector('select'),status=container.querySelector('[role=status]');
 const update=()=>{const selected=select.value,options=donorChoices(donors,search.value);select.replaceChildren(new Option('Choose a donor',''),...options.map(d=>new Option(d.label,d.id)));if(options.some(d=>d.id===selected))select.value=selected;status.textContent=options.length?`${options.length} matching donors. Choose one from the Donor list.`:donors.length?'No donors match. Try another name or email.':'No donors available to your account. Add or assign a donor first.';};
 search.oninput=update;update();search.focus();
}
export function displayDate(value,timeZone='America/Phoenix'){
 if(!value)return 'Not recorded';const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(value),date=new Date(dateOnly?`${value}T12:00:00Z`:value);if(!Number.isFinite(+date))return 'Date unavailable';
 return new Intl.DateTimeFormat('en-US',{dateStyle:'medium',...(dateOnly?{timeZone:'UTC'}:{timeStyle:'short',timeZone})}).format(date);
}
export function displayMoney(value,currency){
 if(value===null||value===undefined||value==='')return 'Amount unavailable';
 if(!Number.isFinite(Number(value)))return 'Amount unavailable';
 if(!currency)return `${Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} (currency unknown)`;
 try{return new Intl.NumberFormat('en-US',{style:'currency',currency}).format(Number(value));}catch{return `${Number(value).toFixed(2)} ${currency}`;}
}
export const timeOrder=value=>{const timestamp=Date.parse(value);return Number.isFinite(timestamp)?timestamp:-Infinity;};
