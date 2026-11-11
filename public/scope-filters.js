import { splitScopeFilters, withScopeFilters } from './query.js';

const $ = id => document.getElementById(id);

export function createScopeFilters({ apiFetch, responseError, getQuery, setQuery, onApply }) {
  const root = $('scope-filters');
  const orgSelect = $('scope-orgs');
  const repoSelect = $('scope-repos');
  const status = $('scope-status');
  let membership = null;

  function fillOptions(select, values, selected) {
    const chosen = new Set(selected.map(v => v.toLowerCase()));
    select.replaceChildren();
    for (const value of values) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      option.selected = chosen.has(value.toLowerCase());
      select.appendChild(option);
    }
  }

  function repoChoices() {
    if (!membership) return [];
    const selectedOrgs = [...orgSelect.selectedOptions].map(o => o.value.toLowerCase());
    if (!selectedOrgs.length) return membership.repositories;
    return membership.repositories.filter(repo => selectedOrgs.includes(repo.split('/')[0].toLowerCase()));
  }

  function syncFromQuery() {
    if (!membership) return;
    const { orgs, repos } = splitScopeFilters(getQuery());
    fillOptions(orgSelect, membership.organizations, orgs);
    fillOptions(repoSelect, repoChoices(), repos);
    updateStatus();
  }

  function updateStatus() {
    const orgCount = orgSelect.selectedOptions.length;
    const repoCount = repoSelect.selectedOptions.length;
  const limits = membership?.limited;
    const limitedNote = limits && (limits.repositories || limits.organizations) ? ' Lists may be partial.' : '';
    status.textContent = orgCount || repoCount
      ? `${orgCount} org${orgCount === 1 ? '' : 's'}, ${repoCount} repo${repoCount === 1 ? '' : 's'} selected.${limitedNote}`
      : `All organizations and repositories.${limitedNote}`;
  }

  orgSelect.addEventListener('change', () => {
    const { repos } = splitScopeFilters(getQuery());
    fillOptions(repoSelect, repoChoices(), repos);
    updateStatus();
  });
  repoSelect.addEventListener('change', updateStatus);

  $('scope-apply').addEventListener('click', () => {
    const orgs = [...orgSelect.selectedOptions].map(o => o.value);
    const repos = [...repoSelect.selectedOptions].map(o => o.value);
    setQuery(withScopeFilters(getQuery(), { orgs, repos }));
    onApply();
  });
  $('scope-clear').addEventListener('click', () => {
    setQuery(withScopeFilters(getQuery(), { orgs: [], repos: [] }));
    syncFromQuery();
    onApply();
  });

  return {
    async load() {
      root.hidden = true;
      status.textContent = 'Loading your organizations and repositories…';
      try {
        const response = await apiFetch('/api/membership', { signal: AbortSignal.timeout(35_000) });
        const data = await response.json();
        if (!response.ok) throw responseError(response, data, 'Could not load membership scope.');
        membership = data;
        root.hidden = !membership.organizations.length && !membership.repositories.length;
        syncFromQuery();
      } catch (error) {
        status.textContent = error.message;
        root.hidden = false;
      }
    },
    syncFromQuery,
  };
}
