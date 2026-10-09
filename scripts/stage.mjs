import { mkdir, copyFile, access, rm } from 'node:fs/promises';
import { join } from 'node:path';
export const pluginFiles = ['.codex-plugin/plugin.json', '.mcp.json', 'dist/server.mjs', 'assets/panel.html', 'assets/THIRD_PARTY_NOTICES.txt', 'README.md', 'README.zh-CN.md', 'LICENSE'];
export async function stagePlugin(root, stage) {
  // Check all inputs before replacing our generated staging directory.
  for (const file of pluginFiles) await access(join(root, file));
  await rm(stage, { recursive: true, force: true });
  for (const file of pluginFiles) {
    const target = join(stage, file); await mkdir(join(target, '..'), { recursive: true }); await copyFile(join(root, file), target);
  }
}
