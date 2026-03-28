// ESM script to run API tests across scenarios and images
import fs from 'fs';
import path from 'path';
import http from 'http';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:9999';
const IMG_DIR = path.resolve('tests', 'skrin_test');
const OUT_FILE = path.resolve('tests', 'testallPerks1v.out.json');

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
          resolve({ result: chunks });
        } else {
          resolve({ error: res.statusCode, body: chunks });
        }
      });
    });
    req.setTimeout(60000, () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', (err) => {
      resolve({ error: 'request_error', body: String(err) });
    });
    req.write(data);
    req.end();
  });
}

function pick(arr, i) { return arr[i % arr.length]; }

const TEXT_SCENARIOS = [
  { text: 'Партнёр чаще скрывает телефон и пароли; как обсудить доверие?', context: 'Неделя напряжения, были подозрения, хочу спокойно поговорить.' },
  { text: 'Мы часто ссоримся из‑за мелочей; как снизить эскалацию?', context: 'Усталость после работы, вспышки из‑за быта.' },
  { text: 'Дальние отношения; чувствую отдаление; что сделать, чтобы сблизиться?', context: 'Редкие звонки, разные графики.' },
  { text: 'Не получается договориться о бюджете; переживаю о справедливости.', context: 'Неясные ожидания, разные доходы.' },
  { text: 'Иногда слышу угрозы и контроль; как выстроить безопасность?', context: 'Стало страшно после последнего конфликта.' },
  { text: 'Хотим обсудить интимные предпочтения; как сделать это бережно?', context: 'Боюсь обидеть, хочу согласовать границы.' }
];

// Local mockAdvice replica matching server behavior (3–5 lines, partner phrases, scam check)
function mockAdvice({ text = '', context = '', imagesCount = 0 }) {
  const t = (text || '').toLowerCase();
  const hasCyr = /[а-яё]/i.test(t);
  const isEn = /[a-z]/i.test(t) && !hasCyr;

  const topic = (() => {
    if (/ревност|контрол|парол|телефон|соцсет|доверие|cheat|cheating|hide.*phone|secret|privacy|affair|unfaith/.test(t)) return 'trust_cheating';
    if (/ссор|конфликт|ругаемся|скандал|спор|argu|fight|conflict|quarrel|yell|swear|drama/.test(t)) return 'conflicts';
    if (/дистанц|расстояни|в другом город|разъехались|редко видимся|long\s*distance|apart|rarely\s*see/.test(t)) return 'distance';
    if (/брак|дети|планы|будущ|ценност|религ|финанс|деньги|money|finance|budget|marriage|kids|future|values/.test(t)) return 'plans_finance';
    if (/насили|угрож|страш|абьюз|манипуляц|изол|контролирует|violence|abuse|threat|manipulat|control|isolate|fear/.test(t)) return 'violence_safety';
    if (/сексу|желан|фантаз|предпочт|либид|интим|sexual|kink|fetish|fantasy|desire|preference|libido/.test(t)) return 'sexual_preferences';
    return 'communication';
  })();

  const trim = (s, n) => (s || '').slice(0, n) + ((s || '').length > n ? '…' : '');

  const scamSignals = /(срочно|перевед|деньг|карточк|код|парол|ссылка|подароч|крипт|bitcoin|crypto|urgent|now|immediat|money|gift\s*card|verification\s*code|password|link|wire|bank|loan|transfer|send)/i;
  const hasScam = scamSignals.test(t);
  const scamLevel = hasScam ? (/(urgent|срочно|now|немедленно)/i.test(t) ? 'high' : 'medium') : 'low';
  const scamReasonEn = hasScam ? 'mentions money/codes/urgent requests' : (imagesCount>0 ? 'no obvious fraud cues in text; screenshots considered' : 'no obvious fraud cues in text');
  const scamReasonRu = hasScam ? 'присутствуют деньги/коды/срочные просьбы' : (imagesCount>0 ? 'в тексте нет явных признаков; учтены скриншоты' : 'в тексте нет явных признаков');

  const lines = [];
  if (isEn) {
    lines.push(text ? `Insight: “${trim(text, 120)}”${context ? `; context: ${trim(context, 80)}` : ''}${imagesCount>0 ? `; ${imagesCount} screenshot(s)` : ''}` : `Insight: clarify the situation; be kind and specific${imagesCount>0 ? `; ${imagesCount} screenshot(s)` : ''}`);
  } else {
    lines.push(text ? `Наблюдение: «${trim(text, 120)}»${context ? `; контекст: ${trim(context, 80)}` : ''}${imagesCount>0 ? `; скриншотов: ${imagesCount}` : ''}` : `Наблюдение: уточните ситуацию; действуйте бережно и конкретно${imagesCount>0 ? `; скриншотов: ${imagesCount}` : ''}`);
  }

  const phraseEnByTopic = {
    trust_cheating: 'Say: “I feel uneasy about secrecy; could we set honesty windows?”',
    conflicts: 'Say: “When X happens I feel Y; can we slow down and swap turns?”',
    distance: 'Say: “Let’s schedule regular calls and plan our next visit.”',
    plans_finance: 'Say: “Can we map budget and future goals; what feels fair to you?”',
    violence_safety: 'Say: “I need safety; threats are unacceptable. I will leave if it repeats.”',
    sexual_preferences: 'Say: “Can we define boundaries and safe words, and go slowly?”',
    communication: 'Say: “Help me understand; what matters most to you right now?”'
  };
  const phraseRuByTopic = {
    trust_cheating: 'Скажи: «Мне тревожно из‑за секретности; давай договоримся об окнах честности?»',
    conflicts: 'Скажи: «Когда происходит X, я чувствую Y; давай замедлимся и по очереди?»',
    distance: 'Скажи: «Давай назначим регулярные созвоны и план следующей встречи.»',
    plans_finance: 'Скажи: «Давай сверим бюджет и цели; как тебе кажется честно?»',
    violence_safety: 'Скажи: «Мне нужна безопасность; угрозы недопустимы. Если повторится — я уйду.»',
    sexual_preferences: 'Скажи: «Давай определим границы и стоп‑слова и пойдём постепенно.»',
    communication: 'Скажи: «Помоги понять; что для тебя сейчас самое важное?»'
  };
  lines.push(isEn ? phraseEnByTopic[topic] : phraseRuByTopic[topic]);

  lines.push(isEn
    ? 'Plan: pick a calm time; use I‑statements; agree 1–2 next steps.'
    : 'План: выберите спокойное время; «я‑сообщения»; договоритесь о 1–2 шагах.');

  lines.push(isEn
    ? `Scam check: ${scamLevel} — ${scamReasonEn}.`
    : `Проверка на мошенничество: ${scamLevel} — ${scamReasonRu}.`);

  if (imagesCount > 0 && !text) {
    lines.push(isEn ? 'Note: screenshot‑only input; verify facts gently before conclusions.' : 'Заметка: только скриншоты; мягко уточняйте факты до выводов.');
  } else if (topic === 'violence_safety') {
    lines.push(isEn ? 'Safety: if you feel unsafe, seek support and a safety plan.' : 'Безопасность: при угрозах обратитесь за поддержкой и составьте план.');
  }

  return lines.slice(0, 5).join('\n');
}

async function main() {
  console.log('IMG_DIR:', IMG_DIR);
  console.log('OUT_FILE:', OUT_FILE);
  const files = fs.readdirSync(IMG_DIR)
    .filter(f => /\.(png|jpg|jpeg)$/i.test(f))
    .map(f => path.join(IMG_DIR, f));
  console.log('Files found:', files.length);
  if (files.length === 0) {
    console.warn('No image files found in', IMG_DIR);
  }

  let suite = { suite: 'testallPerks1v', ts: Date.now(), baseUrl: BASE_URL, cases: [] };
  // If an existing output exists, resume from it
  try {
    if (fs.existsSync(OUT_FILE)) {
      const existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf-8'));
      if (existing && Array.isArray(existing.cases)) {
        suite = { ...existing };
        console.log('Resuming from existing cases:', suite.cases.length);
      }
    }
  } catch (e) {
    console.warn('Failed to read existing output, starting fresh:', e.message);
  }
  // Ensure file exists
  try { fs.writeFileSync(OUT_FILE, JSON.stringify(suite, null, 2), 'utf-8'); } catch {}

  const alreadyProcessedFiles = Math.floor((suite.cases?.length || 0) / 3);
  for (let i = alreadyProcessedFiles; i < files.length; i++) {
    const file = files[i];
    const dataUrl = toDataUrl(file);
    const scenario = pick(TEXT_SCENARIOS, i);
    console.log('Processing:', path.basename(file));

    // text only (store only GPT answer)
    {
      const input = { text: scenario.text, context: scenario.context };
      const resp = await postJson('/api/v1/analyze/text', input, true);
      suite.cases.push({ route: 'text', file: path.basename(file), answer: resp.result });
      console.log('  -> pushed case: text; total cases =', suite.cases.length);
    }

    // text + image (store only GPT answer)
    {
      const input = { text: scenario.text, context: `${scenario.context}; уточнение по скрину: ${path.basename(file)}`, images: [dataUrl] };
      const resp = await postJson('/api/v1/analyze/text-image', input, true);
      suite.cases.push({ route: 'text-image', file: path.basename(file), answer: resp.result });
      console.log('  -> pushed case: text-image; total cases =', suite.cases.length);
    }

    // image only (store only GPT answer)
    {
      const input = { images: [dataUrl], context: `Обсуди признаки и риски по скрину: ${path.basename(file)}; без текста.` };
      const resp = await postJson('/api/v1/analyze/image', input, true);
      suite.cases.push({ route: 'image', file: path.basename(file), answer: resp.result });
      console.log('  -> pushed case: image; total cases =', suite.cases.length);
    }

    // Flush progress after each file to observe incremental results
    try {
      fs.writeFileSync(OUT_FILE, JSON.stringify(suite, null, 2), 'utf-8');
      console.log('  -> flushed', path.basename(file), 'cases so far =', suite.cases.length);
    } catch {}
  }

  console.log('Final cases count:', suite.cases.length);
  fs.writeFileSync(OUT_FILE, JSON.stringify(suite, null, 2), 'utf-8');
  console.log(`Saved ${OUT_FILE} with ${suite.cases.length} cases.`);
}

main().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});