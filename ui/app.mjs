import { App } from '@modelcontextprotocol/ext-apps';
import { imagePoint } from './geometry.mjs';
import { inputError } from './controls.mjs';
import { bindKeyboard } from './keyboard.mjs';
import { version } from '../shared/version.mjs';
const el = id => document.getElementById(id);
const screen = el('screen');
let app, state = {}, seq = -1, running = false, timer, acting = false, operations = 0, stopping = false, gesture, disposed = false;
const local = location.protocol === 'http:' && location.hostname === '127.0.0.1';
const token = location.hash.slice(1);
async function call(name, args = {}) {
  if (local) {
    const response = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Panel-Token': token }, body: JSON.stringify({ name, arguments: args }) });
    if (response.status === 403) throw new Error('Preview session expired. Open the current localhost URL and reload the page.');
    const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
  }
  const response = await app.callServerTool({ name, arguments: args }, { timeout: 30000 });
  if (response.isError) throw new Error(response.content?.find(b => b.type === 'text')?.text || 'Operation failed');
  return response.structuredContent || JSON.parse(response.content.find(b => b.type === 'text').text);
}
function message(text) { el('message').textContent = text; }
el('inspector-toggle').onclick = () => {
  const hidden = !el('inspector').hidden;
  el('inspector').hidden = hidden;
  el('inspector-toggle').setAttribute('aria-expanded', String(!hidden));
  el('inspector-toggle').setAttribute('aria-label', hidden ? 'Show controls' : 'Hide controls');
  el('inspector-toggle').title = hidden ? 'Show controls' : 'Hide controls';
};
const keyboard = bindKeyboard(el('keyboard'), {
  context: () => state.device && state.mode === 'manual' && state.live && !state.paused && !disposed && !document.hidden
    ? { session: state.session, frameSeq: seq, platform: state.device.platform, ready: !acting && !state.busy } : null,
  send: async args => {
    operations++; acting = true; sync();
    try { await call('phone_input', args); message('Keyboard input sent'); }
    finally { acting = --operations > 0; sync(); clearTimeout(timer); void poll(); }
  },
  onError: message,
});
screen.addEventListener('focus', () => keyboard.focus());
function sync() {
  keyboard.update();
  const manual = state.mode === 'manual', live = state.live && !state.paused;
  el('status').textContent = state.connecting ? 'Connecting' : state.error ? 'Connection failed' : state.paused ? 'Paused' : live ? 'Live' : state.device ? 'Connecting' : 'Disconnected';
  el('status').dataset.live = String(live);
  el('stage').dataset.screen = String(!screen.hidden);
  if (screen.hidden && state.connecting) el('empty').textContent = 'Connecting to your phone…';
  if (!state.device) el('dimensions').textContent = '';
  el('manual').setAttribute('aria-pressed', String(manual)); el('ai').setAttribute('aria-pressed', String(!manual));
  el('hint').textContent = manual ? 'Click to control. Type with your Mac keyboard.' : 'AI has control. Choose You to take over.';
  for (const id of ['send', 'text']) el(id).disabled = !manual || !live || acting || state.busy;
  for (const id of ['home', 'recent']) el(id).disabled = Boolean(inputError(state, id, acting));
  el('capture').disabled = !state.device || state.paused || acting || state.busy;
  el('pause').disabled = !state.device || acting;
  for (const id of ['disconnect', 'stop']) el(id).disabled = stopping || !(state.device || state.connectionDevice || state.connecting) || (acting && !state.connecting);
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
  for (const device of data.devices) if (device.state === 'online') select.add(new Option(`${device.name} · ${device.platform === 'ios' ? 'iPhone' : device.platform}`, device.id));
  select.value = selected || state.device?.id || '';
}
async function poll() {
  if (running || disposed || document.hidden || !state.device || state.paused) return;
  running = true;
  try { consume(await call('phone_frame', { after: seq })); }
  catch (error) { state.live = false; sync(); message(error.message); }
  finally { running = false; if (!disposed && !document.hidden && state.device && !state.paused) timer = setTimeout(poll, state.live ? 120 : 700); }
}
async function perform(fn, interrupt = false) {
  if (acting && !interrupt) return; operations++; acting = true; sync();
  try { await fn(); } catch (error) { if (!stopping || interrupt) message(error.message); } finally { acting = --operations > 0; sync(); }
}
async function input(args) {
  const error = inputError(state, args.action, acting);
  if (error) { message(error); return; }
  const auth = { session: state.session, ...(seq >= 0 ? { frameSeq: seq } : {}) };
  await perform(async () => {
    message(args.action === 'home' ? 'Sending Home…' : args.action === 'recent' ? 'Opening recent apps…' : 'Sending input…');
    const response = await call('phone_input', { ...args, ...auth });
    message(args.action === 'home' ? (response.verified ? 'Home screen confirmed' : 'Home sent') : args.action === 'recent' ? 'Recent apps gesture sent' : args.action === 'text' ? 'Text sent' : 'Gesture sent');
    clearTimeout(timer); void poll();
  });
}
function point(event) { return imagePoint(event.clientX, event.clientY, screen.getBoundingClientRect(), state.imageSize); }
screen.addEventListener('pointerdown', event => {
  if (event.button !== 0 || state.mode !== 'manual' || !state.live || acting || state.busy || state.paused) return;
  const start = point(event); if (!start) return;
  keyboard.focus();
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
el('recent').onclick = () => input({ action: 'recent' });
el('capture').onclick = () => perform(async () => {
  message('Taking screenshot…');
  const { capture } = await call('phone_capture');
  if (local) {
    const bytes = Uint8Array.from(atob(capture.data), char => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: capture.mimeType }));
    const link = document.createElement('a'); link.href = url; link.download = capture.filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } else {
    const response = await app.downloadFile({ contents: [{ type: 'resource', resource: { uri: `file:///${capture.filename}`, mimeType: capture.mimeType, blob: capture.data } }] });
    if (response.isError) throw new Error('Screenshot captured, but its download was cancelled or unsupported by the host.');
  }
  message('Screenshot captured');
});
el('send').onclick = () => { const text = el('text').value; if (text) void input({ action: 'text', text }); };
for (const mode of ['manual', 'ai']) el(mode).onclick = () => perform(async () => { consume(await call('phone_mode', { mode })); message(mode === 'manual' ? 'You have control' : 'AI control enabled'); });
el('connect').onclick = () => perform(async () => {
  state.connecting = true; state.error = null; sync(); message('Starting device connection…');
  try { consume(await call('phone_connect', { deviceId: el('devices').value })); clearTimeout(timer); void poll(); message('Connecting screen…'); }
  catch (error) {
    try { consume(await call('phone_frame', { after: seq })); } catch { /* Preserve the original connection failure. */ }
    if (state.paused && /cancelled|Control changed/i.test(error.message)) return;
    throw error;
  } finally { state.connecting = false; sync(); }
});
el('refresh').onclick = () => perform(devices);
el('pause').onclick = () => perform(async () => { consume(await call('phone_pause', { paused: !state.paused })); clearTimeout(timer); void poll(); });
for (const id of ['disconnect', 'stop']) el(id).onclick = () => {
  if (stopping) return;
  stopping = true;
  void perform(async () => {
    const result = await call('phone_stop', { automation: true });
    consume(await call('phone_frame', { after: seq })); clearTimeout(timer);
    message(result.automationStopped ? 'Automation stopped' : 'Disconnected; no iOS runner was stopped');
  }, true).finally(() => { stopping = false; sync(); });
};
document.addEventListener('visibilitychange', () => { keyboard.update(); clearTimeout(timer); if (!document.hidden) void poll(); });
window.addEventListener('pagehide', () => { clearTimeout(timer); gesture = null; keyboard.reset(); });
window.addEventListener('pageshow', () => { void poll(); });
async function start() {
  try {
    if (!local) {
      app = new App({ name: 'Phone Use', version }, { availableDisplayModes: ['fullscreen'] }, { autoResize: false });
      app.ontoolresult = event => { if (event.structuredContent) { consume(event.structuredContent); void poll(); } };
      app.onteardown = async () => { disposed = true; keyboard.reset(); clearTimeout(timer); };
      await app.connect();
      if (app.getHostContext()?.availableDisplayModes?.includes('fullscreen')) await app.requestDisplayMode({ mode: 'fullscreen' });
    }
    consume(await call('phone_open')); await devices(); void poll();
  } catch (error) { message(error.message); el('empty').textContent = 'Connection failed. Check MobileCLI and reload the panel.'; }
}
void start();
