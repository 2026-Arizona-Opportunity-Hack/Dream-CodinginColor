import { check } from './retention-http.js';

export const iso = value => value instanceof Date ? value.toISOString() : value;
export function decimalToCents(value) {
  check(typeof value === 'string' && /^\d{1,10}\.\d{2}$/.test(value), 'A fixed two-decimal donation amount is required.');
  const [whole, fraction] = value.split('.');
  const result = Number(BigInt(whole) * 100n + BigInt(fraction));
  check(Number.isSafeInteger(result), 'Donation amount exceeds supported precision.');
  return result;
}
export function donorToRetention(row) {
  return { id: row.id, name: row.display_name, email: row.normalized_email, phone: row.phone,
    active: row.archived_at === null, optedOut: row.opted_out === true,
    contactPreferences: { email: row.email_consent === true, sms: row.sms_consent === true } };
}
export function donationToRetention(row) {
  return { id: row.id, donorId: row.donor_id, amountCents: decimalToCents(row.amount),
    donatedAt: String(iso(row.donation_date)).slice(0, 10), currency: row.currency, status: row.status };
}
