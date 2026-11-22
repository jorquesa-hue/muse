/* Muse — shared helpers for the Vercel functions in api/ (files starting with "_" are not routes). */
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { cityIndex } from '../scripts/events.mjs';

export const SB = 'https://esviqajfbkdnpoohjpjt.supabase.co';
export const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzdmlxYWpmYmtkbnBvb2hqcGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4NzM1NzgsImV4cCI6MjA5OTQ0OTU3OH0.0C0oBrs0OjrcvxNdDVXeBtBs8KTVmgviGJkWffkFKj4'; // public, same as app.js
export const cellOf = (lat, lng) => `${Math.floor(lat * 2)}_${Math.floor(lng * 2)}`; // 0.5° ≈ 55 km

export function haversine(aLat, aLng, bLat, bLng) {
  const R = 6371, r = Math.PI / 180;
  const h = Math.sin((bLat - aLat) * r / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin((bLng - aLng) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

let CITIES = null;
export async function cities() {
  if (!CITIES) {
    const data = JSON.parse(await readFile(new URL('../cities.json', import.meta.url), 'utf8'));
    CITIES = { data, idx: cityIndex(data), list: data.c.map(([name, uf, lat, lng]) => ({ name, uf, lat, lng })) };
  }
  return CITIES;
}

export const hash = (s) => createHash('sha256').update(String(process.env.MUSE_FN_SECRET) + '|' + s).digest('hex').slice(0, 32);
export async function rpc(fn, args) {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_secret: process.env.MUSE_FN_SECRET, ...args }),
  });
  if (!r.ok) throw new Error(`supabase ${fn} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
export const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export const randomToken = () => randomBytes(24).toString('base64url');
export const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
export function sameSecret(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}
export const clientIp = (request) => (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
export const SITE = process.env.SITE_URL || 'https://muse-find.com';
export const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Transactional e-mail through Resend (RESEND_API_KEY, MAIL_FROM). Returns false when not configured.
export async function sendMail({ to, subject, html, text }) {
  if (!process.env.RESEND_API_KEY) return false;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM || 'Muse <eventos@muse-find.com>', to: [to], subject, html, text }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return true;
}
