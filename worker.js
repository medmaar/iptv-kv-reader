/**
 * iptv-kv-reader — Central Trial Dashboard API
 *
 * ZERO list operations — uses kv.get('__keys__') index per namespace instead of kv.list()
 * kv.list() costs from the 1,000/day free quota; kv.get() costs from the 100,000/day free quota
 *
 * GET /          → reads __keys__ from each namespace (9 reads) + individual trial entries
 * GET /contacts  → returns contacted status map
 * POST /contacts → saves contacted status
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const SITE_NAMESPACES = [
  { binding: 'TRIALS_NORGESIPTV',    site: 'norgesiptv.com'   },
  { binding: 'TRIALS_MAPLESTREAMTV', site: 'maplestreamtv.ca' },
  { binding: 'TRIALS_MAPLE4K',       site: 'maple4k.ca'       },
  { binding: 'TRIALS_MAPLEHD',       site: 'maplehd.ca'       },
  { binding: 'TRIALS_IPTVMOJO',      site: 'iptvmojo.com'     },
  { binding: 'TRIALS_IPTVVDE',       site: 'iptvv.de'         },
  { binding: 'TRIALS_MOJO4KDE',      site: 'mojo4k.de'        },
  { binding: 'TRIALS_MOJO4KFR',      site: 'mojo4k.fr'        },
  { binding: 'TRIALS_STREAMBLEU',    site: 'streambleu.fr'    },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const j   = (data, s = 200) => new Response(JSON.stringify(data), {
      status: s, headers: { ...CORS, 'Content-Type': 'application/json' },
    });

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // ── GET /contacts ────────────────────────────────────────────
    if (url.pathname === '/contacts' && request.method === 'GET') {
      const raw = await env.TRIALS_STREAMBLEU.get('__contacts__') || '{}';
      return new Response(raw, { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // ── POST /contacts ───────────────────────────────────────────
    if (url.pathname === '/contacts' && request.method === 'POST') {
      try {
        const body = await request.json();
        await env.TRIALS_STREAMBLEU.put('__contacts__', JSON.stringify(body));
        return j({ ok: true });
      } catch(e) { return j({ error: e.message }, 500); }
    }

    // ── POST /build-keys — one-time backfill of __keys__ index ────
    // Uses kv.list() but only called manually once, not on auto-refresh
    if (url.pathname === '/build-keys' && request.method === 'POST') {
      const report = {};
      for (const { binding, site } of SITE_NAMESPACES) {
        const kv = env[binding];
        if (!kv) continue;
        try {
          const listed = await kv.list({ prefix: 'trial:' });
          const emails = listed.keys.map(k => k.name.replace('trial:', ''));
          if (emails.length > 0) {
            await kv.put('__keys__', JSON.stringify(emails), { expirationTtl: 90 * 24 * 60 * 60 });
          }
          report[site] = emails.length;
        } catch(e) { report[site] = 'error: ' + e.message; }
      }
      return j({ ok: true, report });
    }

    // ── GET / — zero-list read from all 9 KV namespaces ─────────
    // Uses __keys__ index (a read op) instead of kv.list() (a list op)
    try {
      const results = await Promise.all(
        SITE_NAMESPACES.map(async ({ binding, site }) => {
          const kv = env[binding];
          if (!kv) return [];
          try {
            // Read the email index — costs 1 read op, not 1 list op
            const indexRaw = await kv.get('__keys__');
            if (!indexRaw) return [];
            const emails = JSON.parse(indexRaw);
            if (!Array.isArray(emails) || emails.length === 0) return [];

            // Read each trial entry in parallel
            const entries = await Promise.all(
              emails.map(async email => {
                try {
                  const raw = await kv.get(`trial:${email}`);
                  if (!raw) return null;
                  const d = JSON.parse(raw);
                  const phone = (d.whatsapp || d.phone || '').replace(/\s/g, '');
                  return {
                    id:         `trial:${email}`,
                    site:       (d.site || site).toLowerCase(),
                    email:      email.toLowerCase(),
                    phone,
                    name:       d.name || '',
                    created_at: d.created_at || null,
                    expiry:     d.expiry || null,
                    source:     'kv-live',
                  };
                } catch { return null; }
              })
            );
            return entries.filter(Boolean);
          } catch { return []; }
        })
      );

      const liveEntries = results.flat();

      // If __keys__ not yet built for any namespace, fall back to __all_trials__ blob
      // (happens first day until /build-keys runs after quota reset)
      if (liveEntries.length === 0) {
        const raw = await env.TRIALS_STREAMBLEU.get('__all_trials__') || '[]';
        return new Response(raw, { headers: { ...CORS, 'Content-Type': 'application/json' } });
      }

      // Sort newest first
      const all = liveEntries.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      return new Response(JSON.stringify(all), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });

    } catch(e) {
      return j({ error: e.message }, 500);
    }
  },
};

// ── This file intentionally has no kv.list() calls in the hot path.
// To backfill __keys__ for existing KV entries, run /build-keys once
// via the GitHub Actions workflow (one-time operation).
