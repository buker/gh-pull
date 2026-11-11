import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitHub } from '../github.js';
import { createApp } from '../server.js';

test('membership lists organizations and repositories for the viewer', async () => {
  const list = createGitHub({ getToken: async () => 'test', fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.query.includes('organizations')) {
      return Response.json({ data: { viewer: { organizations: { pageInfo: { hasNextPage: false }, nodes: [{ login: 'ChessCom' }] } } } });
    }
    return Response.json({ data: { viewer: { repositories: { pageInfo: { hasNextPage: false }, nodes: [{ nameWithOwner: 'ChessCom/clusters' }] } } } });
  } });
  assert.deepEqual(await list.membership(), {
    organizations: ['ChessCom'],
    repositories: ['ChessCom/clusters'],
    limited: { organizations: false, repositories: false },
  });
});

test('/api/membership returns cached membership scope', async t => {
  const list = { membership: async () => ({ organizations: ['ChessCom'], repositories: ['ChessCom/a'], limited: { organizations: false, repositories: false } }) };
  const app = createApp({ list });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { app.close(resolve); app.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${app.address().port}`;
  const response = await fetch(`${origin}/api/membership`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).organizations, ['ChessCom']);
});
