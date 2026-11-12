import { normalizePullRequest } from '../pull-request.js';

function repoFromUrl(repositoryUrl) {
  return String(repositoryUrl || '').replace(/^.*\/repos\//, '');
}

function checksFromStatus(status) {
  if (!status || !status.state) return { checks: 'NONE', checkCounts: null };
  const state = String(status.state).toUpperCase();
  const total = status.total_count ?? 0;
  return {
    checks: total === 0 ? 'NONE' : state,
    checkCounts: total > 0 ? { passed: status.statuses?.filter((s) => s.state === 'success').length ?? 0, total } : null,
  };
}

function reviewsShape(list) {
  const nodes = (list || [])
    .filter((r) => r.state && r.state !== 'PENDING')
    .map((r) => ({
      id: String(r.id),
      state: r.state,
      url: r.html_url,
      author: { login: r.user?.login, __typename: r.user?.type === 'Bot' ? 'Bot' : 'User' },
      submitted_at: r.submitted_at,
    }));
  return { nodes, pageInfo: { hasNextPage: false } };
}

export function fromSearchIssue(issue, viewerLogin) {
  const repo = repoFromUrl(issue.repository_url);
  const [owner, name] = repo.split('/');
  const shaped = {
    id: issue.node_id || `REST:${repo}#${issue.number}`,
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    state: issue.state === 'open' ? 'OPEN' : 'CLOSED',
    isDraft: Boolean(issue.draft),
    author: { login: issue.user?.login ?? 'unknown' },
    repository: {
      nameWithOwner: repo,
      defaultBranchRef: { name: 'main' },
      mergeCommitAllowed: false,
      squashMergeAllowed: false,
      rebaseMergeAllowed: false,
      viewerPermission: 'READ',
    },
    headRefName: issue.pull_request?.head?.ref ?? '',
    baseRefName: issue.pull_request?.base?.ref ?? '',
    headRepository: { nameWithOwner: issue.pull_request?.head?.repo?.full_name ?? repo },
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    additions: 0,
    deletions: 0,
    changedFiles: null,
    totalCommentsCount: issue.comments ?? 0,
    reviewDecision: 'NONE',
    latestReviews: { nodes: [], pageInfo: { hasNextPage: false } },
    reviewRequests: { nodes: [], pageInfo: { hasNextPage: false } },
    commits: { nodes: [{ commit: { oid: issue.pull_request?.head?.sha ?? '', statusCheckRollup: null } }] },
    labels: { nodes: (issue.labels || []).map((l) => ({ name: l.name })) },
    closingIssuesReferences: { nodes: [], totalCount: 0, pageInfo: { hasNextPage: false } },
    viewerCanMergeAsAdmin: false,
    viewerCanClose: false,
    viewerCanReopen: false,
    mergeable: 'UNKNOWN',
    mergeStateStatus: 'UNKNOWN',
    headRefOid: issue.pull_request?.head?.sha ?? null,
  };
  return normalizePullRequest(shaped, viewerLogin);
}

export function fromRestPull(pull, reviews, status, viewerLogin) {
  const repo = pull.base?.repo?.full_name ?? `${pull.base?.user?.login}/${pull.base?.repo?.name}`;
  const { checks, checkCounts } = checksFromStatus(status);
  const reviewDecision = pull.requested_reviewers?.length || pull.requested_teams?.length ? 'REVIEW_REQUIRED' : 'NONE';
  const shaped = {
    id: pull.node_id || `REST:${repo}#${pull.number}`,
    number: pull.number,
    title: pull.title,
    url: pull.html_url,
    state: pull.state === 'open' ? (pull.draft ? 'OPEN' : 'OPEN') : 'CLOSED',
    isDraft: Boolean(pull.draft),
    merged: pull.merged,
    author: { login: pull.user?.login ?? 'unknown' },
    repository: {
      nameWithOwner: repo,
      defaultBranchRef: { name: pull.base?.repo?.default_branch ?? 'main' },
      mergeCommitAllowed: false,
      squashMergeAllowed: false,
      rebaseMergeAllowed: false,
      viewerPermission: 'READ',
    },
    headRefName: pull.head?.ref ?? '',
    baseRefName: pull.base?.ref ?? '',
    headRepository: { nameWithOwner: pull.head?.repo?.full_name ?? repo },
    createdAt: pull.created_at,
    updatedAt: pull.updated_at,
    additions: pull.additions ?? 0,
    deletions: pull.deletions ?? 0,
    changedFiles: pull.changed_files ?? null,
    totalCommentsCount: pull.comments ?? null,
    reviewDecision,
    latestReviews: reviewsShape(reviews),
    reviewRequests: {
      nodes: (pull.requested_reviewers || []).map((u) => ({ requestedReviewer: { login: u.login, __typename: 'User' } })),
      pageInfo: { hasNextPage: false },
    },
    commits: {
      nodes: [{
        commit: {
          oid: pull.head?.sha ?? '',
          statusCheckRollup: checks !== 'NONE' ? { state: checks, contexts: checkCounts ? { totalCount: checkCounts.total } : {} } : null,
        },
      }],
    },
    labels: { nodes: (pull.labels || []).map((l) => ({ name: l.name })) },
    closingIssuesReferences: { nodes: [], totalCount: 0, pageInfo: { hasNextPage: false } },
    viewerCanMergeAsAdmin: false,
    viewerCanClose: false,
    viewerCanReopen: false,
    mergeable: pull.mergeable ? 'MERGEABLE' : pull.mergeable === false ? 'CONFLICTING' : 'UNKNOWN',
    mergeStateStatus: (pull.mergeable_state || 'unknown').toUpperCase(),
    headRefOid: pull.head?.sha ?? null,
  };
  const pr = normalizePullRequest(shaped, viewerLogin);
  pr.checkCounts = checkCounts;
  return pr;
}

export async function enrichIssue(issue, profile, viewerLogin, api) {
  if (profile === 'light') return fromSearchIssue(issue, viewerLogin);
  const repo = repoFromUrl(issue.repository_url);
  const [owner, name] = repo.split('/');
  const [pullRaw, reviewsRaw] = await Promise.all([
    api('gh_pull', { owner, repo: name, pull_number: String(issue.number) }),
    api('gh_pr_reviews', { owner, repo: name, pull_number: String(issue.number) }),
  ]);
  const pull = unwrapPull(pullRaw);
  let status = null;
  if (profile === 'full' && pull.head?.sha) {
    try {
      status = unwrapPull(await api('gh_commit_status', { owner, repo: name, sha: pull.head.sha }));
    } catch { /* optional */ }
  }
  const reviews = Array.isArray(reviewsRaw) ? reviewsRaw : (reviewsRaw?.body ?? reviewsRaw);
  const revList = Array.isArray(reviews) ? reviews : reviews?.items ?? itemsOf(reviewsRaw);
  return fromRestPull(pull, revList, status, viewerLogin);
}

function unwrapPull(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  if (raw.body && typeof raw.body === 'object') return raw.body;
  if (raw.data && typeof raw.data === 'object') return raw.data;
  return raw;
}

function itemsOf(response) {
  const b = response?.body ?? response?.data ?? response;
  if (Array.isArray(b?.items)) return b.items;
  if (Array.isArray(b)) return b;
  return [];
}
