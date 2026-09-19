import type { LibraryApp, PublicAuthStatus, Reply, Period, Location, LocationView, Scope, AutoMode, AutoView, ReservationView } from '../electron/contracts.js';

declare global { interface Window { libraryApp: LibraryApp } }
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const authButton = byId<HTMLButtonElement>('auth-button');
const scopeChoices = new Map<string, Scope>();
let authState: PublicAuthStatus['state'] = 'UNKNOWN';
let loadedForSession = false;
let busy = false, polling = false, needsLoad = false, stopped = false;
let auto: AutoView = { state: 'IDLE', message: '等待开始' };
let selected: { location: Location; no: string } | undefined;
let lastAutoResult = '';
const active = () => ['SCANNING', 'WAITING', 'FOUND', 'RESERVING'].includes(auto.state);
const now = new Date();
byId<HTMLInputElement>('day').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const period = (): Period => ({ day: byId<HTMLInputElement>('day').value, startTime: byId<HTMLInputElement>('startTime').value, endTime: byId<HTMLInputElement>('endTime').value });
const key = (scope: Scope): string => JSON.stringify(scope);
function notice(message: string): void { byId('notice').textContent = message; byId('notice').hidden = !message; }
function controls(): void {
  const loggedIn = authState === 'AUTHENTICATED';
  const checking = ['UNKNOWN', 'CHECKING', 'SILENT_REFRESH', 'AUTHENTICATING'].includes(authState);
  authButton.disabled = busy || checking;
  authButton.textContent = loggedIn ? '退出' : '登录';
  byId<HTMLFieldSetElement>('period-fields').disabled = busy || active();
  byId<HTMLButtonElement>('refresh-button').disabled = busy || active() || !loggedIn;
  byId<HTMLButtonElement>('reserve-button').disabled = busy || active() || !loggedIn || !selected;
  document.querySelectorAll<HTMLButtonElement>('.start').forEach(button => {
    button.disabled = busy || !loggedIn || (active() && auto.mode === button.dataset.mode)
      || (button.dataset.mode === 'custom' && scopeChoices.size === 0);
  });
  document.querySelectorAll<HTMLButtonElement>('.stop').forEach(button => { button.hidden = !(active() && auto.mode === button.dataset.mode); });
  document.querySelectorAll<HTMLInputElement>('#scopes input').forEach(input => { input.disabled = busy || active(); });
  document.querySelectorAll<HTMLButtonElement>('.region,.seat').forEach(button => { button.disabled = busy || active() || !loggedIn; });
}
function showAuth(status: PublicAuthStatus): void {
  authState = status.state;
  const labels: Record<typeof authState, string> = { UNKNOWN: '正在检查', CHECKING: '正在检查', SILENT_REFRESH: '正在检查', AUTHENTICATING: '正在登录', AUTHENTICATED: '已登录', LOGIN_REQUIRED: '未登录', FAILED: '登录失败' };
  byId('auth-status').textContent = labels[authState];
  byId('auth-status').className = `badge ${authState === 'AUTHENTICATED' ? 'success' : 'pending'}`;
  if (['LOGIN_REQUIRED', 'FAILED'].includes(authState)) loadedForSession = false;
  if (authState === 'AUTHENTICATED' && !loadedForSession) { loadedForSession = true; needsLoad = true; }
  controls();
}
function clearSelection(): void {
  selected = undefined; byId('selection').hidden = true; byId('seats').replaceChildren(); byId('seat-count').textContent = '';
  byId('seat-hint').textContent = '展开位置，查看空闲座位';
}
function showResult(result: ReservationView): void {
  byId('result-empty').hidden = true; byId('result-details').hidden = false; byId('result-message').hidden = true;
  byId('result-badge').hidden = false; byId('result-badge').textContent = result.success ? '预约成功' : '预约失败';
  byId('result-badge').className = `badge ${result.success ? 'success' : 'failed'}`;
  byId('result-seat').textContent = result.seat; byId('result-location').textContent = result.location;
  byId('result-period').textContent = result.period; byId('result-arrival').textContent = result.arrival;
}
function showFailure(message: string): void {
  byId('result-empty').hidden = true; byId('result-details').hidden = true; byId('result-message').hidden = false;
  byId('result-message').textContent = message; byId('result-badge').hidden = false;
  byId('result-badge').textContent = message.includes('结果未知') ? '预约结果未知' : '预约失败';
  byId('result-badge').className = 'badge failed';
}
async function run<T>(work: () => Promise<Reply<T>>, success: (value: T) => void, reservation = false): Promise<void> {
  if (busy) return;
  busy = true; notice(''); controls();
  try {
    const reply = await work();
    if (reply.ok) success(reply.value);
    else { notice(reply.error.message); if (reservation) showFailure(reply.error.message); }
  } catch { const message = reservation ? '预约结果未知，请在图书馆官网确认。' : '无法连接应用，请重新打开。'; notice(message); if (reservation) showFailure(message); }
  finally { busy = false; controls(); }
}
function branch(label: string): HTMLDetailsElement {
  const element = document.createElement('details'), summary = document.createElement('summary');
  summary.textContent = label; element.append(summary); return element;
}
function checkbox(label: string, scope: Scope): HTMLLabelElement {
  const wrapper = document.createElement('label'); wrapper.className = 'check';
  const input = document.createElement('input'); input.type = 'checkbox'; input.checked = scopeChoices.has(key(scope));
  input.addEventListener('change', () => { if (input.checked) scopeChoices.set(key(scope), scope); else scopeChoices.delete(key(scope)); updateScopeCount(); });
  wrapper.append(input, document.createTextNode(label)); return wrapper;
}
function updateScopeCount(): void { byId('scope-count').textContent = scopeChoices.size ? `已选 ${scopeChoices.size} 项` : ''; controls(); }
// Both selectors share the official hierarchy; no transient identifiers reach the page.
function renderTree(root: HTMLElement, items: (Location | LocationView)[], custom: boolean): void {
  root.replaceChildren();
  if (!items.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = custom ? '暂无可选位置' : '该时段暂无空位，可使用一键选择继续等待'; root.append(empty); return; }
  for (const premises of new Set(items.map(item => item.premises))) {
    const building = branch(premises);
    if (custom) building.append(checkbox(`整个${premises}`, { premises }));
    const buildingItems = items.filter(item => item.premises === premises);
    for (const floor of new Set(buildingItems.map(item => item.floor))) {
      const level = branch(floor);
      if (custom) level.append(checkbox(`整个${floor}`, { premises, floor }));
      for (const item of buildingItems.filter(item => item.floor === floor)) {
        if (custom) { const check = checkbox(item.area, { premises, floor, area: item.area }); check.classList.add('leaf'); level.append(check); }
        else {
          const button = document.createElement('button'); button.className = 'region';
          const name = document.createElement('span'), count = document.createElement('span'); name.textContent = item.area;
          count.textContent = `${(item as LocationView).freeCount} 空位`; button.append(name, count);
          button.addEventListener('click', () => { void loadSeats({ premises, floor, area: item.area }, button); }); level.append(button);
        }
      }
      building.append(level);
    }
    root.append(building);
  }
  controls();
}
async function loadLocations(refresh = false): Promise<void> {
  if (busy || active() || authState !== 'AUTHENTICATED') return;
  needsLoad = false; clearSelection();
  byId('locations').textContent = '正在加载位置…';
  await run(() => window.libraryApp.listAvailability({ ...period(), refresh }), result => {
    renderTree(byId('locations'), result.locations, false); renderTree(byId('scopes'), result.scopes, true);
  });
  if (byId('locations').textContent === '正在加载位置…') byId('locations').textContent = '位置加载失败，请重试';
}
async function loadSeats(location: Location, button: HTMLButtonElement): Promise<void> {
  if (busy || active()) return;
  clearSelection(); byId('seat-hint').textContent = '正在读取空闲座位…';
  document.querySelectorAll('.region.active').forEach(element => element.classList.remove('active')); button.classList.add('active');
  await run(() => window.libraryApp.listSeats({ ...period(), location }), result => {
    byId('seat-count').textContent = `${result.seats.length} 空位`;
    byId('seat-hint').textContent = result.seats.length ? `${Object.values(location).join(' · ')} · ${result.startTime}–${result.endTime}` : '该位置暂时没有空位';
    for (const no of result.seats) {
      const seat = document.createElement('button'); seat.className = 'seat'; seat.textContent = no; seat.setAttribute('aria-pressed', 'false');
      seat.addEventListener('click', () => {
        selected = { location, no }; document.querySelectorAll('.seat').forEach(element => element.setAttribute('aria-pressed', 'false'));
        seat.setAttribute('aria-pressed', 'true'); byId('selection').hidden = false;
        byId('selected-seat').textContent = no; byId('selected-location').textContent = Object.values(location).join(' · ');
        byId('selected-period').textContent = `${result.day} ${result.startTime}–${result.endTime}`; controls();
      }); byId('seats').append(seat);
    }
  });
  if (byId('seat-hint').textContent === '正在读取空闲座位…') byId('seat-hint').textContent = '座位加载失败，请重新选择位置';
}
function showAuto(value: AutoView): void {
  auto = value;
  for (const mode of ['main', 'all', 'custom']) byId(`status-${mode}`).textContent = value.mode === mode ? value.message : '等待开始';
  const resultKey = JSON.stringify(value);
  if (resultKey !== lastAutoResult) {
    if (value.result) { showResult(value.result); clearSelection(); }
    else if (value.state === 'FAILED') showFailure(value.message);
    lastAutoResult = resultKey;
  }
  controls();
}
async function poll(): Promise<void> {
  if (polling || stopped) return;
  polling = true;
  try {
    const [auth, monitor] = await Promise.all([window.libraryApp.getAuthStatus(), window.libraryApp.getAutoSelectStatus()]);
    if (auth.ok) showAuth(auth.value);
    if (monitor.ok) showAuto(monitor.value);
  } catch { notice('无法连接应用，请重新打开。'); }
  finally { polling = false; }
  if (needsLoad) await loadLocations();
}
authButton.addEventListener('click', () => {
  const logout = authState === 'AUTHENTICATED';
  void run(() => logout ? window.libraryApp.logout() : window.libraryApp.login(), status => {
    showAuth(status);
    if (logout) { clearSelection(); scopeChoices.clear(); needsLoad = false; renderTree(byId('locations'), [], false); renderTree(byId('scopes'), [], true); updateScopeCount(); }
    else needsLoad = true;
  });
});
for (const id of ['website-button', 'result-website']) byId(id).addEventListener('click', () => { void run(() => window.libraryApp.openBookingWebsite(), () => {}); });
byId('refresh-button').addEventListener('click', () => { void loadLocations(true); });
for (const id of ['day', 'startTime', 'endTime']) byId(id).addEventListener('change', () => { clearSelection(); needsLoad = true; void loadLocations(); });
byId('reserve-button').addEventListener('click', () => {
  if (!selected || busy || active()) return;
  const input = { ...period(), location: selected.location, seat: selected.no };
  selected = undefined;
  void run(() => window.libraryApp.reserveManual(input), showResult, true);
});
document.querySelectorAll<HTMLButtonElement>('.start').forEach(button => button.addEventListener('click', () => {
  const mode = button.dataset.mode as AutoMode;
  void run(() => window.libraryApp.startAutoSelect({ ...period(), mode, scopes: mode === 'custom' ? [...scopeChoices.values()] : [] }), value => { clearSelection(); showAuto(value); });
}));
document.querySelectorAll('.stop').forEach(button => button.addEventListener('click', async () => {
  try { const reply = await window.libraryApp.stopAutoSelect(); if (reply.ok) showAuto(reply.value); else notice(reply.error.message); }
  catch { notice('停止状态暂未确认，请打开图书馆核对。'); }
}));
void poll();
const timer = setInterval(() => { void poll(); }, 1000);
window.addEventListener('beforeunload', () => { stopped = true; clearInterval(timer); });
