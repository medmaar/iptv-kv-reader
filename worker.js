/**
 * iptv-kv-reader v4
 * - GET /          → return all trials from __all_trials__ blob (1 read op)
 * - POST /add      → append a trial to the blob
 * - GET /migrate   → one-time: read all old trial:* keys and consolidate
 * - GET /contacts  → get contacted status
 * - POST /contacts → save contacted status
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const KVS_CONFIG = [
  { binding: 'TRIALS_STREAMBLEU',    site: 'streambleu.fr' },
  { binding: 'TRIALS_MAPLESTREAMTV', site: 'maplestreamtv.ca' },
  { binding: 'TRIALS_MAPLE4K',       site: 'maple4k.ca' },
  { binding: 'TRIALS_MAPLEHD',       site: 'maplehd.ca' },
  { binding: 'TRIALS_IPTVMOJO',      site: 'iptvmojo.com' },
  { binding: 'TRIALS_IPTVVDE',       site: 'iptvv.de' },
  { binding: 'TRIALS_MOJO4KDE',      site: 'mojo4k.de' },
  { binding: 'TRIALS_MOJO4KFR',      site: 'mojo4k.fr' },
  { binding: 'TRIALS_NORGESIPTV',    site: 'norgesiptv.com' },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const j = (data, s=200) => new Response(JSON.stringify(data), {
      status: s, headers: { ...CORS, 'Content-Type': 'application/json' }
    });

    // ── GET /migrate — one-time migration from old per-key to blob ──
    if (url.pathname === '/migrate') {
      const seen = new Set();
      const all = [];

      for (const cfg of KVS_CONFIG) {
        const kv = env[cfg.binding];
        if (!kv) continue;
        try {
          let cursor = null;
          do {
            const list = cursor ? await kv.list({ cursor }) : await kv.list();
            for (const key of list.keys) {
              if (key.name.startsWith('__')) continue;
              try {
                const raw = await kv.get(key.name);
                if (!raw) continue;
                const d = JSON.parse(raw);
                const phone = d.whatsapp || d.phone || '';
                const email = d.email || '';
                const dedupeKey = (email + phone).toLowerCase();
                if (!dedupeKey || seen.has(dedupeKey)) continue;
                seen.add(dedupeKey);
                all.push({
                  id: key.name,
                  site: (d.site || cfg.site).toLowerCase(),
                  email,
                  phone: phone.replace(/\s/g,''),
                  name: d.name || '',
                  created_at: d.created_at || null,
                  source: 'kv',
                });
              } catch {}
            }
            cursor = list.list_complete ? null : list.cursor;
          } while (cursor);
        } catch {}
      }

      // Sort newest first
      all.sort((a, b) => (b.created_at||0) - (a.created_at||0));

      // Save to blob
      await env.TRIALS_STREAMBLEU.put('__all_trials__', JSON.stringify(all));
      return j({ ok: true, migrated: all.length, message: `Migrated ${all.length} trials to single-key blob` });
    }

    // ── GET /contacts ──────────────────────────────────────────────
    if (url.pathname === '/contacts' && request.method === 'GET') {
      const raw = await env.TRIALS_STREAMBLEU.get('__contacts__') || '{}';
      return new Response(raw, { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // ── POST /contacts ─────────────────────────────────────────────
    if (url.pathname === '/contacts' && request.method === 'POST') {
      const body = await request.json();
      await env.TRIALS_STREAMBLEU.put('__contacts__', JSON.stringify(body));
      return j({ ok: true });
    }

    // ── POST /add — new trial from worker ──────────────────────────
    if (url.pathname === '/add' && request.method === 'POST') {
      try {
        const trial = await request.json();
        const phone = trial.whatsapp || trial.phone || '';
        const email = trial.email || '';
        if (!email && !phone) return j({ error: 'missing fields' }, 400);

        const raw = await env.TRIALS_STREAMBLEU.get('__all_trials__') || '[]';
        const trials = JSON.parse(raw);
        const key = (email + phone).toLowerCase();
        const exists = trials.some(t => ((t.email||'')+(t.phone||'')).toLowerCase() === key);
        if (!exists) {
          trials.unshift({
            id: `trial:${email}`,
            site: (trial.site || 'unknown').toLowerCase(),
            email,
            phone: phone.replace(/\s/g,''),
            name: trial.name || '',
            created_at: trial.created_at || Date.now(),
            source: 'kv',
          });
          if (trials.length > 500) trials.splice(500);
          await env.TRIALS_STREAMBLEU.put('__all_trials__', JSON.stringify(trials));
        }
        return j({ ok: true, total: trials.length });
      } catch(e) {
        return j({ error: e.message }, 500);
      }
    }

    // ── GET / — return all trials (1 read op) ──────────────────────
    const raw = await env.TRIALS_STREAMBLEU.get('__all_trials__') || '[]';
    return new Response(raw, { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
};
