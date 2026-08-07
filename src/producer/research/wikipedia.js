const SEARCH_API = 'https://en.wikipedia.org/w/rest.php/v1/search/page';
const SUMMARY_API = 'https://en.wikipedia.org/api/rest_v1/page/summary/';

// Wikimedia's API etiquette (mediawiki.org/wiki/API:Etiquette) explicitly
// calls out a missing/generic User-Agent as risking an IP block, separate
// from and worse than ordinary rate-limiting -- confirmed we don't want to
// find out the hard way twice. No hard numeric rate limit is published for
// read requests; it's a "be considerate, identify yourself" policy.
const USER_AGENT = 'radioclyde/0.1.0 (self-hosted internet radio project, non-commercial)';

function requestHeaders() {
  return { Accept: 'application/json', 'User-Agent': USER_AGENT };
}

// Real pacing has to live here, at the one place that actually issues
// requests -- confirmed live that the caller-side pacing this used to rely
// on (a sleep once per *track* in trackResearch.js) still let a 429 through,
// because a single track can fire several requests back-to-back with no gap
// at all: fetchSummary's own search-then-summary pair, and again for the
// album-level fallback when a track has no song page. lastRequestAt is
// shared across every call into this module (song lookups, album lookups,
// whichever caller), so the minimum gap holds between *any* two Wikipedia
// requests project-wide, not just once per loop iteration.
const MIN_REQUEST_INTERVAL_MS = 500;
let lastRequestAt = 0;

async function pacedFetch(url, { retriedAfter429 = false } = {}) {
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();

  const res = await fetch(url, { headers: requestHeaders() });
  // One retry, honoring Retry-After when Wikipedia sends it, before giving
  // up and letting the caller's existing "failed request != not found"
  // handling take over.
  if (res.status === 429 && !retriedAfter429) {
    const retryAfterSec = parseInt(res.headers.get('retry-after') ?? '', 10) || 5;
    await new Promise((resolve) => setTimeout(resolve, retryAfterSec * 1000));
    return pacedFetch(url, { retriedAfter429: true });
  }
  return res;
}

// A direct title lookup is not safe here: many album/song titles are plain
// English words or phrases ("Jazz", "Innuendo", "The Miracle", "At the BBC")
// that collide with an unrelated, more notable Wikipedia page of the exact
// same title. Searching with disambiguating context (e.g. "The Miracle
// Queen album") and taking Wikipedia's own top-ranked match reliably
// resolves to the right page -- confirmed in testing against titles that
// were failing silently wrong under a direct title fetch.
export async function fetchSummary(query) {
  const searchUrl = `${SEARCH_API}?q=${encodeURIComponent(query)}&limit=1`;
  const searchRes = await pacedFetch(searchUrl);
  // A failed request (rate-limited, network error, 5xx) is not the same
  // thing as "no matching page" -- confirmed live hitting a real 429 from
  // Wikipedia mid-session, which this used to silently treat as "not found."
  // That's a real problem for any caller that persists results (a rate
  // limit would get permanently cached as "this topic has no Wikipedia
  // page"), so request failures throw instead of returning null; only a
  // genuinely empty/disambiguation result returns null.
  if (!searchRes.ok) {
    throw new Error(`Wikipedia search request failed: ${searchRes.status} ${searchRes.statusText}`);
  }
  const searchData = await searchRes.json();
  const top = searchData.pages?.[0];
  if (!top) return null;

  const summaryRes = await pacedFetch(SUMMARY_API + encodeURIComponent(top.key));
  if (!summaryRes.ok) {
    throw new Error(`Wikipedia summary request failed: ${summaryRes.status} ${summaryRes.statusText}`);
  }
  const data = await summaryRes.json();
  // Disambiguation pages have no useful single-entity extract.
  if (data.type === 'disambiguation' || !data.extract) return null;
  return { title: data.title, extract: data.extract };
}
