import express from 'express';
import multer from 'multer';
import swaggerUi from 'swagger-ui-express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import { createClient, isConfigured } from './services/openaiClient.js';
import { buildMessages } from './services/messageBuilder.js';
import { compactFallback } from './services/compactFallback.js';
import { getPrompt, setPrompt, resetPrompt, loadPrompt, savePrompt, getCompactPrompt } from './prompt.js';
import { config } from './config.js';
import { TextSchema, TextImageSchemaJson, ImageSchemaJson, validate } from './validation.js';
import { qwenChat, qwenPhoto2Photo, isQwenConfigured as isQwenConfiguredQwen } from './services/qwenClient.js';
import { insertLog, insertRequest, insertAudit, searchLogs as searchLogsDb, queryDailyStats, getAudit } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: config.cors.origin, methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','x-admin-token'], maxAge: 300 }));
app.use(express.json({ limit: config.limits.json }));

const limiter = rateLimit({ windowMs: 60 * 1000, max: 60 });
app.use(limiter);

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: config.limits.fileSize } });

const swaggerDocPath = path.join(__dirname, 'swagger.json');
const swaggerDocument = JSON.parse(fs.readFileSync(swaggerDocPath, 'utf-8'));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Serve static assets from /public (e.g., admin.js, styles)
const publicDir = path.join(__dirname, '../public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

// Explicit route for admin.js to avoid proxy/static misconfiguration
app.get('/admin.js', (req, res) => {
  const adminJsPath = path.join(publicDir, 'admin.js');
  if (fs.existsSync(adminJsPath)) {
    res.sendFile(adminJsPath);
  } else {
    res.status(404).send('admin.js not found');
  }
});

const logs = [];
const clients = new Map(); // ip -> { firstSeen, lastSeen, total, byRoute }
const pushLog = (entry) => {
  const tsIso = new Date().toISOString();
  logs.push({ ts: tsIso, ...entry });
  if (logs.length > 200) logs.shift();
  try { insertLog({ ts: Date.now(), route: entry.route, ip: entry.ip, input: entry.input, output: entry.output, error: entry.error, ms: entry.ms }); } catch {}
};

const getIp = (req) => {
  const xfwd = (req.headers['x-forwarded-for'] || '').toString();
  if (xfwd) return xfwd.split(',')[0].trim();
  return (req.ip || req.socket?.remoteAddress || '').toString();
};

const recordClient = (req, route) => {
  const ip = getIp(req) || 'unknown';
  const now = Date.now();
  if (!clients.has(ip)) {
    clients.set(ip, { firstSeen: now, lastSeen: now, total: 0, byRoute: { text: 0, 'text-image': 0, image: 0, 'qwen-chat': 0, 'qwen-photo': 0 } });
  }
  const rec = clients.get(ip);
  rec.lastSeen = now;
  rec.total += 1;
  if (route && rec.byRoute[route] !== undefined) rec.byRoute[route] += 1;
  clients.set(ip, rec);
  return ip;
};

// Basic in-memory stats for monitoring
const stats = {
  'text': { requests: 0, success: 0, errors: 0, llmCalls: 0, totalMs: 0 },
  'text-image': { requests: 0, success: 0, errors: 0, llmCalls: 0, totalMs: 0 },
  'image': { requests: 0, success: 0, errors: 0, llmCalls: 0, totalMs: 0 },
};

const requireAdmin = (req, res, next) => {
  const expected = config.adminToken || '';
  const token = req.query.token || req.headers['x-admin-token'] || '';
  if (!expected || token !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  req.actor = 'admin';
  next();
};

const resolveActor = (token) => {
  if (config.adminToken && token === config.adminToken) return 'admin';
  if (config.operatorToken && token === config.operatorToken) return 'operator';
  return null;
};

const requireRole = (role) => (req, res, next) => {
  const token = req.query.token || req.headers['x-admin-token'] || '';
  const actor = resolveActor(token);
  if (!actor) return res.status(401).json({ error: 'unauthorized' });
  if (role === 'admin' && actor !== 'admin') return res.status(403).json({ error: 'forbidden' });
  req.actor = actor;
  next();
};

app.get('/admin', (req, res) => {
  const adminHtml = path.join(__dirname, '../public/admin.html');
  if (!fs.existsSync(adminHtml)) return res.status(404).send('Not found');
  res.sendFile(adminHtml);
});

// Admin: Prompt management
app.get('/api/v1/admin/prompt', requireRole('operator'), (req, res) => {
  res.json({ prompt: getPrompt() });
});

app.put('/api/v1/admin/prompt', requireRole('admin'), (req, res) => {
  const p = req.body?.prompt || '';
  setPrompt(p);
  const ok = savePrompt();
  insertAudit({ ts: Date.now(), ip: getIp(req), actor: req.actor || 'admin', action: 'prompt.update', details: { size: p.length } });
  res.json({ ok, prompt: getPrompt() });
});

app.post('/api/v1/admin/prompt/apply', requireRole('admin'), (req, res) => {
  const p = req.body?.prompt || '';
  setPrompt(p);
  insertAudit({ ts: Date.now(), ip: getIp(req), actor: req.actor || 'admin', action: 'prompt.apply', details: { size: p.length } });
  res.json({ ok: true, prompt: getPrompt() });
});

app.post('/api/v1/admin/prompt/reset', requireRole('admin'), (req, res) => {
  resetPrompt();
  const ok = savePrompt();
  insertAudit({ ts: Date.now(), ip: getIp(req), actor: req.actor || 'admin', action: 'prompt.reset', details: {} });
  res.json({ ok, prompt: getPrompt() });
});

app.post('/api/v1/admin/prompt/reload', requireRole('admin'), (req, res) => {
  loadPrompt();
  insertAudit({ ts: Date.now(), ip: getIp(req), actor: req.actor || 'admin', action: 'prompt.reload', details: {} });
  res.json({ prompt: getPrompt() });
});

app.post('/api/v1/admin/prompt/save', requireRole('admin'), (req, res) => {
  const ok = savePrompt();
  insertAudit({ ts: Date.now(), ip: getIp(req), actor: req.actor || 'admin', action: 'prompt.save', details: {} });
  res.json({ ok });
});

// Admin: Logs with filters
app.get('/api/v1/admin/logs', requireRole('operator'), async (req, res) => {
  const route = (req.query.route || '').trim();
  const limit = Math.max(1, Math.min(1000, Number(req.query.limit || 200)));
  const since = (req.query.since || '').trim();
  const q = (req.query.q || '').trim();
  let items = logs;
  if (route) items = items.filter(l => String(l.route || '') === route);
  if (since) items = items.filter(l => String(l.ts || '') > since);
  items = items.slice(-limit);
  if (q) {
    try {
      const rows = await searchLogsDb({ q, limit });
      return res.json({ logs: rows.map(r => ({ ts: new Date(r.ts).toISOString(), route: r.route, ip: r.ip, ms: r.ms, output: r.output_text, error: r.error_text })) });
    } catch (e) {
      items = items.filter(l =>
        (l.output && String(l.output).includes(q)) ||
        (l.error && String(l.error).includes(q)) ||
        (l.input && JSON.stringify(l.input).includes(q))
      );
    }
  }
  res.json({ logs: items });
});

app.post('/api/v1/admin/logs/clear', requireRole('admin'), (req, res) => {
  logs.length = 0;
  res.json({ cleared: true });
});

app.get('/api/v1/admin/logs/export', requireRole('operator'), (req, res) => {
  const format = String(req.query.format || 'json').toLowerCase();
  const items = logs.slice().reverse();
  if (format === 'csv') {
    const header = 'ts,route,ip,ms,has_error,output';
    const rows = items.map(l => {
      const safeOutput = String(l.output || '').replace(/"/g, '""').replace(/\n/g, ' ');
      return `${l.ts},${l.route},${l.ip || ''},${l.ms || ''},${l.error ? 1 : 0},"${safeOutput}"`;
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="logs.csv"');
    return res.send([header, ...rows].join('\n'));
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="logs.json"');
  res.json(items);
});

// Admin: Stats and config
app.get('/api/v1/admin/stats', requireRole('operator'), (req, res) => {
  const mk = (s) => ({ ...s, avgMs: s.success > 0 ? Math.round(s.totalMs / s.success) : 0 });
  const usersCount = clients.size;
  const topClients = Array.from(clients.entries())
    .map(([ip, rec]) => ({ ip, total: rec.total, byRoute: rec.byRoute, lastSeen: rec.lastSeen }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
  res.json({
    uptimeSec: Math.round(process.uptime()),
    configured: isConfigured(),
    usersCount,
    stats: {
      text: mk(stats['text']),
      text_image: mk(stats['text-image']),
      image: mk(stats['image']),
    },
    topClients,
  });
});

app.get('/api/v1/admin/stats/daily', requireRole('operator'), async (req, res) => {
  try {
    const days = Math.max(1, Math.min(30, Number(req.query.days || 7)));
    const rows = await queryDailyStats({ days });
    res.json({ days, rows });
  } catch (e) {
    res.status(500).json({ error: 'daily_stats_unavailable' });
  }
});

app.get('/api/v1/admin/config', requireRole('operator'), (req, res) => {
  res.json({
    public: {
      port: config.port,
      limits: config.limits,
      cors: config.cors,
      openaiModel: config.openai.model,
    },
    hasKey: !!config.openai.apiKey,
  });
});

// Admin: Update runtime config and persist to .env
app.post('/api/v1/admin/config/update', requireRole('admin'), (req, res) => {
  const { openaiApiKey, llmModel, adminToken, corsOrigin } = req.body || {};
  const isStrOrUndef = (v) => v === undefined || typeof v === 'string';
  if (![openaiApiKey, llmModel, adminToken, corsOrigin, req.body?.operatorToken].every(isStrOrUndef)) {
    return res.status(400).json({ error: 'invalid_payload' });
  }
  const updates = {};
  if (openaiApiKey !== undefined) updates.OPENAI_API_KEY = String(openaiApiKey);
  if (llmModel !== undefined) updates.LLM_MODEL = String(llmModel);
  if (adminToken !== undefined) updates.ADMIN_TOKEN = String(adminToken);
  if (corsOrigin !== undefined) updates.CORS_ORIGIN = String(corsOrigin);
  if (req.body?.operatorToken !== undefined) updates.OPERATOR_TOKEN = String(req.body.operatorToken);

  const envPath = path.join(__dirname, '..', '.env');
  let current = '';
  if (fs.existsSync(envPath)) current = fs.readFileSync(envPath, 'utf-8');
  const lines = current.split(/\r?\n/).filter(l => l.length > 0);
  const map = new Map();
  for (const l of lines) {
    const idx = l.indexOf('=');
    if (idx > -1) map.set(l.slice(0, idx), l.slice(idx + 1));
  }
  for (const [k, v] of Object.entries(updates)) {
    map.set(k, v);
    process.env[k] = v;
  }
  const out = Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('\n');
  fs.writeFileSync(envPath, out + '\n');

  // Update runtime config object
  config.openai.apiKey = process.env.OPENAI_API_KEY || '';
  config.openai.model = process.env.LLM_MODEL || config.openai.model;
  config.adminToken = process.env.ADMIN_TOKEN || config.adminToken;
  config.operatorToken = process.env.OPERATOR_TOKEN || config.operatorToken;
  config.cors.origin = process.env.CORS_ORIGIN || config.cors.origin;

  insertAudit({ ts: Date.now(), ip: getIp(req), actor: req.actor || 'admin', action: 'config.update', details: updates });
  res.json({
    ok: true,
    configured: isConfigured(),
    public: {
      cors: config.cors,
      openaiModel: config.openai.model,
      qwenEnabled: Boolean(config.qwen.chatUrl && config.qwen.photoUrl)
    },
    hasKey: !!config.openai.apiKey,
    note: adminToken !== undefined ? 'Админ‑токен обновлён — используйте новый токен для следующих запросов.' : undefined,
  });
});

function getClient() {
  return createClient();
}
// Load persisted prompt on startup
loadPrompt();

app.post('/api/v1/analyze/text', async (req, res, next) => {
  try {
    const start = Date.now();
    stats['text'].requests++;
    const { text, context } = validate(TextSchema, req.body || {});
    const messages = buildMessages({ mode: 'text', text, context, systemPrompt: getCompactPrompt('text') });
    const ip = recordClient(req, 'text');
    pushLog({ route: 'text', ip, input: { text, context } });
    try {
      if (!isConfigured()) {
        const ms = (Date.now() - start);
        const answer = compactFallback({ mode: 'text', text, context });
        pushLog({ route: 'text', ip, output: answer });
        stats['text'].success++;
        stats['text'].totalMs += ms;
        try { insertRequest({ ts: Date.now(), route: 'text', ip, success: true, ms, llm: false }); } catch {}
        const plain = ['1','true','yes'].includes(String(req.query.plain || '').toLowerCase());
        if (plain) { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.send(answer); }
        return res.json({ result: answer });
      }
      stats['text'].llmCalls++;
      const client = getClient();
      const result = await client.chat.completions.create({ messages, model: config.openai.model });
      const answer = result.choices?.[0]?.message?.content || '';
      pushLog({ route: 'text', ip, output: answer });
      stats['text'].success++;
      const ms = (Date.now() - start);
      stats['text'].totalMs += ms;
      try { insertRequest({ ts: Date.now(), route: 'text', ip, success: true, ms, llm: true }); } catch {}
      const plain = ['1','true','yes'].includes(String(req.query.plain || '').toLowerCase());
      if (plain) { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.send(answer); }
      return res.json({ result: answer });
    } catch (e) {
      const ms = (Date.now() - start);
      const answer = compactFallback({ mode: 'text', text, context });
      pushLog({ route: 'text', ip, output: answer });
      stats['text'].success++;
      stats['text'].totalMs += ms;
      try { insertRequest({ ts: Date.now(), route: 'text', ip, success: true, ms, llm: false }); } catch {}
      const plain = ['1','true','yes'].includes(String(req.query.plain || '').toLowerCase());
      if (plain) { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.send(answer); }
      return res.json({ result: answer });
    }
  } catch (err) { next(err); }
});

app.post('/api/v1/analyze/text-image', upload.array('images', config.limits.imagesMaxCount), async (req, res, next) => {
  try {
    const start = Date.now();
    stats['text-image'].requests++;
    const text = req.body?.text || req.body?.description || '';
    const context = req.body?.context;
    const imagesFromFiles = (req.files || []).map(toDataUrlFromFile);
    const imagesFromJson = Array.isArray(req.body?.images) ? req.body.images : [];
    const images = [...imagesFromFiles, ...imagesFromJson].filter(Boolean);
    validate(TextImageSchemaJson, { text, images, context });
    const messages = buildMessages({ mode: 'text-image', text, images, context, systemPrompt: getCompactPrompt('text-image') });
    const ip = recordClient(req, 'text-image');
    pushLog({ route: 'text-image', ip, input: { text, imagesCount: images.length, context } });
    try {
      if (!isConfigured()) {
        const ms = (Date.now() - start);
        const answer = compactFallback({ mode: 'text-image', text, context, images });
        pushLog({ route: 'text-image', ip, output: answer });
        stats['text-image'].success++;
        stats['text-image'].totalMs += ms;
        try { insertRequest({ ts: Date.now(), route: 'text-image', ip, success: true, ms, llm: false }); } catch {}
        const plain = ['1','true','yes'].includes(String(req.query.plain || '').toLowerCase());
        if (plain) { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.send(answer); }
        return res.json({ result: answer });
      }
      stats['text-image'].llmCalls++;
      const client = getClient();
      const result = await client.chat.completions.create({ messages, model: config.openai.model });
      const answer = result.choices?.[0]?.message?.content || '';
      pushLog({ route: 'text-image', ip, output: answer });
      stats['text-image'].success++;
      const ms = (Date.now() - start);
      stats['text-image'].totalMs += ms;
      try { insertRequest({ ts: Date.now(), route: 'text-image', ip, success: true, ms, llm: true }); } catch {}
      const plain = ['1','true','yes'].includes(String(req.query.plain || '').toLowerCase());
      if (plain) { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.send(answer); }
      return res.json({ result: answer });
    } catch (e) {
      const ms = (Date.now() - start);
      const answer = compactFallback({ mode: 'text-image', text, context, images });
      pushLog({ route: 'text-image', ip, output: answer });
      stats['text-image'].success++;
      stats['text-image'].totalMs += ms;
      try { insertRequest({ ts: Date.now(), route: 'text-image', ip, success: true, ms, llm: false }); } catch {}
      const plain = ['1','true','yes'].includes(String(req.query.plain || '').toLowerCase());
      if (plain) { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.send(answer); }
      return res.json({ result: answer });
    }
  } catch (err) { next(err); }
});

app.post('/api/v1/analyze/image', upload.array('images', config.limits.imagesMaxCount), async (req, res, next) => {
  try {
    const start = Date.now();
    stats['image'].requests++;
    const imagesFromFiles = (req.files || []).map(toDataUrlFromFile);
    const imagesFromJson = Array.isArray(req.body?.images) ? req.body.images : [];
    const images = [...imagesFromFiles, ...imagesFromJson].filter(Boolean);
    const context = req.body?.context;
    validate(ImageSchemaJson, { images, context });
    const messages = buildMessages({ mode: 'image', images, context, systemPrompt: getCompactPrompt('image') });
    const ip = recordClient(req, 'image');
    pushLog({ route: 'image', ip, input: { imagesCount: images.length, context } });
    try {
      if (!isConfigured()) {
        const ms = (Date.now() - start);
        const answer = compactFallback({ mode: 'image', context, images });
        pushLog({ route: 'image', ip, output: answer });
        stats['image'].success++;
        stats['image'].totalMs += ms;
        try { insertRequest({ ts: Date.now(), route: 'image', ip, success: true, ms, llm: false }); } catch {}
        const plain = ['1','true','yes'].includes(String(req.query.plain || '').toLowerCase());
        if (plain) { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.send(answer); }
        return res.json({ result: answer });
      }
      stats['image'].llmCalls++;
      const client = getClient();
      const result = await client.chat.completions.create({ messages, model: config.openai.model });
      const answer = result.choices?.[0]?.message?.content || '';
      pushLog({ route: 'image', ip, output: answer });
      stats['image'].success++;
      const ms = (Date.now() - start);
      stats['image'].totalMs += ms;
      try { insertRequest({ ts: Date.now(), route: 'image', ip, success: true, ms, llm: true }); } catch {}
      const plain = ['1','true','yes'].includes(String(req.query.plain || '').toLowerCase());
      if (plain) { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.send(answer); }
      return res.json({ result: answer });
    } catch (e) {
      const ms = (Date.now() - start);
      const answer = compactFallback({ mode: 'image', context, images });
      pushLog({ route: 'image', ip, output: answer });
      stats['image'].success++;
      stats['image'].totalMs += ms;
      try { insertRequest({ ts: Date.now(), route: 'image', ip, success: true, ms, llm: false }); } catch {}
      const plain = ['1','true','yes'].includes(String(req.query.plain || '').toLowerCase());
      if (plain) { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.send(answer); }
      return res.json({ result: answer });
    }
  } catch (err) { next(err); }
});

// Qwen: Chat endpoint (messages → reply)
app.post('/api/v1/qwen/chat', async (req, res) => {
  const start = Date.now();
  const ip = recordClient(req, 'qwen-chat');
  pushLog({ route: 'qwen-chat', ip, input: { len: Array.isArray(req.body?.messages) ? req.body.messages.length : 0 } });
  try {
    const schema = z.object({ messages: z.array(z.object({ role: z.string(), content: z.string() })), model: z.string().optional() });
    const { messages, model } = validate(schema, req.body || {});
    const reply = await qwenChat({ messages, model });
    const ms = (Date.now() - start);
    try { insertRequest({ ts: Date.now(), route: 'qwen-chat', ip, success: true, ms, llm: false }); } catch {}
    pushLog({ route: 'qwen-chat', ip, output: reply, ms });
    res.json({ reply });
  } catch (e) {
    const ms = (Date.now() - start);
    try { insertRequest({ ts: Date.now(), route: 'qwen-chat', ip, success: false, ms, llm: false }); } catch {}
    pushLog({ route: 'qwen-chat', ip, error: String(e?.message || e), ms });
    res.status(400).json({ error: 'qwen_chat_failed' });
  }
});

// Qwen: Photo-to-photo (image base64/dataURL + promptText → media_url)
app.post('/api/v1/qwen/photo2photo', async (req, res) => {
  const start = Date.now();
  const ip = recordClient(req, 'qwen-photo');
  pushLog({ route: 'qwen-photo', ip, input: { hasImage: Boolean(req.body?.image), promptText: req.body?.promptText } });
  try {
    const schema = z.object({ image: z.string(), promptText: z.string(), mediaSize: z.string().optional() });
    const { image, promptText, mediaSize } = validate(schema, req.body || {});
    const mediaUrl = await qwenPhoto2Photo({ imageBase64: image, promptText, mediaSize: mediaSize || '16:9' });
    const ms = (Date.now() - start);
    try { insertRequest({ ts: Date.now(), route: 'qwen-photo', ip, success: true, ms, llm: false, output: mediaUrl }); } catch {}
    pushLog({ route: 'qwen-photo', ip, output: String(mediaUrl || ''), ms });
    res.json({ media_url: mediaUrl });
  } catch (e) {
    const ms = (Date.now() - start);
    try { insertRequest({ ts: Date.now(), route: 'qwen-photo', ip, success: false, ms, llm: false }); } catch {}
    pushLog({ route: 'qwen-photo', ip, error: String(e?.message || e), ms });
    res.status(400).json({ error: 'qwen_photo_failed' });
  }
});

function toDataUrlFromFile(file) {
  if (!file || !file.mimetype || !file.buffer) return null;
  const base64 = file.buffer.toString('base64');
  return `data:${file.mimetype};base64,${base64}`;
}

function mockAdvice({ text = '', context = '', imagesCount = 0 }) {
  const t = (text || '').toLowerCase();
  const hasCyr = /[а-яё]/i.test(t);
  const isEn = /[a-z]/i.test(t) && !hasCyr;

  // Topic detection (RU + EN)
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

  // Scam likelihood heuristic
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

  // Partner phrases by topic
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

  // Small plan line
  lines.push(isEn
    ? 'Plan: pick a calm time; use I‑statements; agree 1–2 next steps.'
    : 'План: выберите спокойное время; «я‑сообщения»; договоритесь о 1–2 шагах.');

  // Scam check line
  lines.push(isEn
    ? `Scam check: ${scamLevel} — ${scamReasonEn}.`
    : `Проверка на мошенничество: ${scamLevel} — ${scamReasonRu}.`);

  // Optional extra line when screenshots only or violence
  if (imagesCount > 0 && !text) {
    lines.push(isEn ? 'Note: screenshot‑only input; verify facts gently before conclusions.' : 'Заметка: только скриншоты; мягко уточняйте факты до выводов.');
  } else if (topic === 'violence_safety') {
    lines.push(isEn ? 'Safety: if you feel unsafe, seek support and a safety plan.' : 'Безопасность: при угрозах обратитесь за поддержкой и составьте план.');
  }

  return lines.slice(0, 5).join('\n');
}

const port = process.env.PORT || 3000;
app.get('/health', (req, res) => res.json({ status: 'ok', uptimeSec: Math.round(process.uptime()), configured: isConfigured(), model: config.openai.model }));

// Admin: Audit trail
app.get('/api/v1/admin/audit', requireRole('admin'), async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit || 100)));
    const rows = await getAudit({ limit });
    res.json({ audit: rows });
  } catch (e) {
    res.status(500).json({ error: 'audit_unavailable' });
  }
});

app.use((req, res, next) => {
  res.status(404).json({ error: 'not_found' });
});

app.use((err, req, res, next) => {
  const code = err.status || 500;
  res.status(code).json({ error: err.message || 'error' });
});

// Запуск HTTP или HTTPS в зависимости от конфигурации
const startHttp = () => {
  app.listen(config.port, () => {
    console.log(`Cheater Buster API listening on http://localhost:${config.port}`);
    console.log(`Swagger docs available at http://localhost:${config.port}/docs`);
  });
};

const startHttps = () => {
  try {
    const keyPath = config.https.keyPath;
    const certPath = config.https.certPath;
    if (!keyPath || !certPath || !fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
      console.warn('HTTPS requested but key/cert not found — falling back to HTTP');
      return startHttp();
    }
    const options = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
    https.createServer(options, app).listen(config.port, () => {
      console.log(`Cheater Buster API listening on https://localhost:${config.port}`);
      console.log(`Swagger docs available at https://localhost:${config.port}/docs`);
    });
  } catch (e) {
    console.warn('HTTPS start failed:', e.message);
    startHttp();
  }
};

if (config.https.enable) {
  startHttps();
} else {
  startHttp();
}