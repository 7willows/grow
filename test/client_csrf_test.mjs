import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('RPC sends the page CSRF token and never sends a stored session', async () => {
  let request;
  let token = 'page-token';
  const removed = [];
  const sandbox = {
    window: {},
    document: { querySelector: () => ({ content: token }) },
    localStorage: { getItem: () => 'stale-session', removeItem: (key) => removed.push(key) },
    fetch: async (url, options) => {
      request = { url, ...options };
      return { status: 200, text: async () => JSON.stringify({ result: 42 }) };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), sandbox);
  assert.deepEqual(removed, ['sessionId']);
  sandbox.grow = sandbox.window.grow;
  sandbox.grow.urlPrefix = '/repliker';
  assert.equal(await sandbox.grow.plant('Example').write('value'), 42);
  assert.equal(request.headers['grow-csrf-token'], 'page-token');
  assert.equal(request.headers['grow-session-id'], undefined);
  assert.equal(request.url, '/repliker/example/write');
  token = 'refreshed-token';
  await sandbox.grow.plant('Example', { keepalive: true }).write();
  assert.equal(request.headers['grow-csrf-token'], 'refreshed-token');
  assert.equal(request.keepalive, true);
});
