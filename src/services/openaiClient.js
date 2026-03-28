import OpenAI from 'openai';
import { config } from '../config.js';

export function isConfigured() {
  return Boolean(config.openai.apiKey) && Boolean(config.openai.model);
}

export function createClient() {
  if (!isConfigured()) {
    return { chat: { completions: { create: async () => ({ choices: [{ message: { content: '' } }] }) } } };
  }
  const client = new OpenAI({ apiKey: config.openai.apiKey });
  return client;
}