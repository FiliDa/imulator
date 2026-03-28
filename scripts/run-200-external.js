// ESM script: generate and run 200 external-style API tests (distinct)
import fs from 'fs';
import path from 'path';
import http from 'http';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:9999';
const IMG_DIR = path.resolve('tests', 'skrin_test');
const OUT_DIR = path.resolve('results-200-external');
const PREV_DIR = path.resolve('results-200');
const PLAIN = false; // request JSON responses to differ from previous
const PAUSE_MS = 1000; // respect rate limit

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

async function postJson(route, body, plain = false) {
  const url = new URL(`${BASE_URL}${route}?plain=${plain ? 'true' : 'false'}`);
  const data = JSON.stringify(body);
  const opts = {
    hostname: url.hostname === 'localhost' ? '127.0.0.1' : url.hostname,
    port: Number(url.port) || 80,
    path: url.pathname + url.search,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
  };
  return new Promise((resolve) => {
    const req = http.request(opts, (res) => {
      let chunks = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { chunks += d; });
      res.on('end', () => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        resolve({ ok, code: res.statusCode, result: ok ? chunks : undefined, error: ok ? undefined : chunks });
      });
    });
    req.setTimeout(60000, () => { req.destroy(new Error('timeout')); });
    req.on('error', (err) => { resolve({ ok: false, code: 0, error: String(err) }); });
    req.write(data);
    req.end();
  });
}

// Scenario generators (Russian prompts, distinct from previous batch)
const adviceTexts = [
  'Как поддержать девушку и снизить тревогу без споров?',
  'Хочу спокойно обсудить ожидания в отношениях — помоги сформулировать.',
  'Она переживает из-за прошлых ошибок — как дать ей опору?',
  'Как предложить диалог о границах уважительно и без давления?',
  'Как извиниться и восстановить доверие после резких слов?',
];
const fraudTexts = [
  'Похоже на мошенника: просит деньги и давит на жалость — как проверить?',
  'Странные ссылки и просьба перейти в мессенджер — на что смотреть?',
  'Как понять фейковый профиль по стилю общения и фото?',
  'Требует личные данные — как корректно отказать и сохранить безопасность?',
];
const replyToGirlTexts = [
  'Что ответить девушке, если она устала и сомневается во мне?',
  'Как поддержать её, если она боится обмана и хочет ясности?',
  'Как мягко показать искренность и уважение её границ?',
  'Как написать, чтобы снизить тревогу и предложить спокойный диалог?',
];
const contexts = [
  'первые сообщения, тепло и уважение',
  'обсуждение границ и ожиданий',
  'проверка на риски и признаки фейка',
  'ответ без манипуляций и давления',
  'поддержка и эмпатия, по шагам',
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function main() {
  ensureDir(OUT_DIR);
  const ndjsonPath = path.join(OUT_DIR, 'cases.ndjson');
  const ndjson = fs.createWriteStream(ndjsonPath, { flags: 'a' });
  let target = { text: 80, text_image: 60, image: 60 };
  let summary = { baseUrl: BASE_URL, total: 200, routes: { ...target }, ok: 0, errors: 0 };
  const cases = [];

  // Resume support: count existing entries from NDJSON
  let existing = { text: 0, text_image: 0, image: 0 };
  try {
    const lines = fs.existsSync(ndjsonPath) ? fs.readFileSync(ndjsonPath, 'utf-8').split(/\r?\n/).filter(Boolean) : [];
    for (const ln of lines) {
      try {
        const obj = JSON.parse(ln);
        if (obj && obj.route && existing.hasOwnProperty(obj.route.replace('-', '_'))) {
          const key = obj.route.replace('-', '_');
          existing[key]++;
        }
      } catch {}
    }
  } catch {}

  // Gather images
  let images = [];
  try {
    images = fs.readdirSync(IMG_DIR)
      .filter(f => /\.(png|jpg|jpeg)$/i.test(f))
      .map(f => path.join(IMG_DIR, f));
  } catch {}
  if (!images.length) console.warn('No images found in', IMG_DIR);

  // Avoid images used in previous 200 and already used in current external NDJSON
  const prevImages = new Set();
  try {
    const prevNd = path.join(PREV_DIR, 'cases.ndjson');
    if (fs.existsSync(prevNd)) {
      const lines = fs.readFileSync(prevNd, 'utf-8').split(/\r?\n/).filter(Boolean);
      for (const ln of lines) {
        try {
          const obj = JSON.parse(ln);
          if (obj && obj.file) prevImages.add(String(obj.file));
          if (obj && Array.isArray(obj.fileNames)) obj.fileNames.forEach(n => prevImages.add(String(n)));
        } catch {}
      }
    }
  } catch {}

  const usedExternalImages = new Set();
  try {
    if (fs.existsSync(ndjsonPath)) {
      const lines = fs.readFileSync(ndjsonPath, 'utf-8').split(/\r?\n/).filter(Boolean);
      for (const ln of lines) {
        try {
          const obj = JSON.parse(ln);
          if (obj && obj.file) usedExternalImages.add(String(obj.file));
          if (obj && Array.isArray(obj.fileNames)) obj.fileNames.forEach(n => usedExternalImages.add(String(n)));
        } catch {}
      }
    }
  } catch {}

  const availableImages = images.filter(p => {
    const name = path.basename(p);
    return !prevImages.has(name) && !usedExternalImages.has(name);
  });
  const imgPool = availableImages;

  // Recompute targets to ensure overall 200 with unique images; compensate with text-only
  {
    const availableCount = imgPool.length;
    let needTextImage = Math.min(60, availableCount);
    let remain = availableCount - needTextImage;
    let needImageOnly = Math.min(60, remain);
    let needTextOnly = 200 - needTextImage - needImageOnly;
    target = { text: needTextOnly, text_image: needTextImage, image: needImageOnly };
    summary = { baseUrl: BASE_URL, total: (target.text + target.text_image + target.image), routes: { ...target }, ok: 0, errors: 0 };
  }

  // 80 text-only
  for (let i = existing.text + 1; i <= target.text; i++) {
    const text = `${pick([...adviceTexts, ...fraudTexts, ...replyToGirlTexts])} |ext2T#${i}`;
    const ctx = `${pick(contexts)} |ext2CTX#${i}`;
    const payload = { text, context: ctx };
    const resp = await postJson('/api/v1/analyze/text', payload, PLAIN);
    const item = { route: 'text', idx: i, input: payload, ok: resp.ok, code: resp.code, result: resp.result, error: resp.error };
    cases.push(item); try { ndjson.write(JSON.stringify(item) + '\n'); } catch {}
    resp.ok ? summary.ok++ : summary.errors++;
    await wait(PAUSE_MS);
  }

  // 60 text+image (use data URLs, sometimes 2 images)
  for (let i = existing.text_image + 1; i <= target.text_image; i++) {
    const file1 = imgPool.length ? imgPool[i % imgPool.length] : null;
    const file2 = imgPool.length ? imgPool[(i + 3) % imgPool.length] : null;
    const imgs = [];
    const fileNames = [];
    if (file1) { imgs.push(toDataUrl(file1)); fileNames.push(path.basename(file1)); }
    if (file2 && i % 5 === 0) { imgs.push(toDataUrl(file2)); fileNames.push(path.basename(file2)); } // occasionally add second
    const text = `${pick(replyToGirlTexts)} |ext2TI#${i}`;
    const ctx = `${pick(contexts)}; по скрину: ${file1 ? path.basename(file1) : 'none'} |ext2CTXTI#${i}`;
    const payload = { text, images: imgs, context: ctx };
    const resp = await postJson('/api/v1/analyze/text-image', payload, PLAIN);
    const item = { route: 'text-image', idx: i, files: imgs.length, fileNames, ok: resp.ok, code: resp.code, result: resp.result, error: resp.error };
    cases.push(item); try { ndjson.write(JSON.stringify(item) + '\n'); } catch {}
    resp.ok ? summary.ok++ : summary.errors++;
    await wait(PAUSE_MS);
  }

  // 60 image-only
  for (let i = existing.image + 1; i <= target.image; i++) {
    const file = imgPool.length ? imgPool[(i + 1) % imgPool.length] : null;
    const imgs = file ? [toDataUrl(file)] : [];
    const ctx = `Оцени риски по скрину: ${file ? path.basename(file) : 'none'}; без текста |ext2IMG#${i}`;
    const payload = { images: imgs, context: ctx };
    const resp = await postJson('/api/v1/analyze/image', payload, PLAIN);
    const item = { route: 'image', idx: i, file: file ? path.basename(file) : null, ok: resp.ok, code: resp.code, result: resp.result, error: resp.error };
    cases.push(item); try { ndjson.write(JSON.stringify(item) + '\n'); } catch {}
    resp.ok ? summary.ok++ : summary.errors++;
    await wait(PAUSE_MS);
  }

  // Build final outputs from NDJSON to be accurate on resume
  try { ndjson.end(); } catch {}
  let all = [];
  try {
    const lines = fs.readFileSync(ndjsonPath, 'utf-8').split(/\r?\n/).filter(Boolean);
    for (const ln of lines) { try { all.push(JSON.parse(ln)); } catch {} }
  } catch {}
  const okAll = all.filter(x => x.ok).length;
  const perRoute = {
    text: all.filter(x => x.route === 'text').length,
    text_image: all.filter(x => x.route === 'text-image').length,
    image: all.filter(x => x.route === 'image').length,
  };
  const finalSummary = {
    baseUrl: BASE_URL,
    total: all.length,
    routes: perRoute,
    ok: okAll,
    errors: all.length - okAll,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'cases.json'), JSON.stringify(all, null, 2), 'utf-8');
  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(finalSummary, null, 2), 'utf-8');
  try { fs.writeFileSync(path.join(OUT_DIR, 'probe.txt'), 'ok', 'utf-8'); } catch {}

  console.log('Done external batch. Total:', cases.length, 'OK:', summary.ok, 'Errors:', summary.errors);
  console.log('Saved to folder:', OUT_DIR);
}

main().catch(err => { console.error('run-200-external failed:', err); process.exit(1); });