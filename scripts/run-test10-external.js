// ESM script: run 10 external-style tests focused on fraud detection
import fs from 'fs';
import path from 'path';
// use native fetch for reliability

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const IMG_DIR = path.resolve('tests', 'skrin_test');
const OUT_DIR = path.resolve('results-test10-external');
const PLAIN = true; // enforce compact text to validate "Ask:" presence
const PAUSE_MS = 800;

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

function makeFraudText(i) {
  const samples = [
    'Перешли код из SMS для подтверждения активации — срочно.',
    'Скинь одноразовый код, иначе заблокируем доступ к карте.',
    'Давай в Telegram, там быстрее, отправь код из банка.',
    'Нужен код из приложения банка для возврата средств.'
  ];
  const neutral = [
    'Как обсудить деньги в отношениях без конфликтов?',
    'Как безопасно покупать онлайн, чтобы не попасться на фейк?',
    'Как распознать подозрительные просьбы в переписке?'
  ];
  return (i % 2 === 0) ? { text: samples[i % samples.length], context: 'Проверка внешних кейсов (явные признаки)' } : { text: neutral[i % neutral.length], context: 'Проверка внешних кейсов (нейтрально)' };
}

async function main() {
  ensureDir(OUT_DIR);
  const cases = [];
  const summary = { baseUrl: BASE_URL, total: 10, routes: { text: 4, text_image: 3, image: 3 }, ok: 0, errors: 0 };

  // Choose one screenshot if present
  let images = [];
  try { images = fs.readdirSync(IMG_DIR).filter(f => /(png|jpg|jpeg)$/i.test(f)).map(f => path.join(IMG_DIR, f)); } catch {}
  const file = images[0];
  const dataUrl = file ? toDataUrl(file) : undefined;

  // 4 text-only focused on external fraud patterns
  for (let i = 0; i < 4; i++) {
    const payload = makeFraudText(i);
    const resp = await postJson('/api/v1/analyze/text', payload, PLAIN);
    cases.push({ route: 'text', idx: i + 1, input: payload, ok: resp.ok, code: resp.code, result: resp.result, error: resp.error });
    resp.ok ? summary.ok++ : summary.errors++;
    await wait(PAUSE_MS);
  }

  // 3 text+image typical external flows (messenger switch, urgency, code request)
  const tiPayloads = [
    { text: 'Перейдём в WhatsApp, там отправишь код из банка', context: 'Внешний: перевод в мессенджер + код', images: dataUrl ? [dataUrl] : [] },
    { text: 'Срочно нужно подтвердить операцию, пришлёшь SMS-код?', context: 'Внешний: срочность + требование кода', images: dataUrl ? [dataUrl] : [] },
    { text: 'Стоит ли доверять этому магазину? Выглядит подозрительно', context: 'Внешний: нейтральный вопрос о безопасности', images: dataUrl ? [dataUrl] : [] }
  ];
  for (let i = 0; i < 3; i++) {
    const payload = tiPayloads[i];
    const resp = await postJson('/api/v1/analyze/text-image', payload, PLAIN);
    cases.push({ route: 'text-image', idx: i + 1, file: file ? path.basename(file) : null, ok: resp.ok, code: resp.code, result: resp.result, error: resp.error });
    resp.ok ? summary.ok++ : summary.errors++;
    await wait(PAUSE_MS);
  }

  // 3 image-only external style
  const imgPayloads = [
    { images: dataUrl ? [dataUrl] : [], context: 'Проверь ссылки, логотип, орфографию и несоответствия.' },
    { images: dataUrl ? [dataUrl] : [], context: 'Есть ли признаки фишинга? Уточни по видимым элементам.' },
    { images: dataUrl ? [dataUrl] : [], context: 'Проверь, просит ли скрин код или перевод в чат.' }
  ];
  for (let i = 0; i < 3; i++) {
    const payload = imgPayloads[i];
    const resp = await postJson('/api/v1/analyze/image', payload, PLAIN);
    cases.push({ route: 'image', idx: i + 1, file: file ? path.basename(file) : null, ok: resp.ok, code: resp.code, result: resp.result, error: resp.error });
    resp.ok ? summary.ok++ : summary.errors++;
    await wait(PAUSE_MS);
  }

  fs.writeFileSync(path.join(OUT_DIR, 'cases.json'), JSON.stringify(cases, null, 2), 'utf-8');
  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
  console.log('Done test10 external. Saved to folder:', OUT_DIR);
}

main().catch(err => { console.error('run-test10-external failed:', err); process.exit(1); });