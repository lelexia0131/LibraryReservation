import CryptoJS from 'crypto-js';

export interface Clock { now(): Date }
export const systemClock: Clock = { now: () => new Date() };
export const BOOKING_IV = 'ZZWBKJ_ZHIHUAWEI';

export function encryptionDate(date: Date): string {
  if (Number.isNaN(date.getTime()) || date.getFullYear() < 1000 || date.getFullYear() > 9999) throw new Error('Invalid encryption date');
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}
export function buildDailyAesKey(date: Date): string {
  const day = encryptionDate(date);
  return day + [...day].reverse().join('');
}
export function encryptBookingPayload(payload: object, date: Date = systemClock.now()): string {
  return CryptoJS.AES.encrypt(JSON.stringify(payload), CryptoJS.enc.Utf8.parse(buildDailyAesKey(date)), {
    iv: CryptoJS.enc.Utf8.parse(BOOKING_IV), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7,
  }).ciphertext.toString(CryptoJS.enc.Base64);
}
