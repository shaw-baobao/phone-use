import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { version } from '../shared/version.mjs';
import { checkVersion } from '../scripts/check-version.mjs';
const root = fileURLToPath(new URL('../',import.meta.url));
function run(command,args,options={}) { const result=spawnSync(command,args,{encoding:'utf8',...options}); assert.equal(result.status,0,result.stderr||result.error?.message); return result.stdout; }
test('tag and plugin versions must match the package',async()=>{assert.equal(await checkVersion(new URL('../',import.meta.url),`v${version}`),version);await assert.rejects(checkVersion(new URL('../',import.meta.url),'v99.0.0'),/Tag must/);});
test('release archives install using a mocked Codex CLI without npm dependencies',async t=>{
  run(process.execPath,['scripts/package.mjs'],{cwd:root});
  const temp=await mkdtemp(join(tmpdir(),'phone-use-package-'));t.after(()=>rm(temp,{recursive:true,force:true}));
  const sums=await readFile(join(root,'release/SHA256SUMS'),'utf8');
  for(const line of sums.trim().split('\n')){const [hash,file]=line.split('  ');assert.equal(createHash('sha256').update(await readFile(join(root,'release',file))).digest('hex'),hash);}
  const tarball=join(root,`release/phone-use-${version}.tar.gz`); const zip=join(root,`release/phone-use-${version}.zip`);
  const listing=run('tar',['-tzf',tarball]);assert.ok(!/node_modules|mobileprovision|\.env/.test(listing));assert.ok(listing.includes('/dist/server.mjs'));assert.ok(listing.includes('/scripts/install.mjs'));
  run('unzip',['-tq',zip]);run('tar',['-xzf',tarball,'-C',temp]);
  const unpacked=join(temp,`phone-use-${version}`);const pkg=JSON.parse(await readFile(join(unpacked,'package.json'),'utf8'));assert.equal(pkg.version,version);assert.equal(pkg.dependencies,undefined);
  const bin=join(temp,'codex');const log=join(temp,'calls.jsonl');
  await writeFile(bin,`#!${process.execPath}\nimport{appendFileSync}from'node:fs';const args=process.argv.slice(2);appendFileSync(process.env.TEST_LOG,JSON.stringify(args)+'\\n');if(args[0]==='plugin'&&args[1]==='add')console.log(JSON.stringify({pluginId:'phone-use@phone-use-local',installedPath:process.env.TEST_STAGE}));else if(args[0]==='plugin')console.log('{}');`,{mode:0o755});
  // ESM mock CLI without an extension uses this fixture package boundary.
  await writeFile(join(temp,'package.json'),' {"type":"module"}');
  run(process.execPath,['scripts/install.mjs'],{cwd:unpacked,env:{...process.env,PATH:`${temp}:${process.env.PATH}`,TEST_LOG:log,TEST_STAGE:join(unpacked,'dist/phone-use')}});
  const calls=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(calls.length,3);assert.deepEqual(calls[2].slice(0,4),['mcp','add','phone_use','--']);assert.equal(calls[2].at(-1),join(unpacked,'dist/phone-use/dist/server.mjs'));
  assert.deepEqual((await readdir(join(unpacked,'dist/phone-use/assets'))).sort(),['THIRD_PARTY_NOTICES.txt','panel.html']);
});
