// Shared form policy, also exercised in the real Chrome smoke test.
export function accountRoleOptions(roles, boardMember = false) {
  const sorted=[...roles].sort((a,b)=>a.name.localeCompare(b.name));
  if (boardMember) sorted.sort((a,b)=>(a.name==='board-member'?-1:0)-(b.name==='board-member'?-1:0));
  const options=sorted.map(r=>[r.name,r.label||r.name]);
  return boardMember && sorted.some(r=>r.name==='board-member') ? options : [['','Choose a role explicitly'],...options];
}
export function administratorGrant(body, roleField, confirm) {
  if (!body[roleField]) throw new Error('Choose an account role.');
  if (body[roleField] !== 'administrator') return body;
  if (!confirm('Grant administrator access? This account can manage users, roles, settings and donor data.')) {
    throw new Error('Administrator access was not granted.');
  }
  return {...body,confirmAdministrator:true};
}
