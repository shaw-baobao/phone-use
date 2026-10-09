import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Controller } from './core.mjs';
import { version, resourceUri } from '../shared/version.mjs';

const controller = new Controller();
const uri = resourceUri;
const html = () => readFile(new URL('../assets/panel.html', import.meta.url), 'utf8');
const point = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict();
const actionShape = { action: z.enum(['tap', 'longpress', 'swipe', 'text', 'home', 'launch']), point: point.optional(), from: point.optional(), to: point.optional(), duration: z.number().int().min(100).max(2000).optional(), text: z.string().min(1).max(4000).optional(), bundleId: z.string().max(200).optional(), session: z.string().max(100).optional(), frameSeq: z.number().int().nonnegative().optional() };
const actionSchema = z.object(actionShape).strict();
const uiMeta = { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: false }, 'openai/ui': { availableDisplayModes: ['fullscreen'], preferredDisplayMode: 'fullscreen' } };
function result(data) {
  const { frame, observationFrame, ...summary } = data;
  return { content: [{ type: 'text', text: JSON.stringify(summary) }], structuredContent: observationFrame ? summary : data, ...(observationFrame ? { content: [{ type: 'text', text: JSON.stringify(summary) }, { type: 'image', data: observationFrame.data, mimeType: observationFrame.mimeType }] } : {}) };
}
function guarded(fn) { return async args => { try { return result(await fn(args)); } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; } }; }

const handlers = {
  phone_open: async ({ deviceId }) => deviceId ? controller.connect(deviceId) : { ...controller.state(), devices: await controller.devices() },
  phone_frame: async ({ after = -1 }) => controller.poll(after),
  phone_connect: async ({ deviceId }) => controller.connect(deviceId),
  phone_mode: async ({ mode }) => controller.setMode(mode),
  phone_pause: async ({ paused }) => controller.pause(paused),
  phone_stop: async ({ automation = false }) => controller.stop(automation),
  phone_input: async args => controller.action(args, 'manual'),
  phone_action: async args => controller.action(args, 'ai'),
  phone_observe: async () => ({ tree: await controller.observe(), viewport: controller.viewport(), observationFrame: controller.state().live ? controller.frame : null }),
  phone_devices: async () => ({ devices: await controller.devices() }),
};
const schemas = {
  phone_open: z.object({ deviceId: z.string().optional() }).strict(),
  phone_frame: z.object({ after: z.number().int().min(-1).optional() }).strict(),
  phone_connect: z.object({ deviceId: z.string() }).strict(),
  phone_mode: z.object({ mode: z.enum(['manual', 'ai']) }).strict(),
  phone_pause: z.object({ paused: z.boolean() }).strict(),
  phone_stop: z.object({ automation: z.boolean().optional() }).strict(),
  phone_input: actionSchema, phone_action: actionSchema,
  phone_observe: z.object({}).strict(), phone_devices: z.object({}).strict(),
};
const appOnly = new Set(['phone_frame', 'phone_connect', 'phone_mode', 'phone_pause', 'phone_input']);
const descriptions = {
  phone_open: 'Open the interactive Phone Use panel. List devices first, then choose the user-requested exact device ID. Starting a device requires an installed MobileCLI agent. Control starts in manual mode.',
  phone_devices: 'List connected devices. Never guess an ID or control a different device.',
  phone_action: 'Control the selected device only after the user enables AI control in the panel. Coordinates are normalized 0–1 over the current screen. Inspect phone_observe first; actions are serialized with manual input and are never replayed after errors. Completion is command acceptance; verify the final result separately. Do not perform financial transactions or enter credentials without the required user authorization.',
  phone_observe: 'Read the selected device UI tree through MobileCLI. Paused capture blocks observation. Do not read credentials during user authentication.',
  phone_stop: 'Disconnect the panel and stop its stream. automation=true also terminates the selected iOS DeviceKit runner; does not uninstall apps or stop the shared MobileCLI daemon.',
};
if (process.argv.includes('--preview')) {
  // Optional localhost preview uses the exact same controller. No external listener, CORS, or unauthenticated input API.
  const token = randomBytes(32).toString('hex');
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    const host = `127.0.0.1:${server.address().port}`;
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== `http://${host}`)) { res.writeHead(403).end(); return; }
    if (req.method === 'GET' && req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(await html()); return; }
    const supplied = Buffer.from(String(req.headers['x-panel-token'] || ''));
    if (req.method !== 'POST' || req.url !== '/api' || supplied.length !== token.length || !timingSafeEqual(supplied, Buffer.from(token))) { res.writeHead(403).end(); return; }
    try {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 16000) throw new Error('Request too large'); }
      const { name, arguments: args = {} } = JSON.parse(body);
      if (!Object.hasOwn(handlers, name)) throw new Error('Unknown tool');
      const data = await handlers[name](schemas[name].parse(args));
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data));
    } catch (error) { res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error.message })); }
  });
  server.listen(Number(process.env.PHONE_USE_PORT || 4318), '127.0.0.1', () => console.error(`http://127.0.0.1:${server.address().port}/#${token}`));
} else {
  const server = new McpServer({ name: 'phone-use', version });
  registerAppResource(server, 'Phone Use', uri, { _meta: uiMeta }, async () => ({ contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: await html(), _meta: uiMeta }] }));
  for (const [name, handler] of Object.entries(handlers)) {
    const _meta = name === 'phone_open' ? { ui: { resourceUri: uri }, 'openai/ui': { entrypoints: [{ type: 'thread' }] } } : appOnly.has(name) ? { ui: { visibility: ['app'] } } : {};
    registerAppTool(server, name, { title: name === 'phone_open' ? 'Phone Use' : name, description: descriptions[name] || name, inputSchema: schemas[name].shape, _meta, annotations: { readOnlyHint: ['phone_devices', 'phone_observe', 'phone_frame'].includes(name), openWorldHint: false } }, guarded(handler));
  }
  await server.connect(new StdioServerTransport());
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { controller.close(); process.exit(0); });
process.on('exit', () => controller.close());
