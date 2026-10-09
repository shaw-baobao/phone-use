import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('local preview rejects missing tokens, foreign origins and invalid input', async t => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/server.mjs',import.meta.url)), '--preview'], {env:{...process.env,PHONE_USE_PORT:'0'},stdio:['ignore','ignore','pipe']});
  t.after(() => child.kill('SIGTERM'));
  const url = await new Promise((resolve,reject) => { const timer=setTimeout(()=>reject(new Error('Preview startup timed out')),5000); child.once('error',reject); child.stderr.on('data', b=>{const match=b.toString().match(/http:\/\/127\.0\.0\.1:\d+\/#\w+/);if(match){clearTimeout(timer);resolve(new URL(match[0]));}}); });
  const headers = {'Content-Type':'application/json','X-Panel-Token':url.hash.slice(1)}; const endpoint=`${url.origin}/api`;
  assert.equal((await fetch(endpoint,{method:'POST',body:'{}'})).status,403);
  assert.equal((await fetch(endpoint,{method:'POST',headers:{...headers,Origin:'https://example.com'},body:'{}'})).status,403);
  assert.equal((await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({name:'phone_action',arguments:{action:'tap',point:{x:2,y:0}}})})).status,400);
  const result = await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({name:'phone_frame',arguments:{after:-1}})}); assert.equal(result.status,200); const state=await result.json(); assert.equal(state.device,null); assert.equal(state.live,false);
});
