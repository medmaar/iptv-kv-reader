/**
 * iptv-kv-reader v3 — efficient single-key design
 *
 * WRITE: each trial worker appends to "all_trials" JSON blob in TRIALS_STREAMBLEU
 *        (one write op per trial, zero list ops)
 * READ:  dashboard does ONE kv.get("all_trials") — costs 1 read op, not 1000+
 *
 * /contacts GET/POST  — stores contacted status (1 read + 1 write)
 * /add       POST     — adds a single trial to the blob (called by trial workers)
 * /           GET     — returns all trials (1 read op total)
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const json = (data, status=200) =>
      new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

    // ── GET /contacts ─────────────────────────────────────────────
    if (url.pathname === '/contacts' && request.method === 'GET') {
      const raw = await env.TRIALS_STREAMBLEU.get('__contacts__') || '{}';
      return new Response(raw, { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // ── POST /contacts ────────────────────────────────────────────
    if (url.pathname === '/contacts' && request.method === 'POST') {
      const body = await request.json();
      await env.TRIALS_STREAMBLEU.put('__contacts__', JSON.stringify(body));
      return json({ ok: true });
    }

    // ── POST /add — called by trial workers when new trial created ─
    if (url.pathname === '/add' && request.method === 'POST') {
      try {
        const trial = await request.json();
        if (!trial.email && !trial.phone) return json({ error: 'missing fields' }, 400);

        // Read existing, deduplicate, append, write back
        const raw = await env.TRIALS_STREAMBLEU.get('__all_trials__') || '[]';
        const trials = JSON.parse(raw);
        const key = (trial.email + (trial.phone||'')).toLowerCase();
        const exists = trials.some(t => (t.email + (t.phone||'')).toLowerCase() === key);
        if (!exists) {
          trials.unshift(trial); // newest first
          // Keep max 500 trials to avoid blob getting too large
          if (trials.length > 500) trials.splice(500);
          await env.TRIALS_STREAMBLEU.put('__all_trials__', JSON.stringify(trials));
        }
        return json({ ok: true, total: trials.length });
      } catch(e) {
        return json({ error: e.message }, 500);
      }
    }

    // ── GET / — return all trials (1 read op) ─────────────────────
    const raw = await env.TRIALS_STREAMBLEU.get('__all_trials__') || '[]';
    const trials = JSON.parse(raw);
    return new Response(raw, { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
};
