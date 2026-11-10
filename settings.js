import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';
import { ApiError } from './github-client.js';

export const SETTINGS_VERSION = 1;

/** @typedef {{ version: number, listPageSize: number, fieldProfile: 'full' | 'balanced' | 'light' }} GhPullSettings */

export const DEFAULT_SETTINGS = Object.freeze({
  version: SETTINGS_VERSION,
  listPageSize: 25,
  fieldProfile: 'balanced',
});

const FIELD_PROFILES = {
  full: { reviewRequests: 100, latestReviews: 100, closingIssues: 20 },
  balanced: { reviewRequests: 30, latestReviews: 30, closingIssues: 10 },
  light: { reviewRequests: 10, latestReviews: 10, closingIssues: 5 },
};

export function fieldProfileLimits(profile) {
  return FIELD_PROFILES[profile] ?? FIELD_PROFILES.balanced;
}

export function normalizeSettings(input = {}) {
  const listPageSize = Number(input.listPageSize ?? DEFAULT_SETTINGS.listPageSize);
  if (!Number.isInteger(listPageSize) || listPageSize < 3 || listPageSize > 50) {
    throw new Error('List page size must be an integer from 3 to 50.');
  }
  const fieldProfile = input.fieldProfile ?? DEFAULT_SETTINGS.fieldProfile;
  if (!FIELD_PROFILES[fieldProfile]) throw new Error('Field profile must be full, balanced, or light.');
  return { version: SETTINGS_VERSION, listPageSize, fieldProfile };
}

const mergeFields = `viewerCanMergeAsAdmin headRefOid mergeable mergeStateStatus mergeQueue { id } stackEntry { id }
  repository { nameWithOwner viewerPermission viewerDefaultMergeMethod mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed }`;

/** GraphQL selection set for list rows; size drives GitHub gateway timeouts. */
export function buildPullRequestFields(settings = DEFAULT_SETTINGS) {
  const { reviewRequests, latestReviews, closingIssues } = fieldProfileLimits(settings.fieldProfile);
  return `viewerCanClose viewerCanReopen id number title url state isDraft createdAt updatedAt headRefName baseRefName
  headRepository { nameWithOwner }
  author { login } repository { nameWithOwner defaultBranchRef { name } }
  ${mergeFields}
  additions deletions changedFiles totalCommentsCount reviewDecision
  closingIssuesReferences(first: ${closingIssues}) {
    totalCount pageInfo { hasNextPage }
    nodes { number title url state repository { nameWithOwner } }
  }
  reviewRequests(first: ${reviewRequests}) {
    pageInfo { hasNextPage }
    nodes { requestedReviewer {
      __typename
      ... on Actor { login }
      ... on Team { slug organization { login } }
      ... on EnterpriseTeam { name }
    } }
  }
  latestReviews(first: ${latestReviews}) {
    pageInfo { hasNextPage }
    nodes { id url author { login __typename } state }
  }
  labels(first: 10) { nodes { name } }
  commits(last: 1) { nodes { commit { statusCheckRollup {
    state
    contexts {
      totalCount
      checkRunCountsByState { state count }
      statusContextCountsByState { state count }
    }
  } } } }`;
}

export function settingsCacheKey(settings) {
  return `${settings.listPageSize}:${settings.fieldProfile}`;
}

export function createSettingsStore(
  path = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'gh-pull', 'settings.json'),
) {
  let cached = null;
  async function read() {
    if (cached) return cached;
    try {
      const raw = JSON.parse(await readFile(path, 'utf8'));
      cached = normalizeSettings(raw);
      return cached;
    } catch (error) {
      if (error.code === 'ENOENT') {
        cached = { ...DEFAULT_SETTINGS };
        return cached;
      }
      if (error instanceof SyntaxError) throw new ApiError('Settings file is invalid. Fix or delete ~/.config/gh-pull/settings.json.', 500);
      throw error;
    }
  }
  return {
    read,
    async write(patch) {
      const next = normalizeSettings({ ...(await read()), ...patch });
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const release = await lockfile.lock(path, { realpath: false, retries: { retries: 5, minTimeout: 20, maxTimeout: 200 } });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
        await rename(temporary, path);
        cached = next;
        return next;
      } finally {
        await rm(temporary, { force: true });
        await release();
      }
    },
    clearCache() {
      cached = null;
    },
  };
}
