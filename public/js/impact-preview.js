import {esc} from './api.js';
import {displayDate,displayMoney} from './ui.js';

// Internal presentation of the existing authorized, verified-USD funder report.
// This does not publish evidence or establish donor-account ownership.
export function impactPreview(report,now=new Date()){
 if(report.currency!=='USD')throw new Error('This preview requires a verified USD giving report.');
 const today=now.toISOString().slice(0,10),year=today.slice(0,4);
 const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(+new Date(value))&&new Date(value).toISOString().slice(0,10)===value&&value<=today;
 const gifts=(report.gifts||[]).filter(g=>validDay(g.donated_at?.slice(0,10))&&Number.isFinite(g.amount)&&g.amount>0&&Number.isSafeInteger(Math.round(g.amount*100)))
  .map(g=>({date:g.donated_at.slice(0,10),amountCents:Math.round(g.amount*100),program:typeof g.program==='string'?g.program:null})).sort((a,b)=>b.date.localeCompare(a.date));
 const outcomes=(report.outcomes||[]).filter(o=>validDay(o.verified_at?.slice(0,10))&&typeof o.description==='string'&&o.description.trim()&&typeof o.evidence_reference==='string'&&o.evidence_reference.trim())
  .map(o=>({date:o.verified_at.slice(0,10),description:o.description})).sort((a,b)=>b.date.localeCompare(a.date));
 const total=rows=>rows.reduce((sum,g)=>{const next=sum+g.amountCents;if(!Number.isSafeInteger(next))throw new Error('Giving total exceeds the supported range.');return next;},0);
 return {name:report.name,gifts,outcomes,lifetimeCents:total(gifts),yearToDateCents:total(gifts.filter(g=>g.date.startsWith(year+'-'))),year,programs:[...new Set(gifts.map(g=>g.program).filter(Boolean))].sort()};
}

export function impactPreviewHtml(model){
 const money=cents=>esc(displayMoney(cents/100,'USD'));
 return `<section class="panel" aria-label="Internal donor impact preview"><h2>Donor impact preview</h2><p>Internal staff preview for ${esc(model.name)}. This evidence has not been published to a donor portal.</p><dl class="profile-details"><dt>Lifetime verified USD giving</dt><dd>${money(model.lifetimeCents)}</dd><dt>${esc(model.year)} year-to-date giving</dt><dd>${money(model.yearToDateCents)}</dd><dt>Verified gifts</dt><dd>${model.gifts.length}</dd></dl><h3>Programs recorded on gifts</h3>${model.programs.length?`<ul>${model.programs.map(p=>`<li>${esc(p)}</li>`).join('')}</ul>`:'<p>No program designation is recorded on these gifts.</p>'}<p>Gift history does not establish that a specific amount funded a specific outcome. No impact metrics have been inferred.</p><h3>Giving history</h3>${model.gifts.length?`<ol>${model.gifts.map(g=>`<li><time datetime="${esc(g.date)}">${esc(displayDate(g.date))}</time>: ${money(g.amountCents)}${g.program?' · '+esc(g.program):''}</li>`).join('')}</ol>`:'<p>No verified completed USD gifts are available.</p>'}<h3>Verified outcome evidence</h3>${model.outcomes.length?`<ol>${model.outcomes.map(o=>`<li><time datetime="${esc(o.date)}">${esc(displayDate(o.date))}</time><p>${esc(o.description)}</p></li>`).join('')}</ol>`:'<p>No verified outcome evidence is available for this donor. No impact has been inferred.</p>'}</section>`;
}
