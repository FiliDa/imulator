import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: Number(process.env.PORT || 9999),
  adminToken: process.env.ADMIN_TOKEN || '',
  operatorToken: process.env.OPERATOR_TOKEN || '',
  https: {
    enable: String(process.env.HTTPS_ENABLE || '').toLowerCase() === 'true',
    keyPath: process.env.SSL_KEY_PATH || '',
    certPath: process.env.SSL_CERT_PATH || ''
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || process.env.CHATGPT_TOKEN || '',
    model: process.env.LLM_MODEL || 'gpt-4o-mini'
  },
  qwen: {
    chatUrl: process.env.QWEN_CHAT_URL || 'https://trust.coreapis.space/qwen/api/v1/chat',
    photoUrl: process.env.QWEN_PHOTO_URL || 'https://trust.coreapis.space/qwen/api/v1/photo2photo',
    user: process.env.QWEN_USER || '',
    pass: process.env.QWEN_PASS || '',
    appId: process.env.QWEN_APP_ID || 'test',
    userId: process.env.QWEN_UID || 'test'
  },
  limits: {
    json: '4mb',
    fileSize: 5 * 1024 * 1024,
    imagesMaxCount: 4
  },
  cors: {
    origin: process.env.CORS_ORIGIN || '*'
  }
};