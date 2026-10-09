import { build } from 'esbuild';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
const code = await build({ entryPoints: ['ui/app.mjs'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, write: false, pure: ['console.debug'], legalComments: 'inline' });
const [html, css] = await Promise.all([readFile('ui/index.html', 'utf8'), readFile('ui/style.css', 'utf8')]);
await mkdir('assets', { recursive: true });
await writeFile('assets/panel.html', html.replace('/*__STYLE__*/', () => css).replace('/*__SCRIPT__*/', () => code.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')));
console.log('Built self-contained Phone Use panel.');

await mkdir('dist', { recursive: true });
await build({ entryPoints: ['server/index.mjs'], outfile: 'dist/server.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node22', banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" }, legalComments: 'inline' });
console.log('Built standalone MCP server.');

// Preserve third-party notices alongside the standalone bundles.
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
let notices = 'Phone Use bundles third-party JavaScript packages. Their licenses follow.\n';
for (const path of Object.keys(lock.packages).filter(path => path.startsWith('node_modules/')).sort()) {
  const names = await readdir(path).catch(() => []);
  const files = names.filter(name => /^(license|licence|notice|copying)(\.|$)/i.test(name)).sort();
  for (const file of files) {
    const body = await readFile(`${path}/${file}`, 'utf8').catch(() => null);
    if (body) notices += `\n===== ${path}: ${file} =====\n${body.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '')}\n`;
  }
}
await writeFile('assets/THIRD_PARTY_NOTICES.txt', notices);
