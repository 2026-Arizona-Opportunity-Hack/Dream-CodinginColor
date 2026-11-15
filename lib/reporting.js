// All financial values arrive from PostgreSQL as integer USD cents.
export class ReportError extends Error {
  constructor(status, code, message) { super(message); this.status=status; this.code=code; }
}
function date(value, name) {
  if (typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value||'') || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value) throw new ReportError(400,'INVALID_DATE',`${name} must be a valid YYYY-MM-DD date.`);
  return value;
}
export function previousYear(value) {
  const [year,month,day]=value.split('-').map(Number);
  const lastDay=new Date(Date.UTC(year-1,month,0)).getUTCDate();
  return `${String(year-1).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(Math.min(day,lastDay)).padStart(2,'0')}`;
}
export function parseFilters(query={}) {
  const from=date(query.from,'from'), to=date(query.to,'to');
  if(from>to) throw new ReportError(400,'INVALID_PERIOD','from must be on or before to.');
  if(from.slice(0,4)!==to.slice(0,4)) throw new ReportError(400,'INVALID_PERIOD','Select dates within one calendar year for year-over-year comparison.');
  const result={from,to,previousFrom:previousYear(from),previousTo:previousYear(to)};
  for(const key of ['program','boardMember']) {
    if(query[key]!==undefined && (typeof query[key]!=='string'||query[key].length>120)) throw new ReportError(400,'INVALID_FILTER',`${key} must be at most 120 characters.`);
    result[key]=query[key]||null;
  }
  return result;
}
function cents(value) {
  if(value===null || value===undefined || value==='')throw new ReportError(503,'INVALID_REPORT_DATA','Gift amount is missing.');
  const number=Number(value);
  if(!Number.isSafeInteger(number)||number<0) throw new ReportError(503,'INVALID_REPORT_DATA','Gift amounts must be nonnegative integer cents.');
  return number;
}
export function calculateRetention(gifts, filters, activityCount=0) {
  const current=new Map(), previous=new Map(), earlier=new Set(), monthly=new Map(), programs=new Map(), members=new Map();
  const safeSum=(a,b)=>{const sum=a+b;if(!Number.isSafeInteger(sum))throw new ReportError(503,'INVALID_REPORT_DATA','Gift totals exceed supported precision.');return sum;};
  const add=(map,key,amount)=>map.set(key,safeSum(map.get(key)||0,amount));
  let giftTotal=0,giftCount=0;
  for(const gift of gifts) {
    const day=String(gift.donated_at).slice(0,10);
    date(day,'gift date');
    if(!gift.donor_id) throw new ReportError(503,'INVALID_REPORT_DATA','Gift donor reference is missing.');
    if(filters.program&&gift.program!==filters.program || filters.boardMember&&String(gift.board_member_id)!==filters.boardMember) continue;
    const amount=cents(gift.amount_cents);if(!amount)continue;
    if(day<filters.previousFrom)earlier.add(gift.donor_id);
    if(day>=filters.previousFrom&&day<=filters.previousTo)add(previous,gift.donor_id,amount);
    if(day>=filters.from&&day<=filters.to) {
      add(current,gift.donor_id,amount);giftTotal=safeSum(giftTotal,amount);giftCount++;
      add(monthly,day.slice(0,7),amount);add(programs,gift.program||'',amount);add(members,String(gift.board_member_id||''),amount);
    }
    // Gifts outside last year's matched window still prove an existing relationship.
    if(day<filters.from)earlier.add(gift.donor_id);
  }
  let returning=0,increased=0,decreased=0,unchanged=0,newDonors=0,reactivated=0;
  for(const [id,total] of current) {
    if(previous.has(id)){returning++;if(total>previous.get(id))increased++;else if(total<previous.get(id))decreased++;else unchanged++;}
    else if(earlier.has(id))reactivated++;else newDonors++;
  }
  const lapsed=[...previous.keys()].filter(id=>!current.has(id)).length;
  const grouped=map=>[...map].map(([name,total])=>({name,total:total/100})).sort((a,b)=>a.name.localeCompare(b.name));
  return {...filters,currency:'USD',donorTotal:current.size,giftTotal:giftTotal/100,giftCount,activityCount,returning,new:newDonors,reactivated,increased,decreased,unchanged,lapsed,priorDonorTotal:previous.size,retentionRate:previous.size?returning/previous.size:null,churnRate:previous.size?lapsed/previous.size:null,monthly:[...monthly].sort(([a],[b])=>a.localeCompare(b)).map(([month,total])=>({month,total:total/100})),byProgram:grouped(programs),byBoardMember:grouped(members)};
}
