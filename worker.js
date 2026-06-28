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

      // Merge and sort newest first
      const all = results.flat().sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

      return new Response(JSON.stringify(all), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });

    } catch(e) {
      return j({ error: e.message }, 500);
    }
  },
};
