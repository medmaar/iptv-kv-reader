// Live check of the invoice email on every site: opens a real order page, fills the form and
// submits it. The order email itself (EmailJS / iptvmapletv's /api/ajax) is faked so no order
// reaches the inbox; the /invoice call goes to the real Worker, so a real invoice is sent to TO.
import { chromium } from "playwright";
const TO = process.env.TO, TO_ALT = process.env.TO_ALT;
const PAGES = [
  ["maplestreamtv.ca", "https://maplestreamtv.ca/12-months?devices=1"],
  ["maple4k.ca", "https://maple4k.ca/pricing/12-months"],
  ["maplehd.ca", "https://maplehd.ca/pricing/12-months"],
  ["streambleu.fr", "https://streambleu.fr/tarifs/12-mois"],
  ["iptvmapletv.com", "https://iptvmapletv.com/12-month-iptv-unlimited/"],
  ["iptvmojo.com", "https://iptvmojo.com/iptv-12-months-1-connection"],
  ["mojo4ktv.com", "https://mojo4ktv.com/12-months-1-device"],
  ["buyiptvnorway.com", "https://buyiptvnorway.com/iptv-12-months-1-connection"],
  ["norgesiptv.com", "https://norgesiptv.com/bestill.html?plan=12%20M%C3%A5neder&connections=1&price=441"],
  ["flimmerkanal.de", "https://flimmerkanal.de/plan/iptv-12-monate-1-verbindung"],
  ["iptvv.de", "https://iptvv.de/iptv-kaufen-1-geraet-1-jahr"],
  ["mojo4k.de", "https://mojo4k.de/1-jahr-1-gerat"],
  ["streamdeutschland.de", "https://streamdeutschland.de/iptv-kaufen-1-geraet-1-jahr"],
  ["mojo4k.fr", "https://mojo4k.fr/order.html?devices=1&duration=12"],
  ["mojo4k.uk", "https://mojo4k.uk/plans/1-month-2-devices/"],
];
// norgesiptv.com is manual: no invoice to the client, only the notice to the inbox.
const EXPECT = { "norgesiptv.com": '"invoice":false' };
const only = process.argv.slice(2);
const browser = await chromium.launch();
for (const [site, url] of PAGES.filter(([s]) => !only.length || only.includes(s))) {
  const to = site === "maple4k.ca" ? TO_ALT : TO;
  const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" });
  const page = await ctx.newPage();
  const log = { errors: [], csp: [], invoiceJs: null, invoice: null, posts: 0, hook: "", orderFaked: false };
  page.on("pageerror", (e) => log.errors.push(e.message.slice(0, 120)));
  page.on("console", (m) => { if (/Content Security Policy|CSP/i.test(m.text())) log.csp.push(m.text().slice(0, 200)); });
  await page.route("https://api.emailjs.com/**", (r) => { log.orderFaked = true; return r.fulfill({ status: 200, body: "OK", headers: { "Access-Control-Allow-Origin": "*" } }); });
  await page.route(/\/api\/ajax$/, (r) => r.request().method() === "POST"
    ? (log.orderFaked = true, r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { success: true, message: "ok" } }) }))
    : r.continue());
  page.on("response", async (res) => {
    const u = res.url();
    if (u.endsWith("/invoice.js")) { log.invoiceJs = res.status(); log.hook = (await res.text().catch(() => "")).includes("seen={}") ? "new" : "OLD"; }
    if (/(workers\.dev|mojo4k\.uk\/api)\/invoice$/.test(u) && res.request().method() === "POST") { log.posts++; log.invoice = `${res.status()} ${await res.text().catch(() => "")}`; }
  });
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(1500);
    const email = await page.$('input[type="email"]:visible, input[name*="email" i]:visible, input[id*="email" i]:visible');
    if (!email) throw new Error("no email field");
    const form = await email.evaluateHandle((e) => e.form || e.closest("section,main,div.card,div[class*=form]") || document.body);
    // Type like a person so React forms pick the values up.
    const fields = await form.evaluateHandle((f) => [...f.querySelectorAll("input, select, textarea")].filter((el) => el.type !== "hidden" && el.offsetParent !== null));
    const n = await fields.evaluate((a) => a.length);
    for (let i = 0; i < n; i++) {
      const el = await fields.evaluateHandle((a, i) => a[i], i);
      const info = await el.evaluate((el) => ({ tag: el.tagName, type: el.type, key: (el.name + " " + el.id + " " + (el.placeholder || "")).toLowerCase(), value: el.value }));
      if (info.tag === "SELECT") { await el.evaluate((s) => { const o = [...s.options].find((o) => o.value && !o.disabled); if (o && !s.value) { s.value = o.value; s.dispatchEvent(new Event("change", { bubbles: true })); } }); continue; }
      if (info.type === "checkbox") { await el.check().catch(() => {}); continue; }
      if (info.tag === "TEXTAREA") continue;
      let v = null;
      if (info.type === "email" || info.key.includes("mail")) v = to;
      else if (info.type === "tel" || /phone|whats|tel|wa\b/.test(info.key)) v = "+33612345678";
      else if (!info.value) v = "Invoice Test";
      if (v) { await el.fill(""); await el.type(v, { delay: 5 }); }
    }
    const btn = await form.$('[type="submit"], #submit-btn, button.submit-btn') || await page.$("#submit-btn");
    if (btn) await btn.click(); else await form.evaluate((f) => f.requestSubmit());
    for (let i = 0; i < 100 && !log.invoice; i++) await page.waitForTimeout(100);
    await page.waitForTimeout(2000); // any second post for the same order would show up here
  } catch (e) { log.errors.push("TEST: " + e.message.slice(0, 160)); }
  const ok = log.invoice && log.invoice.includes(EXPECT[site] || '"invoice":true') && log.posts === 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${site}  posts=${log.posts} invoice.js=${log.invoiceJs ?? "-"}${log.hook ? "(" + log.hook + ")" : ""} orderFaked=${log.orderFaked} invoice=${log.invoice ?? "none"}${log.errors.length ? "  errors=" + JSON.stringify(log.errors.slice(0, 3)) : ""}${log.csp.length ? "  csp=" + JSON.stringify(log.csp.slice(0, 2)) : ""}`);
  await ctx.close();
}
await browser.close();
