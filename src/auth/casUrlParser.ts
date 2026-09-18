export const BOOKING_ORIGIN = 'https://booking.lib.zju.edu.cn';
export const CAS_LOGIN_URL = `${BOOKING_ORIGIN}/api/cas/cas`;
export const CAS_PARTITION = 'persist:zju-booking-auth';

export function isBookingUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === BOOKING_ORIGIN && !url.username && !url.password;
  } catch { return false; }
}

// Extraction and credential validation are separate: short parser examples are valid URLs.
export function extractCasFromUrl(value: string): string | null {
  if (!isBookingUrl(value)) return null;
  const url = new URL(value);
  const query = url.searchParams.get('cas');
  const hash = url.hash.indexOf('?');
  return query || (hash >= 0 ? new URLSearchParams(url.hash.slice(hash + 1)).get('cas') : null) || null;
}

export function isCasLoginUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === 'https://zjuam.zju.edu.cn' && url.pathname === '/cas/login' && !url.username && !url.password;
  } catch { return false; }
}
