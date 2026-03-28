// ESM script: run 5 English tests per scenario against external API
import fs from 'fs';
import path from 'path';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const IMG_DIR = path.resolve('tests', 'skrin_test');
const OUT_DIR = path.resolve('5test');
const PLAIN = true; // plain text to validate compact format
const PAUSE_MS = 700;

function ensureDir(dir) { try { fs.mkdirSync(dir, { recursive: true }); } catch {} }
function wait(ms) { return new Promise(res => setTimeout(res, ms)); }
function guessMime(ext) { const e = String(ext||'').toLowerCase(); return e==='.png'?'image/png':(e==='.jpg'||e==='.jpeg'?'image/jpeg':'application/octet-stream'); }
function toDataUrl(filePath) { const mime = guessMime(path.extname(filePath)); const b64 = fs.readFileSync(filePath).toString('base64'); return `data:${mime};base64,${b64}`; }

async function postJson(route, body, plain = true) {
  const url = `${BASE_URL}${route}?plain=${plain ? 'true' : 'false'}`;
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const txt = await r.text();
    if (r.ok) return { ok: true, code: r.status, result: txt };
    return { ok: false, code: r.status, error: txt };
  } catch (e) {
    return { ok: false, code: 0, error: String(e?.message || e) };
  }
}

function validateCompactFormat(s) {
  const t = String(s || '');
  // two sentences followed by Ask: ... (English)
  const re = /^(?:[^.!?]+[.!?]\s+){2}Ask:\s/i;
  return re.test(t);
}

function makeText(i) {
  const fraud = [
    'Send me the SMS code to verify your account now.',
    'Let\'s switch to WhatsApp; share your bank app code there.',
    'I need your password to confirm the refund; hurry.',
    'Transfer a small amount first; then we\'ll send the goods.'
  ];
  const neutral = [
    'How to safely buy online and avoid fake stores?',
    'What\'s the best way to discuss money without conflicts?',
    'How to spot suspicious requests in chats?'
  ];
  return (i % 2 === 0)
    ? { text: fraud[i % fraud.length], context: 'External check (clear risks)' }
    : { text: neutral[i % neutral.length], context: 'External check (neutral)' };
}

async function main() {
  ensureDir(OUT_DIR);
  const cases = [];
  const summary = { baseUrl: BASE_URL, total: 15, routes: { text: 5, text_image: 5, image: 5 }, ok: 0, errors: 0, format_ok: 0 };

  // pick one image if present
  let images = [];
  try { images = fs.readdirSync(IMG_DIR).filter(f => /(png|jpg|jpeg)$/i.test(f)).map(f => path.join(IMG_DIR, f)); } catch {}
  const file = images[0];
  const dataUrl = file ? toDataUrl(file) : undefined;

  // 5 text-only
  for (let i = 0; i < 5; i++) {
    const payload = makeText(i);
    const resp = await postJson('/api/v1/analyze/text', payload, PLAIN);
    const fmt = resp.ok ? validateCompactFormat(resp.result) : false;
    cases.push({ route: 'text', idx: i + 1, input: payload, ok: resp.ok, code: resp.code, result: resp.result, error: resp.error, format_ok: fmt });
    resp.ok ? summary.ok++ : summary.errors++;
    if (fmt) summary.format_ok++;
    await wait(PAUSE_MS);
  }

  // 5 text+image
  const tiPayloads = [
    { text: 'Let\'s move to Telegram and send the bank code there.', context: 'External: messenger switch + code', images: dataUrl ? [dataUrl] : [] },
    { text: 'Urgent confirmation needed; can you share the SMS code?', context: 'External: urgency + code', images: dataUrl ? [dataUrl] : [] },
    { text: 'Is this shop trustworthy? Looks suspicious to me.', context: 'External: general safety question', images: dataUrl ? [dataUrl] : [] },
    { text: 'Please send your personal photos for verification.', context: 'External: request for private photos', images: dataUrl ? [dataUrl] : [] },
    { text: 'Click the link and login; we\'ll process the refund.', context: 'External: link + login request', images: dataUrl ? [dataUrl] : [] }
  ];
  for (let i = 0; i < 5; i++) {
    const payload = tiPayloads[i];
    const resp = await postJson('/api/v1/analyze/text-image', payload, PLAIN);
    const fmt = resp.ok ? validateCompactFormat(resp.result) : false;
    cases.push({ route: 'text-image', idx: i + 1, file: file ? path.basename(file) : null, ok: resp.ok, code: resp.code, result: resp.result, error: resp.error, format_ok: fmt });
    resp.ok ? summary.ok++ : summary.errors++;
    if (fmt) summary.format_ok++;
    await wait(PAUSE_MS);
  }

  // 5 image-only
  const imgPayload = { images: dataUrl ? [dataUrl] : [], context: 'Check for phishing cues: links, urgency, codes, and mismatches.' };
  for (let i = 0; i < 5; i++) {
    const resp = await postJson('/api/v1/analyze/image', imgPayload, PLAIN);
    const fmt = resp.ok ? validateCompactFormat(resp.result) : false;
    cases.push({ route: 'image', idx: i + 1, file: file ? path.basename(file) : null, ok: resp.ok, code: resp.code, result: resp.result, error: resp.error, format_ok: fmt });
    resp.ok ? summary.ok++ : summary.errors++;
    if (fmt) summary.format_ok++;
    await wait(PAUSE_MS);
  }

  fs.writeFileSync(path.join(OUT_DIR, 'cases.json'), JSON.stringify(cases, null, 2), 'utf-8');
  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
  try { fs.writeFileSync(path.join(OUT_DIR, 'probe.txt'), 'ok', 'utf-8'); } catch {}
  console.log('Done 5 English external tests. Saved to folder:', OUT_DIR);
}

main().catch(err => { console.error('run-5tests-external-en failed:', err); process.exit(1); });