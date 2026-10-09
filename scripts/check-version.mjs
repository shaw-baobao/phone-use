import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export async function checkVersion(root, tag) {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const plugin = JSON.parse(await readFile(new URL('.codex-plugin/plugin.json', root), 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/.test(pkg.version)) throw new Error('Expected a semantic package version');
  if (plugin.version !== pkg.version) throw new Error('Plugin version must match package.json');
  if (tag !== undefined && tag !== `v${pkg.version}`) throw new Error(`Tag must be v${pkg.version}`);
  return pkg.version;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(await checkVersion(new URL('../', import.meta.url), process.argv[2]));
