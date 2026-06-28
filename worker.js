/**
 * iptv-kv-reader — Central Trial Dashboard API
 * 
 * GET /          → reads live from all 9 site KV namespaces, returns merged trial list
 * GET /contacts  → returns contacted status map
 * POST /contacts → saves contacted status
 *
 * Workers no longer need to call /add. The local KV write is the source of truth.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Maps binding name → site display label
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
    const url  = new URL(request.url);
    const j    = (data, s = 200) => new Response(JSON.stringify(data), {
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

    // ── GET / — live read from all 9 KV namespaces ───────────────
    try {
      // Read all namespaces in parallel
      const results = await Promise.all(
        SITE_NAMESPACES.map(async ({ binding, site }) => {
          const kv = env[binding];
          if (!kv) return [];
          try {
            const listed = await kv.list();
            const entries = await Promise.all(
              listed.keys
                .filter(k => k.name.startsWith('trial:'))
                .map(async k => {
                  try {
                    const raw = await kv.get(k.name);
                    if (!raw) return null;
                    const d = JSON.parse(raw);
                    const phone = (d.whatsapp || d.phone || '').replace(/\s/g, '');
                    const email = (d.email || '').toLowerCase();
                    if (!email && !phone) return null;
                    return {
                      id:         k.name,
                      site:       (d.site || site).toLowerCase(),
                      email,
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

      // Merge + deduplicate by email (keep most recent per email)
      const byEmail = new Map();
      for (const siteEntries of results) {
        for (const t of siteEntries) {
          const key = t.email || t.phone;
          if (!key) continue;
          const existing = byEmail.get(key);
          if (!existing || (t.created_at || 0) > (existing.created_at || 0)) {
            byEmail.set(key, t);
          }
        }
      }

      // Sort newest first
      const all = [...byEmail.values()].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

      return new Response(JSON.stringify(all), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });

    } catch(e) {
      return j({ error: e.message }, 500);
    }
  },
};
