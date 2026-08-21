// Thin fetch wrapper: every write (POST/PUT/PATCH/DELETE) sends
// Content-Type: application/json, matching the server's CSRF mitigation
// (studioAuth.js rejects anything else on a write). Basic Auth credentials
// are handled by the browser itself (cached from the initial native prompt),
// nothing to add here.
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  let payload;
  if (WRITE_METHODS.has(method)) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body ?? {});
  }
  const res = await fetch(`/studio${path}`, { method, headers, body: payload });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // empty body -- fine for some responses
  }
  if (!res.ok) {
    const message = data?.error || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}
