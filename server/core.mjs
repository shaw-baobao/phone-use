import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export function cli(args, { binary = process.env.MOBILECLI_BIN || 'mobilecli', timeout = 25000, raw = false, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Connection cancelled.'));
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let output = Buffer.alloc(0), failed = false;
    const finish = (error, value) => { if (failed) return; failed = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(new Error('MobileCLI timed out. Read fresh state before repeating an action.')); }, timeout);
    const abort = () => { child.kill('SIGTERM'); finish(new Error('Connection cancelled.')); };
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => {
      if (output.length + chunk.length > 8 * 1024 * 1024) { child.kill(); finish(new Error('MobileCLI response exceeds 8 MiB')); }
      else output = Buffer.concat([output, chunk]);
    });
    // Do not log stderr: it may contain device IDs or typed text.
    child.stderr.resume();
    child.on('error', error => finish(error));
    child.on('close', code => {
      if (raw && code === 0) return finish(null, output);
      let result; try { result = JSON.parse(output.toString()); } catch { return finish(new Error(`MobileCLI failed (exit ${code}). Check device connection and agent installation.`)); }
      if (code !== 0 || result.status !== 'ok') return finish(new Error(result.error || result.data?.message || 'MobileCLI failed'));
      finish(null, result.data);
    });
  });
}

export class JpegParser {
  constructor(onFrame, max = 4 * 1024 * 1024) { this.onFrame = onFrame; this.max = max; this.buffer = Buffer.alloc(0); }
  feed(chunk) {
    for (let offset = 0; offset < chunk.length; offset += 65536) {
      this.buffer = Buffer.concat([this.buffer, chunk.subarray(offset, offset + 65536)]);
      while (true) {
        const start = this.buffer.indexOf(Buffer.from([255, 216]));
        if (start < 0) { this.buffer = this.buffer.subarray(-1); break; }
        if (start) this.buffer = this.buffer.subarray(start);
        const end = this.buffer.indexOf(Buffer.from([255, 217]), 2);
        if (end < 0) {
          if (this.buffer.length > this.max) this.buffer = this.buffer.subarray(-1);
          break;
        }
        const frame = this.buffer.subarray(0, end + 2);
        if (frame.length <= this.max) this.onFrame(frame);
        this.buffer = this.buffer.subarray(end + 2);
      }
    }
  }
}

export function jpegSize(frame) {
  let offset = 2;
  while (offset + 4 < frame.length) {
    if (frame[offset++] !== 255) return null;
    while (frame[offset] === 255) offset++;
    const marker = frame[offset++];
    if (marker === 0xda || marker === 0xd9) return null;
    const size = frame.readUInt16BE(offset);
    if (size < 2 || offset + size > frame.length) return null;
    if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 8) return { width: frame.readUInt16BE(offset + 5), height: frame.readUInt16BE(offset + 3) };
    offset += size;
  }
  return null;
}

export function mapPoint(point, size) {
  if (!size || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x > 1 || point.y > 1) throw new Error('Coordinates must be normalized to the displayed image (0–1).');
  return [Math.round(point.x * (size.width - 1)), Math.round(point.y * (size.height - 1))];
}

export class Controller {
  constructor({ run = cli, launch = spawn, now = Date.now } = {}) {
    this.run = run; this.launch = launch; this.now = now;
    this.device = null; this.size = null; this.mode = 'manual'; this.epoch = 0;
    this.connectionDevice = null; this.connecting = false; this.connectAbort = null;
    this.tail = Promise.resolve(); this.busy = false; this.stream = null; this.frame = null;
    this.seq = 0; this.frames = new Map(); this.lastLease = 0; this.lastRestart = 0; this.error = null; this.paused = false;
    this.session = randomUUID(); this.watch = setInterval(() => { if (this.now() - this.lastLease > 5000) this.stopStream(); }, 1000); this.watch.unref();
  }
  async devices() { return (await this.run(['devices'])).devices; }
  async connect(id) {
    if (this.connecting) throw new Error('A connection is already pending. Disconnect before trying again.');
    const epoch = ++this.epoch, abort = new AbortController();
    this.connecting = true; this.connectAbort = abort; this.error = null; this.connectionDevice = null;
    const check = () => { if (epoch !== this.epoch || abort.signal.aborted) throw new Error('Control changed during connection. Connection cancelled.'); };
    try {
      await this.exclusive(async () => {
        check();
        const device = (await this.run(['devices'], { signal: abort.signal })).devices.find(item => item.id === id && item.state === 'online');
        check();
        if (!device) throw new Error('Select an online device from the device list.');
        this.connectionDevice = device;
        this.stopStream(); this.device = null; this.size = null; this.frame = null; this.frames.clear();
        this.session = randomUUID(); this.paused = false; this.mode = 'manual';
        const response = await this.run(['device', 'info', '--device', id], { signal: abort.signal });
        check();
        const info = response.device || response;
        if (!info.screenSize?.width || !info.screenSize?.height) throw new Error('MobileCLI did not return screen dimensions.');
        this.device = device; this.size = info.screenSize; this.seq = 0;
      });
    } catch (error) {
      if (epoch === this.epoch) {
        this.error = /WebDriverAgent|wait for agent|start agent/i.test(error.message)
          ? `DeviceKit did not become ready. An installed agent or an unlocked phone does not confirm a working connection. Choose Stop automation, then Connect to retry. MobileCLI: ${error.message}`
          : error.message;
      }
      throw new Error(this.error || error.message);
    } finally {
      this.connecting = false; this.connectAbort = null;
    }
    return this.state();
  }
  exclusive(task) {
    const next = this.tail.catch(() => {}).then(async () => { this.busy = true; try { return await task(); } finally { this.busy = false; } });
    this.tail = next; return next;
  }
  setMode(mode) { this.epoch++; this.mode = mode; return this.state(); }
  pause(paused) { this.epoch++; this.paused = paused; if (paused) { this.stopStream(); this.frame = null; } return this.state(); }
  state(after = -1) {
    const age = this.frame ? this.now() - this.frame.at : null;
    return { session: this.session, device: this.device, connectionDevice: this.connectionDevice, connecting: this.connecting, viewport: this.viewport(), mode: this.mode, paused: this.paused, busy: this.busy, error: this.error,
      live: age !== null && age < 2500, frame: !this.paused && this.frame && this.frame.seq !== after ? this.frame : null, frameAge: age };
  }
  viewport() {
    if (!this.size) return null;
    const image = this.frame?.size;
    const size = { width: this.size.width, height: this.size.height };
    if (image && (image.width > image.height) !== (size.width > size.height)) return { width: size.height, height: size.width };
    return size;
  }
  poll(after) { this.lastLease = this.now(); if (!this.paused && this.device) this.startStream(); return this.state(after); }
  startStream() {
    if (this.stream || this.now() - this.lastRestart < 3000) return;
    this.lastRestart = this.now();
    const child = this.launch(process.env.MOBILECLI_BIN || 'mobilecli', ['screencapture', '--device', this.device.id, '--format', 'mjpeg', '--fps', '10', '--scale', '0.5'], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    this.stream = child; const parser = new JpegParser(bytes => {
      if (this.stream !== child || this.paused) return;
      const size = jpegSize(bytes); if (!size) return;
      if (this.frame && (size.width !== this.frame.size.width || size.height !== this.frame.size.height)) { this.epoch++; this.session = randomUUID(); this.frames.clear(); }
      this.frame = { seq: ++this.seq, data: bytes.toString('base64'), mimeType: 'image/jpeg', size, at: this.now() }; this.error = null;
      this.frames.set(this.seq, { at: this.frame.at, size });
      while (this.frames.size > 50) this.frames.delete(this.frames.keys().next().value);
    });
    child.stdout.on('data', bytes => parser.feed(bytes)); child.stderr.resume();
    child.on('error', () => { if (this.stream === child) { this.stream = null; this.error = 'Cannot start MobileCLI screen stream.'; } });
    child.on('close', () => { if (this.stream === child) { this.stream = null; this.error = 'Stream disconnected. Unlock the device and check its agent.'; } });
  }
  stopStream() { const child = this.stream; this.stream = null; child?.kill('SIGTERM'); }
  async action(args, actor = 'manual') {
    const epoch = this.epoch;
    return this.exclusive(async () => {
      if (epoch !== this.epoch) throw new Error('Control changed while this action was queued. Nothing was sent.');
      if (!this.device || this.paused || this.mode !== actor) throw new Error(`Control belongs to ${this.mode}; preview may be paused. Nothing was sent.`);
      const displayed = this.frames.get(args.frameSeq);
      if (actor === 'manual' && args.session !== this.session) throw new Error('Control session changed. Reconnect the selected device. Nothing was sent.');
      if (actor === 'manual' && !['home', 'recent', 'launch'].includes(args.action) && (!displayed || this.now() - displayed.at > 2500 || args.session !== this.session || !this.frame || this.now() - this.frame.at > 2500 )) throw new Error('The preview is stale. Wait for a live frame before controlling the device.');
      const target = ['--device', this.device.id]; let command;
      const point = value => mapPoint(value, this.viewport()).join(',');
      switch (args.action) {
        case 'tap': command = ['io', 'tap', ...target, point(args.point)]; break;
        case 'longpress': command = ['io', 'longpress', ...target, point(args.point), '--duration', String(Math.min(2000, Math.max(500, args.duration || 500)))]; break;
        case 'swipe': command = ['io', 'swipe', ...target, `${point(args.from)},${point(args.to)}`, '--duration', String(Math.min(1500, Math.max(100, args.duration || 300)))]; break;
        case 'text': if (typeof args.text !== 'string' || !args.text.length || args.text.length > 4000) throw new Error('Text must contain 1–4000 characters.'); command = ['io', 'text', ...target, '--', args.text]; break;
        case 'home': {
          if (this.device.platform === 'ios' && this.device.type !== 'simulator') { const size = this.viewport(); const x = Math.round(size.width / 2); command = ['io', 'swipe', ...target, `${x},${size.height - 2},${x},${Math.round(size.height * 0.22)}`, '--duration', '200']; }
          else command = ['io', 'button', ...target, 'HOME'];
          break;
        }
        case 'recent': {
          if (this.device.platform === 'android') command = ['io', 'button', ...target, 'APP_SWITCH'];
          else { const size = this.viewport(); const x = Math.round(size.width / 2); command = ['io', 'swipe', ...target, `${x},${size.height - 2},${x},${Math.round(size.height * 0.8)}`, '--duration', '1500']; }
          break;
        }
        case 'launch': if (!/^[a-zA-Z0-9_.-]{3,200}$/.test(args.bundleId || '')) throw new Error('Invalid application ID'); command = ['apps', 'launch', args.bundleId, ...target]; break;
        default: throw new Error('Unsupported action');
      }
      await this.run(command);
      if (args.action === 'home' && this.device.platform === 'ios') {
        let foreground;
        for (let attempt = 0; attempt < 6; attempt++) {
          if (attempt) await new Promise(resolve => setTimeout(resolve, 200));
          foreground = await this.run(['apps', 'foreground', ...target]);
          if (foreground.packageName === 'com.apple.springboard') break;
        }
        if (foreground.packageName !== 'com.apple.springboard') throw new Error('Home input was sent, but the phone did not return to its Home screen. Check the device and its agent before trying again.');
        return { ok: true, action: 'home', verified: true, verification: 'SpringBoard is in the foreground' };
      }
      return { ok: true, action: args.action, verified: false };
    });
  }
  async capture() {
    const epoch = this.epoch;
    return this.exclusive(async () => {
      if (epoch !== this.epoch || !this.device || this.paused) throw new Error('Connect and resume the selected device before taking a screenshot.');
      const bytes = await this.run(['screenshot', '--device', this.device.id, '--format', 'png', '--output', '-'], { raw: true });
      if (!Buffer.isBuffer(bytes) || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('MobileCLI did not return a PNG screenshot.');
      return { capture: { mimeType: 'image/png', data: bytes.toString('base64'), filename: `phone-use-${new Date(this.now()).toISOString().replace(/[:.]/g, '-')}.png` } };
    });
  }
  async observe() {
    return this.exclusive(async () => { if (!this.device || this.paused) throw new Error('Connect and resume the device first.'); return this.run(['dump', 'ui', '--device', this.device.id]); });
  }
  async stop(automation = false) {
    const device = this.connectionDevice || this.device;
    this.epoch++; this.paused = true; this.stopStream(); this.frame = null;
    this.connectAbort?.abort(); this.error = null;
    return this.exclusive(async () => {
      let automationStopped = false;
      if (automation && device?.platform === 'ios') {
        const status = await this.run(['agent', 'status', '--device', device.id]);
        if (status.agent?.bundleId) {
          try { await this.run(['apps', 'terminate', status.agent.bundleId, '--device', device.id]); }
          catch (error) { if (!/process of .+ not found/.test(error.message)) throw error; }
          automationStopped = true;
        }
      }
      this.device = null; this.connectionDevice = null; this.size = null; return { ok: true, automationStopped };
    });
  }
  close() { this.connectAbort?.abort(); clearInterval(this.watch); this.stopStream(); }
}
