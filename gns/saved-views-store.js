import { normalizeQuery } from '../public/query.js';

function uuid() {
  return globalThis.crypto?.randomUUID?.() || `v-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
import { KEYS } from './config.js';
import { gnsGet, gnsSet } from './gns-runtime.js';

export function rankSavedViews(views, now = Date.now()) {
  const boost = (timestamp, weight, halfLife) => (timestamp ? weight * 2 ** (-Math.max(0, (now - Date.parse(timestamp)) / 86400000) / halfLife) : 0);
  const entries = views.map((view) => {
    const h = {
      loadCount: Number.isSafeInteger(view.loadCount) && view.loadCount >= 0 ? view.loadCount : 0,
      createdAt: view.createdAt,
      lastEditedAt: view.lastEditedAt,
      lastLoadedAt: view.lastLoadedAt,
    };
    return {
      view,
      count: h.loadCount,
      score: Math.log2(1 + h.loadCount) + boost(h.createdAt, 3, 7) + boost(h.lastEditedAt, 2, 3) + boost(h.lastLoadedAt, 4, 2),
    };
  });
  const favorites = entries.filter((e) => e.count > 0).sort((a, b) => b.count - a.count).slice(0, 2);
  return [...favorites, ...entries.filter((e) => !favorites.includes(e)).sort((a, b) => b.score - a.score)].map((e) => e.view);
}

async function readStore() {
  const data = await gnsGet(KEYS.savedViews);
  if (data && data.version === 1 && Array.isArray(data.accounts)) return data;
  return { version: 1, accounts: [] };
}

async function writeStore(data) {
  await gnsSet(KEYS.savedViews, data, { merge: 'shallow' });
}

function normalizeName(name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw new Error('Use a view name of 1–80 characters.');
  return name.trim();
}

export async function listSavedViews(account) {
  const data = await readStore();
  return data.accounts.find((a) => a.login === account.toLowerCase())?.views ?? [];
}

export async function mutateSavedViews(account, input) {
  if (!input || !['save', 'rename', 'update', 'delete', 'restore', 'load'].includes(input.action)) {
    throw new Error('Invalid saved view action.');
  }
  const login = account.toLowerCase();
  const data = await readStore();
  let entry = data.accounts.find((a) => a.login === login);
  if (!entry) {
    entry = { login, views: [] };
    data.accounts.push(entry);
  }
  const views = entry.views;
  const { action, id } = input;
  const now = () => new Date().toISOString();
  let name;
  let query;
  let group;
  if (action === 'save' || action === 'rename' || action === 'restore') name = normalizeName(input.name);
  if (action === 'save' || action === 'update' || action === 'restore') {
    group = input.group ?? 'repo';
    if (!['repo', 'author', 'status', 'checks', 'none'].includes(group)) throw new Error('Invalid grouping.');
    query = normalizeQuery(input.query);
  }
  const view = views.find((v) => v.id === id);
  if (!['save', 'restore'].includes(action) && !view) throw new Error('This saved view no longer exists. Reload the page to refresh saved views.');
  if (action === 'save' || action === 'restore') {
    if (views.length >= 100) throw new Error('You can save up to 100 views.');
    if (action === 'restore') {
      views.splice(Math.min(input.position, views.length), 0, { id, name, query, group, loadCount: 0, createdAt: now(), lastEditedAt: null, lastLoadedAt: null });
    } else {
      views.push({ id: uuid(), name, query, group, loadCount: 0, createdAt: now(), lastEditedAt: null, lastLoadedAt: null });
    }
  } else if (action === 'rename') view.name = name;
  else if (action === 'update') {
    if (view.query !== query || (view.group ?? 'repo') !== group) view.lastEditedAt = now();
    Object.assign(view, { query, group });
  } else if (action === 'load') {
    view.loadCount = Math.min(Number.MAX_SAFE_INTEGER, (view.loadCount ?? 0) + 1);
    view.lastLoadedAt = now();
  } else views.splice(views.indexOf(view), 1);
  await writeStore(data);
  return views;
}
