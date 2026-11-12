import { toGitHubQuery } from '../public/query.js';
import { DEFAULT_SETTINGS, KEYS } from './config.js';
import { enrichIssue } from './map-pr.js';
import { gnsGet, gnsRequest, gnsSet, itemsOf, unwrapBody } from './gns-runtime.js';
import { listSavedViews, mutateSavedViews, rankSavedViews } from './saved-views-store.js';

const READ_ONLY_MSG = 'Read-only in GNS — open this pull request on GitHub to change it.';

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

async function loadSettings() {
  const raw = await gnsGet(KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
}

async function saveSettings(patch) {
  const next = { ...(await loadSettings()), ...patch, version: 1 };
  if (next.listPageSize < 3 || next.listPageSize > 50) throw new Error('PRs per load must be between 3 and 50.');
  if (!['light', 'balanced', 'full'].includes(next.fieldProfile)) throw new Error('Invalid detail level.');
  await gnsSet(KEYS.settings, next, { merge: 'deep' });
  return next;
}

let viewerLogin = '';

async function loadPulls(searchParams) {
  const settings = await loadSettings();
  const qText = searchParams.get('q') || 'is:open involves:@me sort:updated-desc';
  const q = toGitHubQuery(qText);
  const pageSize = settings.listPageSize;
  const page = Math.max(1, parseInt(searchParams.get('cursor') || '1', 10) || 1);
  const raw = await gnsRequest('gh_search_issues', {
    q,
    per_page: String(pageSize),
    page: String(page),
  }, searchParams.get('refresh') === '1' ? { refresh: true } : undefined);
  const body = unwrapBody(raw);
  const issues = itemsOf(raw);
  const total = typeof body.total_count === 'number' ? body.total_count : issues.length;
  if (!viewerLogin) {
    const u = unwrapBody(await gnsRequest('gh_authenticated_user'));
    viewerLogin = u.login || u?.[0]?.login || '';
  }
  const profile = settings.fieldProfile || 'balanced';
  const items = [];
  const batch = 4;
  for (let i = 0; i < issues.length; i += batch) {
    const chunk = issues.slice(i, i + batch);
    const mapped = await Promise.all(chunk.filter((it) => it.pull_request).map((it) => enrichIssue(it, profile, viewerLogin, gnsRequest)));
    items.push(...mapped);
  }
  const limited = total > 1000;
  return {
    viewer: viewerLogin,
    total,
    limited,
    pageInfo: {
      hasNextPage: page * pageSize < Math.min(total, 1000),
      endCursor: String(page + 1),
    },
    items,
  };
}

async function membership() {
  const orgRaw = await gnsRequest('gh_user_orgs');
  const orgs = itemsOf(orgRaw).map((o) => o.login).filter(Boolean);
  const repoRaw = await gnsRequest('gh_user_repos', { per_page: '100' });
  const repos = itemsOf(repoRaw).map((r) => r.full_name).filter(Boolean);
  return { organizations: orgs, repositories: repos, limited: { organizations: false, repositories: repos.length >= 100 } };
}

async function routeRequest(url, init = {}) {
  const u = new URL(url, 'https://gns.local');
  const method = (init.method || 'GET').toUpperCase();
  if (method === 'PATCH' || (method === 'POST' && u.pathname.startsWith('/api/pulls'))) {
    return jsonResponse({ error: READ_ONLY_MSG }, 403);
  }
  if (method === 'POST' && u.pathname === '/auth/logout') {
    return jsonResponse({ ok: true });
  }
  if (u.pathname === '/api/session' && method === 'GET') {
    return jsonResponse({ mode: 'local', authenticated: true, readOnly: true, version: { label: 'gns-inbox' } });
  }
  if (u.pathname === '/api/settings') {
    if (method === 'GET') return jsonResponse({ settings: await loadSettings() });
    if (method === 'POST') {
      const input = JSON.parse(init.body || '{}');
      return jsonResponse({ settings: await saveSettings(input) });
    }
  }
  if (u.pathname === '/api/membership' && method === 'GET') {
    return jsonResponse(await membership());
  }
  if (u.pathname === '/api/repositories' && method === 'GET') {
    const m = await membership();
    return jsonResponse({ repositories: m.repositories, limited: m.limited.repositories });
  }
  if (u.pathname === '/api/pulls' && method === 'GET') {
    return jsonResponse(await loadPulls(u.searchParams));
  }
  if (u.pathname === '/api/saved-views') {
    if (!viewerLogin) {
      const user = unwrapBody(await gnsRequest('gh_authenticated_user'));
      viewerLogin = user.login || '';
    }
    if (method === 'GET') {
      return jsonResponse({ account: viewerLogin, views: rankSavedViews(await listSavedViews(viewerLogin)) });
    }
    if (method === 'POST') {
      const input = JSON.parse(init.body || '{}');
      if (input.account && input.account !== viewerLogin) {
        return jsonResponse({ error: 'GitHub account changed. Reopen Views and try again.' }, 409);
      }
      const views = await mutateSavedViews(viewerLogin, input);
      return jsonResponse({ account: viewerLogin, views: rankSavedViews(views) });
    }
  }
  if (['/api/pulls/status', '/api/pulls/readiness', '/api/pulls/review-counts', '/api/updates', '/api/events'].includes(u.pathname)) {
    return jsonResponse(u.pathname.endsWith('review-counts') ? {} : { items: [] });
  }
  if (u.pathname === '/api/pulls/reviewers') {
    return jsonResponse({ suggestions: [] });
  }
  return jsonResponse({ error: 'Not found' }, 404);
}

export function installGnsFetch() {
  document.body.classList.add('gns-read-only');
  globalThis.__GNS_READ_ONLY__ = true;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url;
    if (typeof url === 'string' && url.startsWith('/')) {
      return routeRequest(url, init || {});
    }
    return nativeFetch(input, init);
  };
}
