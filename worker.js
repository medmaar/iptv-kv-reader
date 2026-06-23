/**
 * iptv-kv-reader — reads trial data from ALL 9 site KV namespaces
 * Handles KV pagination to get all entries (not just first 1000)
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function readAllFromKV(kv, site) {
  const trials = [];
  try {
    let cursor = null;
    do {
      const opts = cursor ? { cursor } : {};
      const list = await kv.list(opts);
      for (const key of list.keys) {
        try {
          const raw = await kv.get(key.name);
          if (!raw) continue;
          const d = JSON.parse(raw);
          // Skip cron/scheduler keys that aren't trial entries
          const phone = d.whatsapp || d.phone || '';
          if (!phone || phone.length < 5) continue;
          trials.push({
            id:         key.name,
            site:       d.site || site,
            email:      d.email || '',
            phone:      phone,
            name:       d.name || '',
            created_at: d.created_at || null,
            country:    d.country || '',
          });
        } catch {}
      }
      cursor = list.list_complete ? null : list.cursor;
    } while (cursor);
  } catch {}
  return trials;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    try {
      const KVS = [
        { kv: env.TRIALS_STREAMBLEU,     site: 'streambleu.fr' },
        { kv: env.TRIALS_MAPLESTREAMTV,  site: 'maplestreamtv.ca' },
        { kv: env.TRIALS_MAPLE4K,        site: 'maple4k.ca' },
        { kv: env.TRIALS_MAPLEHD,        site: 'maplehd.ca' },
        { kv: env.TRIALS_IPTVMOJO,       site: 'iptvmojo.com' },
        { kv: env.TRIALS_IPTVVDE,        site: 'iptvv.de' },
        { kv: env.TRIALS_MOJO4KDE,       site: 'mojo4k.de' },
        { kv: env.TRIALS_MOJO4KFR,       site: 'mojo4k.fr' },
        { kv: env.TRIALS_NORGESIPTV,     site: 'norgesiptv.com' },
      ];

      // Read all KVs in parallel
      const results = await Promise.all(
        KVS.map(({ kv, site }) => kv ? readAllFromKV(kv, site) : Promise.resolve([]))
      );

      const allTrials = results.flat();

      // Sort newest first
      allTrials.sort((a, b) => {
        const da = a.created_at ? new Date(a.created_at).getTime() : 0;
        const db = b.created_at ? new Date(b.created_at).getTime() : 0;
        return db - da;
      });

      return new Response(JSON.stringify(allTrials), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      });

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }
  }
};
