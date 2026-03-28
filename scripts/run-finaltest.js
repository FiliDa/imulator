// Final small test run: 1 case per type per screenshot, external & internal
// Outputs to folder `finaltest/` as cases.json and summary.json
// ESM script; requires Node 18+ for global fetch

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const FINAL_DIR = path.join(ROOT, 'finaltest');
const IMG_DIR = path.join(ROOT, 'tests', 'skrin_test');
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const PLAIN = 'true';
const PAUSE_MS = 300; // small pacing between requests

// Validate compact format: two sentences ended with punctuation + "Ask:" line
const COMPACT_RE = /^(?:[^\.!?]+[\.!?]\s+){2}Ask:\s*.+/m;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function listImages() {
  const all = fs.readdirSync(IMG_DIR);
  return all.filter(f => /(\.png|\.jpg|\.jpeg)$/i.test(f)).map(f => path.join(IMG_DIR, f));
}

async function postJson(url, body, extra = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extra.headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, ok: res.ok, json };
}

function toBase64(filePath) {
  const buf = fs.readFileSync(filePath);
  return buf.toString('base64');
}

function mimeFromPath(p) {
  const ext = String(path.extname(p || '').toLowerCase());
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

function makeCaseRecord({ category, type, imagePath, prompt, response, status }) {
  const compact = response?.compact || response?.result || response?.raw || '';
  const format_ok = typeof compact === 'string' ? COMPACT_RE.test(compact.trim()) : false;
  return {
    ts: new Date().toISOString(),
    category, // 'external' | 'internal'
    type,     // 'text' | 'text-image' | 'image'
    screen: path.basename(imagePath || ''),
    prompt,
    status,
    compact,
    format_ok,
  };
}

async function runForImage(imagePath) {
  const results = [];

  // Prompts (kept short; 1 per type)
  const prompts = {
    external: {
      text: 'Stranger asks for bank details; is this risky?',
      textImage: 'Is this profile photo typical of romance scam?',
      image: 'Assess risk based on this image only.'
    },
    internal: {
      text: 'Give respectful advice for setting chat boundaries.',
      textImage: 'Give safety advice considering this photo and short chat.',
      image: 'Provide safety tips based only on this image.'
    }
  };

  // text-only (external)
  {
    const body = { text: prompts.external.text, lang: 'en', plain: PLAIN };
    const { status, json } = await postJson(`${BASE_URL}/api/v1/analyze/text`, body);
    results.push(makeCaseRecord({ category: 'external', type: 'text', imagePath, prompt: body.text, response: json, status }));
    await sleep(PAUSE_MS);
  }

  // text-image (external)
  {
    const mime = mimeFromPath(imagePath);
    const dataUrl = `data:${mime};base64,${toBase64(imagePath)}`;
    const body = { text: prompts.external.textImage, images: [dataUrl], lang: 'en', plain: PLAIN };
    const { status, json } = await postJson(`${BASE_URL}/api/v1/analyze/text-image`, body);
    results.push(makeCaseRecord({ category: 'external', type: 'text-image', imagePath, prompt: body.text, response: json, status }));
    await sleep(PAUSE_MS);
  }

  // image-only (external)
  {
    const mime = mimeFromPath(imagePath);
    const dataUrl = `data:${mime};base64,${toBase64(imagePath)}`;
    const body = { images: [dataUrl], lang: 'en', plain: PLAIN };
    const { status, json } = await postJson(`${BASE_URL}/api/v1/analyze/image`, body);
    results.push(makeCaseRecord({ category: 'external', type: 'image', imagePath, prompt: prompts.external.image, response: json, status }));
    await sleep(PAUSE_MS);
  }

  // text-only (internal)
  {
    const body = { text: prompts.internal.text, lang: 'en', plain: PLAIN };
    const { status, json } = await postJson(`${BASE_URL}/api/v1/analyze/text`, body);
    results.push(makeCaseRecord({ category: 'internal', type: 'text', imagePath, prompt: body.text, response: json, status }));
    await sleep(PAUSE_MS);
  }

  // text-image (internal)
  {
    const mime = mimeFromPath(imagePath);
    const dataUrl = `data:${mime};base64,${toBase64(imagePath)}`;
    const body = { text: prompts.internal.textImage, images: [dataUrl], lang: 'en', plain: PLAIN };
    const { status, json } = await postJson(`${BASE_URL}/api/v1/analyze/text-image`, body);
    results.push(makeCaseRecord({ category: 'internal', type: 'text-image', imagePath, prompt: body.text, response: json, status }));
    await sleep(PAUSE_MS);
  }

  // image-only (internal)
  {
    const mime = mimeFromPath(imagePath);
    const dataUrl = `data:${mime};base64,${toBase64(imagePath)}`;
    const body = { images: [dataUrl], lang: 'en', plain: PLAIN };
    const { status, json } = await postJson(`${BASE_URL}/api/v1/analyze/image`, body);
    results.push(makeCaseRecord({ category: 'internal', type: 'image', imagePath, prompt: prompts.internal.image, response: json, status }));
    await sleep(PAUSE_MS);
  }

  return results;
}

function summarize(cases) {
  const summary = {
    total: cases.length,
    by_category: { external: 0, internal: 0 },
    by_type: { text: 0, 'text-image': 0, image: 0 },
    http_ok: 0,
    format_ok: 0,
  };
  for (const c of cases) {
    summary.by_category[c.category]++;
    summary.by_type[c.type]++;
    if (c.status >= 200 && c.status < 300) summary.http_ok++;
    if (c.format_ok) summary.format_ok++;
  }
  return summary;
}

async function main() {
  ensureDir(FINAL_DIR);
  const probePath = path.join(FINAL_DIR, 'probe.txt');
  fs.writeFileSync(probePath, `BASE_URL=${BASE_URL}\nIMG_DIR=${IMG_DIR}\nDATE=${new Date().toISOString()}\n`);

  const imgs = listImages();
  if (imgs.length === 0) {
    console.error('No images found in', IMG_DIR);
    process.exit(2);
  }

  const allCases = [];
  for (const img of imgs) {
    const perImage = await runForImage(img);
    allCases.push(...perImage);
  }

  const casesPath = path.join(FINAL_DIR, 'cases.json');
  const summaryPath = path.join(FINAL_DIR, 'summary.json');
  fs.writeFileSync(casesPath, JSON.stringify(allCases, null, 2));
  const summary = summarize(allCases);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log('Final test completed:', summary);
}

main().catch(err => {
  console.error('Final test failed', err);
  process.exit(1);
});