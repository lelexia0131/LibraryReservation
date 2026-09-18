import type { LibraryApp, PublicAuthStatus, QueryResult, Reply } from '../electron/contracts.js';

declare global { interface Window { libraryApp: LibraryApp } }
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = byId<HTMLFormElement>('query-form');
const fields = byId<HTMLFieldSetElement>('query-fields');
const authButton = byId<HTMLButtonElement>('auth-button');
const webButton = byId<HTMLButtonElement>('website-button');
const queryButton = byId<HTMLButtonElement>('query-button');
const notice = byId('notice');
let state: PublicAuthStatus['state'] = 'UNKNOWN';
let busy = false;
let polling = false;
const now = new Date();
byId<HTMLInputElement>('targetDate').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

function updateControls(): void {
  const checking = ['UNKNOWN', 'CHECKING', 'SILENT_REFRESH', 'AUTHENTICATING'].includes(state);
  authButton.disabled = busy || checking;
  webButton.disabled = busy || checking;
  queryButton.disabled = busy || checking;
  fields.disabled = busy;
  authButton.textContent = state === 'AUTHENTICATED' ? '退出' : '登录';
}
function showAuth(status: PublicAuthStatus): void {
  state = status.state;
  const labels: Record<typeof state, [string, string]> = {
    UNKNOWN: ['正在检查', 'pending'], CHECKING: ['正在检查', 'pending'], SILENT_REFRESH: ['正在检查', 'pending'],
    AUTHENTICATING: ['正在登录', 'pending'], AUTHENTICATED: ['已登录', 'success'],
    LOGIN_REQUIRED: ['未登录', ''], FAILED: ['登录失败', 'failed'],
  };
  const [label, style] = labels[state];
  byId('auth-status').textContent = label;
  byId('auth-status').className = `badge ${style}`;
  updateControls();
}
function showNotice(message: string): void { notice.textContent = message; notice.hidden = !message; }
async function refreshStatus(): Promise<void> {
  if (polling) return;
  polling = true;
  try { const result = await window.libraryApp.getAuthStatus(); if (result.ok) showAuth(result.value); else showNotice(result.error.message); }
  catch { showNotice('无法连接应用，请重新打开。'); }
  finally { polling = false; }
}
async function run<T>(work: () => Promise<Reply<T>>, success: (value: T) => void): Promise<void> {
  if (busy) return;
  busy = true; showNotice(''); updateControls();
  try { const result = await work(); if (result.ok) success(result.value); else showNotice(result.error.message); }
  catch { showNotice('操作未完成，请重新打开应用后重试。'); }
  finally { busy = false; await refreshStatus(); updateControls(); }
}
authButton.addEventListener('click', () => {
  const logout = state === 'AUTHENTICATED';
  void run(() => logout ? window.libraryApp.logout() : window.libraryApp.login(), status => {
    showAuth(status); if (logout) resetResult();
  });
});
webButton.addEventListener('click', () => { void run(() => window.libraryApp.openBookingWebsite(), () => {}); });
function resetResult(): void {
  byId('result-details').hidden = true; byId('result-badge').hidden = true;
  byId('empty-result').hidden = false; byId('empty-title').textContent = '选择座位与时段，开始查询';
}
function showResult(result: QueryResult): void {
  byId('empty-result').hidden = true; byId('result-details').hidden = false;
  const badge = byId('result-badge'); badge.hidden = false;
  badge.textContent = result.available ? '空闲' : '不可用';
  badge.className = `badge ${result.available ? 'success' : 'warning'}`;
  byId('result-seat').textContent = result.seat;
  byId('result-area').textContent = result.area;
  byId('result-period').textContent = `${result.day}　${result.startTime} – ${result.endTime}`;
}
form.addEventListener('input', () => {
  byId('form-error').textContent = '';
  form.querySelectorAll('[aria-invalid]').forEach(input => input.removeAttribute('aria-invalid'));
  resetResult();
});
form.addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  const input = Object.fromEntries(new FormData(form)) as unknown as Parameters<LibraryApp['runDryBooking']>[0];
  let invalid: [string, string] | undefined;
  if (!input.targetDate || !byId<HTMLInputElement>('targetDate').validity.valid) invalid = ['targetDate', '请选择有效的查询日期。'];
  else if (!input.targetSeat.trim()) invalid = ['targetSeat', '请填写座位号。'];
  else if (!input.startTime || !input.endTime || input.startTime >= input.endTime) invalid = ['endTime', '结束时间必须晚于开始时间。'];
  if (invalid) {
    byId('form-error').textContent = invalid[1]; byId(invalid[0]).setAttribute('aria-invalid', 'true'); byId(invalid[0]).focus(); return;
  }
  if (state !== 'AUTHENTICATED') { showNotice('请先登录浙江大学账号。'); authButton.focus(); return; }
  resetResult(); byId('empty-title').textContent = '正在查询座位…';
  byId('result').setAttribute('aria-busy', 'true');
  byId('query-button-label').textContent = '查询中';
  document.querySelector<HTMLElement>('.spinner')!.hidden = false;
  await run(() => window.libraryApp.runDryBooking(input), showResult);
  if (!byId('empty-result').hidden) byId('empty-title').textContent = '查询未完成，请检查后重试';
  byId('result').setAttribute('aria-busy', 'false'); byId('query-button-label').textContent = '测试查询';
  document.querySelector<HTMLElement>('.spinner')!.hidden = true;
});
void refreshStatus();
setInterval(() => { void refreshStatus(); }, 1000);
