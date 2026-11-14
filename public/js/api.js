export async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', headers: body instanceof FormData ? {} : { 'Content-Type': 'application/json' }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error) throw new Error(result.error?.message || `Service unavailable (${response.status}). Please try again after the backend is connected.`);
  if (!Object.hasOwn(result, 'data')) throw new Error('The server returned an unsupported response.');
  return result.data;
}
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export const money = value => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' }).format(Number(value || 0));
export const rows = data => Array.isArray(data) ? data : data?.items || [];
