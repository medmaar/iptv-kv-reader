/**
 * iptv-kv-reader — reads trial data from all 9 KV namespaces
 * Also stores/reads "contacted" status in KV so it syncs across all devices
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const PROXY   = 'https://iptv-cors-proxy.medmaar.workers.dev';
const API_KEY = '35cf68cc83a3a82e1a0ac5361c7b6105';

async function readKV(kv, site) {
  if (!kv) return [];
  const trials = [];
  try {
    let cursor = null;
    do {
      const list   = cursor ? await kv.list({ cursor }) : await kv.list();
      for (const key of list.keys) {
        if (key.name.startsWith('contact:')) continue; // skip contact entries
        try {
          const raw = await kv.get(key.name);
          if (!raw) continue;
          const d = JSON.parse(raw);
          const phone = d.whatsapp || d.phone || '';
          trials.push({
            id:         key.name,
            site:       (d.site || site).toLowerCase(),
            email:      d.email || '',
            phone:      phone.replace(/\s/g,''),
            name:       d.name || '',
            created_at: d.created_at || null,
            source:     'kv',
          });
        } catch {}
      }
      cursor = list.list_complete ? null : list.cursor;
    } while (cursor);
  } catch {}
  return trials;
}

async function readPanel() {
  try {
    const res  = await fetch(`${PROXY}/trials?key=${API_KEY}`);
    const data = await res.json();
    return Array.isArray(data.trials) ? data.trials : [];
  } catch { return []; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // ── GET /contacts — return all contacted statuses ──────────────
    if (url.pathname === '/contacts' && request.method === 'GET') {
      try {
        const raw = await env.TRIALS_STREAMBLEU.get('__contacts__') || '{}';
        return new Response(raw, { headers: { ...CORS, 'Content-Type': 'application/json' } });
      } catch {
        return new Response('{}', { headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
    }

    // ── POST /contacts — save contacted status ─────────────────────
    if (url.pathname === '/contacts' && request.method === 'POST') {
      try {
        const body = await request.json();
        await env.TRIALS_STREAMBLEU.put('__contacts__', JSON.stringify(body));
        return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
      }
    }

    // ── GET / — return all trials ──────────────────────────────────
    const KVS = [
      { kv: env.TRIALS_STREAMBLEU,    site: 'streambleu.fr' },
      { kv: env.TRIALS_MAPLESTREAMTV, site: 'maplestreamtv.ca' },
      { kv: env.TRIALS_MAPLE4K,       site: 'maple4k.ca' },
      { kv: env.TRIALS_MAPLEHD,       site: 'maplehd.ca' },
      { kv: env.TRIALS_IPTVMOJO,      site: 'iptvmojo.com' },
      { kv: env.TRIALS_IPTVVDE,       site: 'iptvv.de' },
      { kv: env.TRIALS_MOJO4KDE,      site: 'mojo4k.de' },
      { kv: env.TRIALS_MOJO4KFR,      site: 'mojo4k.fr' },
      { kv: env.TRIALS_NORGESIPTV,    site: 'norgesiptv.com' },
    ];

    const [kvResults, panelTrials] = await Promise.all([
      Promise.all(KVS.map(({ kv, site }) => readKV(kv, site))),
      readPanel(),
    ]);

    const seen   = new Set();
    const all    = [];

    const addTrial = (t) => {
      const key = ((t.email || '') + (t.phone || '')).toLowerCase();
      if (!key) return;
      if (seen.has(key)) return;
      seen.add(key);
      all.push(t);
    };

    for (const arr of kvResults) arr.forEach(addTrial);
    panelTrials.forEach(addTrial);

    all.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });

    return new Response(JSON.stringify(all), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
};
