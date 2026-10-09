import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Controller, JpegParser, jpegSize, mapPoint } from '../server/core.mjs';
import { imagePoint } from '../ui/geometry.mjs';
const jpeg = (w, h) => Buffer.from([255,216,255,192,0,8,8,h>>8,h&255,w>>8,w&255,0,255,217]);
function fixture(t) {
  let clock = 10000; const calls = []; const children = [];
  const run = async args => { calls.push(args); if (args[0] === 'devices') return { devices: [{ id: 'test', state: 'online', platform: 'ios', name: 'Test' }] }; if (args[0] === 'device') return { device: { screenSize: { width: 420, height: 912 } } }; if (args[0] === 'agent') return { agent: { bundleId: 'test.runner' } }; return {}; };
  const c = new Controller({ run, now: () => clock, launch: () => { const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = { resume() {} }; child.kill = () => { child.killed = true; }; children.push(child); return child; } });
  t.after(() => c.close());
  return { c, calls, children, advance: n => clock += n, frame: (w = 210, h = 456) => children.at(-1).stdout.emit('data', jpeg(w,h)) };
}
test('MJPEG parser handles arbitrary chunk boundaries and skips multipart headers', () => {
  const frames = []; const parser = new JpegParser(bytes => frames.push(Buffer.from(bytes)));
  const bytes = Buffer.concat([Buffer.from('--boundary\r\n'), jpeg(210,456), Buffer.from('\r\n--boundary\r\n'), jpeg(456,210)]);
  for (const byte of bytes) parser.feed(Buffer.from([byte]));
  assert.equal(frames.length, 2); assert.deepEqual(jpegSize(frames[0]), { width:210,height:456 }); assert.deepEqual(jpegSize(frames[1]), { width:456,height:210 });
});
test('oversized MJPEG data is discarded and parsing recovers', () => {
  const frames = []; const parser = new JpegParser(b => frames.push(b), 30);
  parser.feed(Buffer.concat([Buffer.from([255,216]), Buffer.alloc(60)])); parser.feed(jpeg(20,40)); assert.equal(frames.length,1); assert.ok(parser.buffer.length <= 30);
});
test('image coordinates exclude letterboxes and map boundaries correctly', () => {
  const rect = { left:10, top:20, width:400, height:400 }, size = { width:200, height:400 };
  assert.equal(imagePoint(20,200,rect,size),null); assert.deepEqual(imagePoint(210,220,rect,size),{x:0.5,y:0.5});
  assert.deepEqual(mapPoint({x:1,y:0},{width:420,height:912}),[419,0]); assert.throws(() => mapPoint({x:-1,y:0},size)); assert.throws(() => mapPoint(undefined,size));
});
test('manual controls require a recent displayed frame and exact session; text is a literal argument', async t => {
  const f = fixture(t); await f.c.connect('test'); f.c.poll(); f.frame();
  const auth = { session:f.c.session, frameSeq:f.c.seq };
  await assert.rejects(f.c.action({action:'home', ...auth, session:'old'}));
  await f.c.action({action:'tap', point:{x:0.5,y:0.5}, ...auth}); assert.deepEqual(f.calls.at(-1), ['io','tap','--device','test','210,456']);
  const text = '$(touch /tmp/nope) `echo secret` --foo'; await f.c.action({action:'text',text,...auth}); assert.deepEqual(f.calls.at(-1),['io','text','--device','test','--',text]);
  f.advance(2600); f.frame(); await assert.rejects(f.c.action({action:'home', ...auth}));
});
test('ownership change cancels queued actions; commands never overlap', async t => {
  const f = fixture(t); await f.c.connect('test'); f.c.setMode('ai');
  let release; const gate = new Promise(resolve => { release=resolve; }); let running=0,max=0,count=0;
  f.c.run = async () => { running++; max=Math.max(max,running); count++; await gate; running--; };
  const first = f.c.action({action:'home'},'ai'); await new Promise(resolve => setImmediate(resolve));
  const second = f.c.action({action:'home'},'ai'); f.c.setMode('manual'); release(); await first; await assert.rejects(second,/Control changed/); assert.equal(max,1); assert.equal(count,1);
});
test('rotation invalidates a gesture session and swaps logical dimensions', async t => {
  const f = fixture(t); await f.c.connect('test'); f.c.poll(); f.frame(); const auth = {session:f.c.session,frameSeq:f.c.seq}; f.frame(456,210);
  assert.deepEqual(f.c.viewport(),{width:912,height:420}); assert.notEqual(auth.session,f.c.session); await assert.rejects(f.c.action({action:'home',...auth}));
});
test('pause stops capture; stop automation terminates only the selected runner', async t => {
  const f = fixture(t); await f.c.connect('test'); f.c.poll(); f.frame(); f.c.pause(true); assert.equal(f.children.at(-1).killed,true); assert.equal(f.c.state().frame,null);
  await assert.rejects(f.c.observe()); const result = await f.c.stop(true); assert.equal(result.automationStopped,true); assert.deepEqual(f.calls.at(-1), ['apps','terminate','test.runner','--device','test']); assert.equal(f.c.device,null);
});
test('failed action is not retried automatically', async t => {
  const f = fixture(t); await f.c.connect('test'); f.c.setMode('ai'); let n=0; f.c.run = async () => { n++; throw new Error('connection dropped'); }; await assert.rejects(f.c.action({action:'home'},'ai')); assert.equal(n,1);
});
test('stopping during device discovery cancels connection without controlling a new device', async t => {
  const f = fixture(t); let release;
  f.c.run = async args => { if(args[0]==='devices') await new Promise(resolve=>{release=resolve;}); if(args[0]==='devices')return {devices:[{id:'test',state:'online',platform:'ios'}]}; return {device:{screenSize:{width:420,height:912}}}; };
  const connect = f.c.connect('test'); await new Promise(resolve=>setImmediate(resolve)); const stopped=f.c.stop(true); release(); await assert.rejects(connect,/Control changed/); assert.equal((await stopped).automationStopped,false); assert.equal(f.c.device,null);
});
