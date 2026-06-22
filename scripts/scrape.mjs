// Scrape FII/DII activity. Primary: NSE official API. Fallback: Moneycontrol.
// Writes data/YYYY-MM-DD.json + data/latest.json.
import { writeFileSync, mkdirSync } from 'node:fs';
import { load } from 'cheerio';

const today = new Date().toISOString().slice(0, 10);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function zero() {
  return { fii_buy: 0, fii_sell: 0, fii_net: 0, dii_buy: 0, dii_sell: 0, dii_net: 0 };
}

async function tryNse() {
  // Cookie warmup — NSE rejects API calls without a session cookie.
  const warm = await fetch('https://www.nseindia.com/', { headers: { 'User-Agent': UA, 'Accept': 'text/html' } });
  const cookie = warm.headers.getSetCookie?.().join('; ') ?? warm.headers.get('set-cookie') ?? '';
  const res = await fetch('https://www.nseindia.com/api/fiidii', {
    headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://www.nseindia.com/', Cookie: cookie },
  });
  if (!res.ok) throw new Error(`NSE ${res.status}`);
  const arr = await res.json();
  const eq = arr.find((r) => /equity/i.test(r.category)) ?? {};
  const dv = arr.find((r) => /deriv|future|fno/i.test(r.category)) ?? {};
  const pick = (r) => ({
    fii_buy: +r.buyValue || 0, fii_sell: +r.sellValue || 0, fii_net: +r.netValue || 0,
    dii_buy: 0, dii_sell: 0, dii_net: 0,
  });
  return { source: 'nse', equity: pick(eq), derivative: pick(dv) };
}

async function tryMoneycontrol() {
  const res = await fetch('https://www.moneycontrol.com/stocks/marketstats/fii_dii_activity/index.php', { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`MC ${res.status}`);
  const $ = load(await res.text());
  const cells = $('table tr').eq(1).find('td').map((_, el) => +$(el).text().replace(/[,\s]/g, '') || 0).get();
  const [fii_buy = 0, fii_sell = 0, fii_net = 0, dii_buy = 0, dii_sell = 0, dii_net = 0] = cells;
  return { source: 'moneycontrol', equity: { fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net }, derivative: zero() };
}

let result;
try { result = await tryNse(); } catch (e1) {
  console.error('NSE failed:', e1.message);
  try { result = await tryMoneycontrol(); } catch (e2) {
    console.error('Moneycontrol failed:', e2.message);
    result = { source: 'placeholder', equity: zero(), derivative: zero() };
  }
}

const payload = { date: today, ...result };
mkdirSync('data', { recursive: true });
writeFileSync(`data/${today}.json`, JSON.stringify(payload, null, 2) + '\n');
writeFileSync('data/latest.json', JSON.stringify(payload, null, 2) + '\n');
console.log('Wrote', `data/${today}.json`, 'source=', payload.source);
