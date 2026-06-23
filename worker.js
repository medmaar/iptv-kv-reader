/**
 * iptv-kv-reader — reads all trial data from all site KV namespaces
 * Returns combined list of trials with CORS headers for the dashboard
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    try {
      // Read from all KV namespaces in parallel
      const KVS = [
        { kv: env.TRIALS_STREAMBLEU,     site: 'streambleu.fr' },
        { kv: env.TRIALS_MAPLESTREAMTV,  site: 'maplestreamtv.ca' },
        { kv: env.TRIALS_MAPLE4K,        site: 'maple4k.ca' },
        { kv: env.TRIALS_MAPLEHD,        site: 'maplehd.ca' },
      ];

      const allTrials = [];

      for (const { kv, site } of KVS) {
        if (!kv) continue;
        try {
          const list = await kv.list();
          for (const key of list.keys) {
            try {
              const raw = await kv.get(key.name);
              if (!raw) continue;
              const data = JSON.parse(raw);
              allTrials.push({
                id:         key.name,
                site:       data.site || site,
                email:      data.email || '',
                phone:      data.whatsapp || data.phone || '',
                name:       data.name || '',
                created_at: data.created_at || key.expiration || null,
                country:    data.country || '',
              });
            } catch {}
          }
        } catch {}
      }

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
