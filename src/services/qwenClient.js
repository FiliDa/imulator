import { config } from '../config.js';

function basicAuthHeader() {
  const user = config.qwen.user;
  const pass = config.qwen.pass;
  if (!user || !pass) return {};
  const token = Buffer.from(`${user}:${pass}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

export function isQwenConfigured() {
  return Boolean(config.qwen.chatUrl && config.qwen.photoUrl);
}

export async function qwenChat({ messages, model }) {
  const url = config.qwen.chatUrl;
  const headers = { 'Content-Type': 'application/json', ...basicAuthHeader() };
  const body = { messages };
  if (model) body.model = model;
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`qwen_chat_failed_${r.status}`);
  const data = await r.json();
  if (data?.reply) return data.reply;
  if (Array.isArray(data?.choices)) return data.choices[0]?.message?.content || '';
  if (data?.output?.text) return data.output.text;
  return typeof data === 'string' ? data : JSON.stringify(data);
}

export async function qwenPhoto2Photo({ imageBase64, promptText, mediaSize = '16:9' }) {
  const url = new URL(config.qwen.photoUrl);
  url.searchParams.set('appId', config.qwen.appId || 'test');
  url.searchParams.set('userId', config.qwen.userId || 'test');
  const headers = { ...basicAuthHeader() };

  // Normalize input: data URL or pure base64
  let base64 = String(imageBase64 || '');
  const m = base64.match(/^data:(.+?);base64,(.+)$/);
  let mime = 'image/jpeg';
  if (m) { mime = m[1]; base64 = m[2]; }
  const buf = Buffer.from(base64, 'base64');

  const form = new FormData();
  const file = new Blob([buf], { type: mime });
  form.append('image', file, 'photo');
  form.append('body', JSON.stringify({ promptText, mediaSize }));

  const r = await fetch(url, { method: 'POST', headers, body: form });
  if (!r.ok) throw new Error(`qwen_photo_failed_${r.status}`);
  const data = await r.json();
  return data?.media_url || null;
}