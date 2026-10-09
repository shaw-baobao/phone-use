import { App } from '@modelcontextprotocol/ext-apps';
import { imagePoint } from './geometry.mjs';
import { version } from '../shared/version.mjs';
const el = id => document.getElementById(id);
const screen = el('screen');
let app, state = {}, seq = -1, running = false, timer, acting = false, gesture, disposed = false;
const local = location.protocol === 'http:' && location.hostname === '127.0.0.1';
const token = location.hash.slice(1);
async function call(name, args = {}) {
  if (local) {
    const response = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Panel-Token': token }, body: JSON.stringify({ name, arguments: args }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
  }
  const response = await app.callServerTool({ name, arguments: args }, { timeout: 30000 });
  if (response.isError) throw new Error(response.content?.find(b => b.type === 'text')?.text || 'Operation failed');
  return response.structuredContent || JSON.parse(response.content.find(b => b.type === 'text').text);
}
function message(text) { el('message').textContent = text; }
function sync() {
  const manual = state.mode === 'manual', live = state.live && !state.paused;
  el('status').textContent = state.paused ? 'Paused' : live ? 'Live' : state.device ? 'Connecting' : 'Disconnected';
  el('status').dataset.live = String(live);
  el('manual').setAttribute('aria-pressed', String(manual)); el('ai').setAttribute('aria-pressed', String(!manual));
  el('hint').textContent = manual ? 'Click, drag or hold on the live screen.' : 'AI has control. Choose You to take over.';
  for (const id of ['home', 'send', 'text']) el(id).disabled = !manual || !live || acting || state.busy;
  for (const id of ['pause', 'disconnect', 'stop']) el(id).disabled = !state.device || acting;
  el('pause').textContent = state.paused ? 'Resume preview' : 'Pause preview';
  el('connect').disabled = acting; el('manual').disabled = el('ai').disabled = !state.device;
  screen.style.cursor = manual && live && !acting ? 'crosshair' : 'default';
}
function consume(data) {
  const previousError = state.error, previousLive = state.live;
  if ((data.mode && data.mode !== state.mode) || (data.paused !== undefined && data.paused !== state.paused)) gesture = null;
  if (data.session && data.session !== state.session) { gesture = null; seq = -1; screen.removeAttribute('src'); screen.hidden = true; }
  state = { ...state, ...data };
  if (data.frame) {
    const frame = data.frame; seq = frame.seq; state.imageSize = frame.size;
    screen.src = `data:${frame.mimeType};base64,${frame.data}`;
    screen.hidden = false; el('empty').hidden = true;
  }
  if (state.paused || !state.device) { screen.removeAttribute('src'); screen.hidden = true; el('empty').hidden = false; el('empty').textContent = state.paused ? 'Preview paused. Resume when you are ready.' : 'Connect a device to see its screen.'; seq = -1; }
  if (state.viewport) el('dimensions').textContent = `${state.viewport.width} × ${state.viewport.height}`;
  if (data.error) message(data.error);
  else if (data.frame && data.live && (!previousLive || previousError)) message('Live screen connected');
  sync();
}
async function devices() {
  const data = await call('phone_devices'); const select = el('devices');
  const selected = select.value; select.replaceChildren(new Option('Choose a device', ''));
  for (const device of data.devices) if (device.state === 'online') select.add(new Option(`${device.name} · ${device.platform} ${device.type}`, device.id));
  select.value = selected || state.device?.id || '';
}
async function poll() {
  if (running || disposed || document.hidden || !state.device || state.paused) return;
  running = true;
  try { consume(await call('phone_frame', { after: seq })); }
  catch (error) { state.live = false; sync(); message(error.message); }
  finally { running = false; if (!disposed && !document.hidden && state.device && !state.paused) timer = setTimeout(poll, state.live ? 120 : 700); }
}
async function perform(fn) {
  if (acting) return; acting = true; sync();
  try { await fn(); } catch (error) { message(error.message); } finally { acting = false; sync(); }
}
async function input(args) {
  if (state.mode !== 'manual' || !state.live || state.paused || acting || state.busy) return;
  const session = state.session, frameSeq = seq;
  await perform(async () => { await call('phone_input', { ...args, session, frameSeq }); message(`${args.action === 'text' ? 'Text' : 'Gesture'} sent`); });
}
function point(event) { return imagePoint(event.clientX, event.clientY, screen.getBoundingClientRect(), state.imageSize); }
screen.addEventListener('pointerdown', event => {
  if (event.button !== 0 || state.mode !== 'manual' || !state.live || acting || state.busy || state.paused) return;
  const start = point(event); if (!start) return;
  screen.setPointerCapture(event.pointerId); gesture = { start, at: performance.now(), session: state.session, id: event.pointerId }; event.preventDefault();
});
screen.addEventListener('pointerup', event => {
  const current = gesture; gesture = null;
  if (!current || current.id !== event.pointerId || current.session !== state.session) return;
  const end = point(event); if (!end) return;
  const duration = Math.round(performance.now() - current.at);
  const distance = Math.hypot(current.start.x - end.x, current.start.y - end.y);
  const rect = el('stage').getBoundingClientRect(); el('cursor').style.left = `${event.clientX - rect.left}px`; el('cursor').style.top = `${event.clientY - rect.top}px`; el('cursor').hidden = false; setTimeout(() => { el('cursor').hidden = true; }, 500);
  void input(distance > 0.02 ? { action: 'swipe', from: current.start, to: end, duration: Math.max(100, Math.min(1500, duration)) } : { action: duration > 500 ? 'longpress' : 'tap', point: end, duration: Math.max(500, Math.min(2000, duration)) });
});
screen.addEventListener('pointercancel', () => { gesture = null; });
el('home').onclick = () => input({ action: 'home' });
el('send').onclick = () => { const text = el('text').value; if (text) void input({ action: 'text', text }); };
for (const mode of ['manual', 'ai']) el(mode).onclick = () => perform(async () => { consume(await call('phone_mode', { mode })); message(mode === 'manual' ? 'You have control' : 'AI control enabled'); });
el('connect').onclick = () => perform(async () => { consume(await call('phone_connect', { deviceId: el('devices').value })); clearTimeout(timer); void poll(); message('Connecting screen…'); });
el('refresh').onclick = () => perform(devices);
el('pause').onclick = () => perform(async () => { consume(await call('phone_pause', { paused: !state.paused })); clearTimeout(timer); void poll(); });
for (const [id, automation] of [['disconnect', false], ['stop', true]]) el(id).onclick = () => perform(async () => { consume(await call('phone_stop', { automation })); state.device = null; consume(state); clearTimeout(timer); message(automation ? (state.automationStopped ? 'Automation stopped' : 'Disconnected; no iOS runner was stopped') : 'Disconnected'); });
document.addEventListener('visibilitychange', () => { clearTimeout(timer); if (!document.hidden) void poll(); });
window.addEventListener('pagehide', () => { clearTimeout(timer); gesture = null; });
window.addEventListener('pageshow', () => { void poll(); });
async function start() {
  try {
    if (!local) {
      app = new App({ name: 'Phone Use', version }, { availableDisplayModes: ['fullscreen'] }, { autoResize: false });
      app.ontoolresult = event => { if (event.structuredContent) { consume(event.structuredContent); void poll(); } };
      app.onteardown = async () => { disposed = true; clearTimeout(timer); };
      await app.connect();
      if (app.getHostContext()?.availableDisplayModes?.includes('fullscreen')) await app.requestDisplayMode({ mode: 'fullscreen' });
    }
    consume(await call('phone_open')); await devices(); void poll();
  } catch (error) { message(error.message); el('empty').textContent = 'Connection failed. Check MobileCLI and reload the panel.'; }
}
void start();
