import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { Controller } from '../server/core.mjs';
import { inputError } from '../ui/controls.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));
async function panel(t, run) {
  const c = new Controller({ run }); t.after(() => c.close());
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, { value: '', style: {}, dataset: {}, disabled: false, hidden: false, textContent: '', setAttribute() {}, removeAttribute() {}, addEventListener() {}, replaceChildren() {}, add() {} });
    return elements.get(id);
  };
  const context = vm.createContext({
    document: { hidden: true, getElementById: el, addEventListener() {} },
    window: { addEventListener() {} }, location: { protocol: 'http:', hostname: '127.0.0.1', hash: '#test' },
    Option: class {}, inputError, imagePoint() {}, version: 'test', setTimeout, clearTimeout,
    fetch: async (url, { body }) => {
      const { name, arguments: args } = JSON.parse(body);
      try {
        const data = name === 'phone_open' ? c.state() : name === 'phone_devices' ? { devices: await c.devices() }
          : name === 'phone_connect' ? await c.connect(args.deviceId) : name === 'phone_stop' ? await c.stop(args.automation) : c.poll(args.after);
        return { ok: true, status: 200, json: async () => data };
      } catch (error) { return { ok: false, status: 400, json: async () => ({ error: error.message }) }; }
    },
  });
  // Execute the real panel lifecycle against a minimal DOM and its controller.
  const source = await readFile(new URL('../ui/app.mjs', import.meta.url), 'utf8');
  vm.runInContext(source.replace(/^import .*;\n/gm, ''), context);
  await turn(); el('devices').value = 'test';
  return { c, el };
}
const device = { id: 'test', name: 'Test', state: 'online', platform: 'ios' };
test('panel shows agent failure and enables Stop automation after failed connection', async t => {
  const calls = [];
  const { el } = await panel(t, async args => {
    calls.push(args);
    if (args[0] === 'devices') return { devices: [device] };
    if (args[0] === 'device') throw new Error('timed out waiting for WebDriverAgent to be ready');
    if (args[0] === 'agent') return { agent: { bundleId: 'test.runner' } };
    return {};
  });
  await el('connect').onclick();
  assert.equal(el('status').textContent, 'Connection failed');
  assert.match(el('message').textContent, /Stop automation/);
  assert.equal(el('stop').disabled, false);
  el('stop').onclick(); await turn(); await turn();
  assert.equal(el('message').textContent, 'Automation stopped');
  assert.deepEqual(calls.at(-1), ['apps', 'terminate', 'test.runner', '--device', 'test']);
  assert.equal(el('connect').disabled, false);
  assert.equal(el('stop').disabled, true);
});
test('panel can stop a pending connection and reports stop failures', async t => {
  let started; const ready = new Promise(resolve => { started = resolve; });
  const { el } = await panel(t, async (args, options) => {
    if (args[0] === 'devices') return { devices: [device] };
    if (args[0] === 'device') { started(); return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('Connection cancelled.')), { once: true })); }
    if (args[0] === 'agent') throw new Error('Runner stop failed');
  });
  const connection = el('connect').onclick(); await ready;
  assert.equal(el('status').textContent, 'Connecting');
  assert.equal(el('stop').disabled, false);
  el('stop').onclick(); await connection; await turn(); await turn();
  assert.equal(el('message').textContent, 'Runner stop failed');
  assert.equal(el('connect').disabled, false);
  assert.equal(el('stop').disabled, false);
});
