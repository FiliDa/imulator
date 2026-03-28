// ESM script: run 10 internal API tests and save results
import fs from 'fs';
import path from 'path';
// use native fetch for reliability

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const IMG_DIR = path.resolve('tests', 'skrin_test');
const OUT_DIR = path.resolve('results-test10-3000');
const PLAIN = true; // request plain text answers to verify compact format
const PAUSE_MS = 800; // be gentle with rate limit

function ensureDir(dir) { try { fs.mkdirSync(dir, { recursive: true }); } catch {} }
function wait(ms) { return new Promise(res => setTimeout(res, ms)); }

function guessMime(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === '.png') return 'image/png';
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}
function toDataUrl(filePath) {
  const ext = path.extname(filePath);
  const mime = guessMime(ext);
  const b64 = fs.readFileSync(filePath).toString('base64');
  return `data:${mime};base64,${b64}`;
}

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

function makeText(i) {
  const ru = (i % 2 === 0);
  if (ru) {
    const texts = [
      'Мы часто ссоримся из-за мелочей; как снизить эскалацию?',
      'Она сомневается и устала; как поддержать её спокойно?',
      'Партнёр скрывает телефон и пароли; как обсудить доверие?'
    ];
    return { text: texts[i % texts.length], context: 'Стресс после работы; спокойный диалог и границы.' };
  }
  const textsEn = [
    'We argue over small things; how to de-escalate?',
    'She is tired and uncertain; how to support her calmly?',
    'Partner hides phone and passwords; how to discuss trust?'
  ];
  return { text: textsEn[i % textsEn.length], context: 'Work stress; calm dialogue and boundaries.' };
}

async function main() {
  ensureDir(OUT_DIR);
  const cases = [];
  const summary = { baseUrl: BASE_URL, total: 10, routes: { text: 4, text_image: 3, image: 3 }, ok: 0, errors: 0 };

  // Gather one image
  let images = [];
  try {
    images = fs.readdirSync(IMG_DIR).filter(f => /(png|jpg|jpeg)$/i.test(f)).map(f => path.join(IMG_DIR, f));
  } catch {}
  const file = images[0];
  const dataUrl = file ? toDataUrl(file) : undefined;

  // 4 text-only
  for (let i = 0; i < 4; i++) {
    const payload = makeText(i);
    const resp = await postJson('/api/v1/analyze/text', payload, PLAIN);
    cases.push({ route: 'text', idx: i + 1, input: payload, ok: resp.ok, code: resp.code, result: resp.result, error: resp.error });
    resp.ok ? summary.ok++ : summary.errors++;
    await wait(PAUSE_MS);
  }

  // 3 text+image (neutral and risk)
  const tiPayloads = [
    { text: 'Скрин переписки, без явных просьб о коде', context: 'Проверка компакта (нейтрально)', images: dataUrl ? [dataUrl] : [] },
    { text: 'Просит перейти в мессенджер и скинуть код из SMS', context: 'Проверка компакта (явные риски)', images: dataUrl ? [dataUrl] : [] },
    { text: 'Как уважительно обсудить границы по переписке?', context: 'Проверка компакта (спокойный диалог)', images: dataUrl ? [dataUrl] : [] }
  ];
  for (let i = 0; i < 3; i++) {
    const payload = tiPayloads[i];
    const resp = await postJson('/api/v1/analyze/text-image', payload, PLAIN);
    cases.push({ route: 'text-image', idx: i + 1, file: file ? path.basename(file) : null, ok: resp.ok, code: resp.code, result: resp.result, error: resp.error });
    resp.ok ? summary.ok++ : summary.errors++;
    await wait(PAUSE_MS);
  }

  // 3 image-only
  const imgPayloads = [
    { images: dataUrl ? [dataUrl] : [], context: 'Только скрин; проверь видимые элементы и сроки.' },
    { images: dataUrl ? [dataUrl] : [], context: 'Скрин с возможной просьбой о коде; уточни.' },
    { images: dataUrl ? [dataUrl] : [], context: 'Скрин профиля; проверь ссылки и несоответствия.' }
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
  try { fs.writeFileSync(path.join(OUT_DIR, 'probe.txt'), 'ok', 'utf-8'); } catch {}
  console.log('Done test10 internal. Saved to folder:', OUT_DIR);
}

main().catch(err => { console.error('run-test10-internal failed:', err); process.exit(1); });