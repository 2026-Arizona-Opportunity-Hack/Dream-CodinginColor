import { date, ensure } from './data-validation.js';

// Excel date cells represent wall-calendar values, not Phoenix UTC instants.
export function importDate(value) {
  if (value instanceof Date) return date(value.toISOString().slice(0,10));
  if (typeof value !== 'string') return date(value);
  const input=value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return date(input);
  const local=/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM))?$/i.exec(input);
  if(local){
    if(local[4]) ensure(+local[4]>=1&&+local[4]<=12&&+local[5]<=59&&+(local[6]||0)<=59,'Invalid Phoenix local time.');
    return date(`${local[3]}-${local[1].padStart(2,'0')}-${local[2].padStart(2,'0')}`);
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(input)) {
    date(input.slice(0,10));
    const instant=new Date(input);ensure(Number.isFinite(+instant),'Invalid timestamp.');
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Phoenix',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(instant).map(p=>[p.type,p.value]));
    return date(`${parts.year}-${parts.month}-${parts.day}`);
  }
  ensure(false,'Use an ISO date or Phoenix month/day/year date.');
}
