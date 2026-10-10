import test from 'node:test';
import assert from 'node:assert/strict';
import { bindKeyboard } from '../ui/keyboard.mjs';
const turn = () => new Promise(resolve => setTimeout(resolve, 15));
function fixture(t, send) {
  const handlers = {}, sent = [], errors = [];
  let state = { session: 'one', frameSeq: 4, platform: 'ios', ready: true };
  const element = { value: '', disabled: false, addEventListener(name, fn) { handlers[name] = fn; }, focus() {} };
  const keyboard = bindKeyboard(element, { context: () => state, send: send || (async args => { sent.push(args); }), onError: error => errors.push(error), delay: 1 });
  t.after(keyboard.reset);
  return { element, sent, errors, keyboard, change(value) { state = value; keyboard.update(); }, event(name, values = {}) { let prevented = false; handlers[name]({ preventDefault() { prevented = true; }, ...values }); return prevented; }, text(value) { element.value = value; handlers.input({}); } };
}
test('committed Chinese IME text is sent once, never as preedit', async t => {
  const f = fixture(t); f.event('compositionstart'); f.text('ni'); await turn(); assert.equal(f.sent.length, 0);
  f.element.value = '你好'; f.event('compositionend'); f.event('input'); await turn();
  assert.deepEqual(f.sent, [{ action: 'text', text: '你好', session: 'one', frameSeq: 4 }]);
});
test('fast typing is buffered in order across in-flight commands', async t => {
  let release; const sent = [];
  const f = fixture(t, async args => { sent.push(args); if (sent.length === 1) await new Promise(resolve => { release = resolve; }); });
  f.text('a'); await turn(); f.text('b'); f.text('c'); f.event('keydown', { key: 'Backspace' }); f.text('d'); await turn();
  assert.equal(sent.length, 1); release(); await turn(); await turn(); await turn();
  assert.deepEqual(sent.map(({ action, text, key }) => ({ action, text, key })), [
    { action: 'text', text: 'a', key: undefined }, { action: 'text', text: 'bc', key: undefined },
    { action: 'key', text: undefined, key: 'backspace' }, { action: 'text', text: 'd', key: undefined },
  ]);
});
test('paste remains literal and keyboard shortcuts do not leak to the phone', async t => {
  const f = fixture(t), text = '中文\n$(test) --literal';
  assert.equal(f.event('paste', { clipboardData: { getData: () => text } }), true);
  assert.equal(f.event('keydown', { key: 'v', metaKey: true }), false);
  assert.equal(f.event('keydown', { key: 'r', metaKey: true }), false);
  assert.equal(f.event('keydown', { key: 'a', metaKey: true }), true);
  assert.equal(f.event('keydown', { key: 'ArrowLeft', shiftKey: true }), true);
  await turn(); await turn(); await turn();
  assert.deepEqual(f.sent.map(x => x.text || x.key), [text, 'cmd+a', 'shift+left']);
});
test('ownership, session and focus changes discard unsent input', async t => {
  const f = fixture(t); f.text('old'); f.change(null); await turn(); assert.equal(f.sent.length, 0); assert.equal(f.element.disabled, true);
  f.change({ session: 'two', frameSeq: 5, ready: true }); f.text('new'); f.change({ session: 'three', frameSeq: 6, ready: true }); await turn(); assert.equal(f.sent.length, 0);
  f.text('blurred'); f.event('blur'); await turn(); assert.equal(f.sent.length, 0);
});
test('input waits for a screen tap and never retries a failed command', async t => {
  let calls = 0; const f = fixture(t, async () => { calls++; throw new Error('failed'); });
  f.change({ session: 'one', frameSeq: 4, ready: false }); f.text('wait'); await turn(); assert.equal(calls, 0);
  f.change({ session: 'one', frameSeq: 5, ready: true }); await turn(); await turn();
  assert.equal(calls, 1); assert.deepEqual(f.errors, ['failed']);
});
test('IME navigation does not send keys, and oversized paste is rejected', async t => {
  const f = fixture(t); f.event('compositionstart'); assert.equal(f.event('keydown', { key: 'Enter', isComposing: true }), false);
  f.event('compositionend'); f.event('paste', { clipboardData: { getData: () => 'a'.repeat(4001) } }); await turn();
  assert.equal(f.sent.length, 0); assert.match(f.errors[0], /buffer is full/);
});
test('unfinished IME composition cannot cross a control session', async t => {
  const f = fixture(t); f.event('compositionstart'); f.text('ni');
  f.change({ session: 'two', frameSeq: 5, ready: true });
  f.element.value = '你'; f.event('compositionend'); f.event('input'); await turn();
  assert.equal(f.sent.length, 0);
});
