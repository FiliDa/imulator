// ESM script: generate and run 200 API tests and save results
import fs from 'fs';
import path from 'path';
import http from 'http';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:9999';
const IMG_DIR = path.resolve('tests', 'skrin_test');
const OUT_DIR = path.resolve('results-200');
const PLAIN = true; // request plain text answers for consistency
const PAUSE_MS = 1000; // respect express-rate-limit (60/min)

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
}

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
  const url = new URL(`${BASE_URL}${route}?plain=${plain ? 'true' : 'false'}`);
  const data = JSON.stringify(body);
  const opts = {
    hostname: url.hostname === 'localhost' ? '127.0.0.1' : url.hostname,
    port: Number(url.port) || 80,
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  };
  return new Promise((resolve) => {
    const req = http.request(opts, (res) => {
      let chunks = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { chunks += d; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, code: res.statusCode, result: chunks });
        } else {
          resolve({ ok: false, code: res.statusCode, error: chunks });
        }
      });
    });
    req.setTimeout(60000, () => { req.destroy(new Error('timeout')); });
    req.on('error', (err) => { resolve({ ok: false, code: 0, error: String(err) }); });
    req.write(data);
    req.end();
  });
}

function makeTextScenario(i) {
  const topics = ['trust_cheating','conflicts','distance','finance','safety','sexual_preferences','communication'];
  const t = topics[i % topics.length];
  const ru = (i % 2 === 0);
  if (ru) {
    const textBy = {
      trust_cheating: 'Партнёр скрывает телефон и пароли; как обсудить доверие?',
      conflicts: 'Мы часто ссоримся из-за мелочей; как снизить эскалацию?',
      distance: 'Дальние отношения; чувствую отдаление; как сблизиться?',
      finance: 'Не получается договориться о бюджете; переживаю о справедливости.',
      safety: 'Слышу угрозы и контроль; как выстроить безопасность?',
      sexual_preferences: 'Хотим обсудить интимные предпочтения; как сделать это бережно?',
      communication: 'Сложно говорить о чувствах; как наладить общение?'
    };
    return {
      text: `${textBy[t]} (вариант ${i+1})`,
      context: `Тест-${i+1}: разные графики/стресс/ожидания; хочу спокойный разговор.`
    };
  }
  const textEnBy = {
    trust_cheating: 'Partner hides phone and passwords; how to discuss trust?',
    conflicts: 'We argue over small things; how to de-escalate?',
    distance: 'Long-distance relationship; feeling distant; how to reconnect?',
    finance: 'We disagree on budget; how to make it fair?',
    safety: 'I notice threats/control; how to ensure safety?',
    sexual_preferences: 'We want to discuss kinks; how to do it respectfully?',
    communication: 'It is hard to share feelings; how to improve communication?'
  };
  return {
    text: `${textEnBy[t]} (variant ${i+1})`,
    context: `Test-${i+1}: stress/workload/boundaries; aim for calm dialogue.`
  };
}

async function main() {
  ensureDir(OUT_DIR);
  const summary = { baseUrl: BASE_URL, total: 200, routes: { text: 0, text_image: 0, image: 0 }, ok: 0, errors: 0 };
  const cases = [];
  const ndjsonPath = path.join(OUT_DIR, 'cases.ndjson');
  const ndjson = fs.createWriteStream(ndjsonPath, { flags: 'a' });

  // Gather images
  let images = [];
  try {
    images = fs.readdirSync(IMG_DIR)
      .filter(f => /\.(png|jpg|jpeg)$/i.test(f))
      .map(f => path.join(IMG_DIR, f));
  } catch {}
  if (images.length === 0) {
    console.warn('No images found in', IMG_DIR);
  }

  // Plan: 100 text-only, 50 text+image, 50 image-only => 200
  // Text-only
  for (let i = 0; i < 100; i++) {
    const payload = makeTextScenario(i);
    const resp = await postJson('/api/v1/analyze/text', payload, PLAIN);
    cases.push({ route: 'text', idx: i + 1, input: payload, ok: resp.ok, code: resp.code, answer: resp.result, error: resp.error });
    try { ndjson.write(JSON.stringify({ route: 'text', idx: i + 1, input: payload, ok: resp.ok, code: resp.code, answer: resp.result, error: resp.error }) + "\n"); } catch {}
    summary.routes.text++;
    resp.ok ? summary.ok++ : summary.errors++;
    await wait(PAUSE_MS);
  }

  // Text+Image
  for (let i = 0; i < 50; i++) {
    const payload = makeTextScenario(i + 100);
    const file = images.length ? images[i % images.length] : null;
    const dataUrl = file ? toDataUrl(file) : undefined;
    payload.images = dataUrl ? [dataUrl] : [];
    payload.context = `${payload.context}; уточнение по скрину: ${file ? path.basename(file) : 'none'}`;
    const resp = await postJson('/api/v1/analyze/text-image', payload, PLAIN);
    cases.push({ route: 'text-image', idx: i + 1, file: file ? path.basename(file) : null, ok: resp.ok, code: resp.code, answer: resp.result, error: resp.error });
    try { ndjson.write(JSON.stringify({ route: 'text-image', idx: i + 1, file: file ? path.basename(file) : null, ok: resp.ok, code: resp.code, answer: resp.result, error: resp.error }) + "\n"); } catch {}
    summary.routes.text_image++;
    resp.ok ? summary.ok++ : summary.errors++;
    await wait(PAUSE_MS);
  }

  // Image-only
  for (let i = 0; i < 50; i++) {
    const file = images.length ? images[i % images.length] : null;
    const dataUrl = file ? toDataUrl(file) : undefined;
    const payload = { images: dataUrl ? [dataUrl] : [], context: `Обсуди признаки и риски по скрину: ${file ? path.basename(file) : 'none'}; без текста.` };
    const resp = await postJson('/api/v1/analyze/image', payload, PLAIN);
    cases.push({ route: 'image', idx: i + 1, file: file ? path.basename(file) : null, ok: resp.ok, code: resp.code, answer: resp.result, error: resp.error });
    try { ndjson.write(JSON.stringify({ route: 'image', idx: i + 1, file: file ? path.basename(file) : null, ok: resp.ok, code: resp.code, answer: resp.result, error: resp.error }) + "\n"); } catch {}
    summary.routes.image++;
    resp.ok ? summary.ok++ : summary.errors++;
    await wait(PAUSE_MS);
  }

  // Save outputs
  fs.writeFileSync(path.join(OUT_DIR, 'cases.json'), JSON.stringify(cases, null, 2), 'utf-8');
  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
  try { ndjson.end(); } catch {}
  // Small probe
  try { fs.writeFileSync(path.join(OUT_DIR, 'probe.txt'), 'ok', 'utf-8'); } catch {}

  // Console summary
  const perRoute = {
    text: cases.filter(c => c.route === 'text').length,
    text_image: cases.filter(c => c.route === 'text-image').length,
    image: cases.filter(c => c.route === 'image').length,
  };
  console.log('Done. Total cases:', cases.length, 'Per route:', perRoute);
  console.log('Saved to folder:', OUT_DIR);
}

main().catch(err => { console.error('run-200-tests failed:', err); process.exit(1); });