import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir, copyFile, access, rm } from 'node:fs/promises';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
await access(join(root, 'dist/server.mjs'));
const stage = join(root, 'dist/phone-use');
await rm(stage, { recursive: true, force: true });
for (const file of ['.codex-plugin/plugin.json', '.mcp.json', 'dist/server.mjs', 'assets/panel.html', 'assets/THIRD_PARTY_NOTICES.txt', 'README.md', 'LICENSE']) {
  const target = join(stage, file); await mkdir(join(target, '..'), { recursive: true }); await copyFile(join(root, file), target);
}
function codex(args, capture = false) {
  const result = spawnSync('codex', args, { encoding: 'utf8', stdio: capture ? ['ignore','pipe','inherit'] : 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Codex command failed: ${args.slice(0,3).join(' ')}`);
  return result.stdout;
}
codex(['plugin','marketplace','add',root,'--json']);
const installation = JSON.parse(codex(['plugin','add','phone-use@phone-use-local','--json'], true));
if (installation.pluginId !== 'phone-use@phone-use-local' || !installation.installedPath) throw new Error('Unexpected plugin installation result');
const server = join(installation.installedPath, 'dist/server.mjs'); await access(server);
// Same MCP name as the plugin: the explicit config takes precedence and keeps one tool namespace.
codex(['mcp','add','phone_use','--',process.execPath,server]);
console.log('Installed Phone Use. Reconnect Codex and ask to open Phone Use.');
