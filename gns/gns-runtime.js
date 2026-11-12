function unwrapBody(response) {
  if (Array.isArray(response)) {
    if (response.length === 1 && response[0] && typeof response[0] === 'object' && !Array.isArray(response[0])) {
      return unwrapBody(response[0]);
    }
    return response;
  }
  if (!response || typeof response !== 'object') return {};
  for (const k of ['body', 'data', 'value']) {
    if (response[k] && typeof response[k] === 'object' && !Array.isArray(response[k])) return response[k];
  }
  return response;
}

export function itemsOf(response) {
  const body = unwrapBody(response);
  if (Array.isArray(body.items)) return body.items;
  if (Array.isArray(body)) return body;
  return [];
}

export async function gnsRequest(name, params = {}, opts) {
  const g = window.gns;
  if (!g?.request) throw new Error('GNS bridge unavailable');
  return g.request(name, params, opts);
}

export async function gnsGet(key) {
  const raw = await window.gns.get(key).catch(() => null);
  return unwrapBody(raw);
}

export async function gnsSet(key, value, opts) {
  return window.gns.set(key, value, opts);
}

export { unwrapBody };
