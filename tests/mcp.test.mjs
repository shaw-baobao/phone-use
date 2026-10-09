import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
test('bundled stdio server publishes the interactive resource with app-only manual controls', async t => {
  const client = new Client({name:'phone-use-test',version:'1'});
  const transport = new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../dist/server.mjs',import.meta.url))]});
  t.after(() => client.close()); await client.connect(transport);
  const {tools} = await client.listTools(); const open = tools.find(t => t.name === 'phone_open');
  assert.equal(open._meta.ui.resourceUri,'ui://phone-use/panel-0.1.0.html'); assert.deepEqual(tools.find(t=>t.name==='phone_input')._meta.ui.visibility,['app']);
  const resource = await client.readResource({uri:open._meta.ui.resourceUri}); assert.equal(resource.contents[0].mimeType,'text/html;profile=mcp-app'); assert.match(resource.contents[0].text,/Phone Use/); assert.ok(!resource.contents[0].text.includes('/*__SCRIPT__*/'));
  const denied = await client.callTool({name:'phone_action',arguments:{action:'home'}}); assert.equal(denied.isError,true); assert.match(denied.content[0].text,/Control belongs/);
});
