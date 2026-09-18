import { scryptAsync } from '@noble/hashes/scrypt.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

const params = { N: 32768, r: 8, p: 3, dkLen: 32, maxmem: 64 * 1024 * 1024 };
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await scryptAsync(password, salt, params);
  return `scrypt$v1$32768$8$3$${bytesToHex(salt)}$${bytesToHex(key)}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const fields = encoded.split('$');
  if (fields.length !== 7 || fields.slice(0, 5).join('$') !== 'scrypt$v1$32768$8$3' ||
      !/^[a-f0-9]{32}$/.test(fields[5]) || !/^[a-f0-9]{64}$/.test(fields[6])) return false;
  const actual = await scryptAsync(password, hexToBytes(fields[5]), params);
  const expected = hexToBytes(fields[6]);
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expected[i];
  return difference === 0;
}
export async function sha256(value: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}
export function newToken(): string { return bytesToHex(crypto.getRandomValues(new Uint8Array(32))); }
export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (!email) return null;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('请输入有效邮箱');
  return email;
}
export function normalizePhone(value: string): string | null {
  const phone = value.replace(/[\s()-]/g, '');
  if (!phone) return null;
  if (/^1[3-9]\d{9}$/.test(phone)) return `+86${phone}`;
  if (/^\+[1-9]\d{7,14}$/.test(phone)) return phone;
  throw new Error('请输入中国大陆手机号或带国家区号的手机号');
}
export function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 6 && value.length <= 128;
}
export interface PermissionUser { role: string; vip_level: number | null; vip_expires_at: string | null }
export function canAccess(user: PermissionUser, required: number, now = Date.now()): boolean {
  return user.role === 'ADMIN' || (user.vip_level !== null && user.vip_level >= required &&
    (user.vip_expires_at === null || Date.parse(user.vip_expires_at) > now));
}
export function expiryForBeijingDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期格式错误');
  const parsed = new Date(`${date}T00:00:00+08:00`);
  if (!Number.isFinite(parsed.getTime()) || new Date(parsed.getTime() + 8 * 3600000).toISOString().slice(0,10) !== date) throw new Error('日期无效');
  return new Date(parsed.getTime() + 86400000).toISOString();
}
export function parseRange(header: string, size: number): { offset: number; length: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size <= 0) return null;
  let start: number, end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null;
    end = Math.min(end, size - 1);
  }
  return { offset: start, length: end - start + 1 };
}
