import test from 'node:test';
import assert from 'node:assert/strict';
import { cli } from '../server/core.mjs';
test('CLI cancellation interrupts a pending read and rejects an already cancelled read', async () => {
  const abort = new AbortController();
  const read = cli(['-e', 'setTimeout(() => {}, 10000)'], { binary: process.execPath, signal: abort.signal });
  abort.abort();
  await assert.rejects(read, /Connection cancelled/);
  await assert.rejects(cli(['-e', 'process.exit(1)'], { binary: process.execPath, signal: abort.signal }), /Connection cancelled/);
});
