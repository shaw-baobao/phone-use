import { mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { pluginFiles } from './stage.mjs';
import { checkVersion } from './check-version.mjs';
const rootUrl = new URL('../', import.meta.url), root = fileURLToPath(rootUrl);
const version = await checkVersion(rootUrl);
const name = `phone-use-${version}`, output = join(root, 'release'), stage = join(output, name);
// Only this version's generated directory and archives are replaced.
await rm(stage, { recursive: true, force: true });
const files = [...pluginFiles, '.agents/plugins/marketplace.json', 'scripts/install.mjs', 'scripts/stage.mjs'];
for (const file of files) { const target = join(stage, file); await mkdir(join(target, '..'), {recursive:true}); await copyFile(join(root,file),target); }
await writeFile(join(stage,'package.json'), JSON.stringify({name:'phone-use', version, description:'Phone Use prebuilt Codex plugin', type:'module',private:true,license:'MIT',engines:{node:'>=22'},scripts:{'install:codex':'node scripts/install.mjs',start:'node dist/server.mjs',preview:'node dist/server.mjs --preview'}},null,2)+'\n');
for (const [extension, args] of [['tar.gz',['-czf',`${name}.tar.gz`,name]],['zip',['-qr',`${name}.zip`,name]]]) {
  await rm(join(output,`${name}.${extension}`),{force:true});
  const result = spawnSync(extension === 'zip' ? 'zip' : 'tar',args,{cwd:output,stdio:'inherit',shell:false});
  if(result.error) throw result.error; if(result.status !== 0) throw new Error(`Failed to create ${extension}`);
}
let sums=''; for(const extension of ['tar.gz','zip']) { const file=`${name}.${extension}`; const hash=createHash('sha256').update(await readFile(join(output,file))).digest('hex'); sums+=`${hash}  ${file}\n`; }
await writeFile(join(output,'SHA256SUMS'),sums);
console.log(`Packaged release/${name}.{zip,tar.gz} and SHA256SUMS`);
