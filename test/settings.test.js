import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPullRequestFields, createSettingsStore, DEFAULT_SETTINGS, normalizeSettings } from '../settings.js';
import { createApp } from '../server.js';

describe('settings', () => {
  it('normalizes page size bounds', () => {
    assert.deepEqual(normalizeSettings({ listPageSize: 25 }), { ...DEFAULT_SETTINGS, listPageSize: 25 });
    assert.throws(() => normalizeSettings({ listPageSize: 2 }), /3 to 50/);
    assert.throws(() => normalizeSettings({ fieldProfile: 'huge' }), /full, balanced, or light/);
  });

  it('builds lighter GraphQL for balanced profile', () => {
    const full = buildPullRequestFields({ ...DEFAULT_SETTINGS, fieldProfile: 'full' });
    const light = buildPullRequestFields({ ...DEFAULT_SETTINGS, fieldProfile: 'light' });
    assert.match(full, /reviewRequests\(first: 100\)/);
    assert.match(light, /reviewRequests\(first: 10\)/);
  });
});

describe('/api/settings', () => {
  let dir;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'gh-pull-settings-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('reads and updates persisted settings', async () => {
    const path = join(dir, 'settings.json');
    const store = createSettingsStore(path);
    const server = createApp({ settingsStore: store, list: async () => ({ viewer: 'me', total: 0, items: [] }) });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const origin = `http://127.0.0.1:${port}`;
    try {
      const get = await fetch(`${origin}/api/settings`);
      assert.equal(get.status, 200);
      assert.deepEqual((await get.json()).settings, { ...DEFAULT_SETTINGS });
      const patch = await fetch(`${origin}/api/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify({ listPageSize: 15, fieldProfile: 'light' }),
      });
      assert.equal(patch.status, 200);
      assert.deepEqual((await patch.json()).settings, { version: 1, listPageSize: 15, fieldProfile: 'light' });
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});
