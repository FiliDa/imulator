#!/usr/bin/env node
/**
 * Generate 5 text→text JSON results and save to a file.
 * Usage: node scripts/make-5-tests-json.js --out tests/test_txt_txt_5v1.json --base http://localhost:3000
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
let out = 'test_txt_txt_5v1.json';
let base = 'http://localhost:3000';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out' && args[i + 1]) out = args[i + 1];
  if (args[i] === '--base' && args[i + 1]) base = args[i + 1];
}

const tests = [
  {
    text: "My girlfriend has specific sexual preferences (e.g., BDSM); how can we discuss safely and respectfully without pressure?",
    context: "We disagree on sexual preferences; consent boundaries unclear; we want a safety plan and mutual respect.",
  },
  {
    text: "My boyfriend suddenly hides his phone and changed the passcode; is he cheating?",
    context: "We reconciled after past cheating; I saw messages around 2am he denies; trust is fragile; his story changes and he avoids specifics.",
  },
  {
    text: "I want a dog; my boyfriend refuses. How can we negotiate fairly?",
    context: "We live together; he worries about time, costs, and allergies; I feel strongly; we need a realistic compromise and boundaries.",
  },
  {
    text: "I’m tempted to explore with another woman but keep my relationship with my boyfriend. How do we handle this ethically?",
    context: "We value monogamy; I feel curiosity; we need an honest conversation about boundaries, consent, risks, and possible relationship structures.",
  },
  {
    text: "She wants specific kinks that make me anxious; how do I express concerns without shaming and find shared ground?",
    context: "Emotional safety first; agree on limits; consider gradual exploration, check-ins, safe words, and the option to stop without blame.",
  },
];

async function run() {
  const results = [];
  for (const t of tests) {
    try {
      const resp = await fetch(`${base}/api/v1/analyze/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t.text, context: t.context }),
      });
      const json = await resp.json();
      results.push({
        route: '/api/v1/analyze/text',
        plain: false,
        text: t.text,
        context: t.context,
        statusCode: resp.status,
        result: json.result,
      });
    } catch (err) {
      results.push({
        route: '/api/v1/analyze/text',
        plain: false,
        text: t.text,
        context: t.context,
        statusCode: 500,
        error: String(err && err.message || err),
      });
    }
  }
  const outDir = path.dirname(out);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(out, JSON.stringify(results, null, 2), 'utf8');
  // Probe write to confirm filesystem access
  try { fs.writeFileSync(path.join(outDir, 'probe-node.txt'), 'ok', 'utf8'); } catch {}
  console.log(`Saved results to: ${out}`);
}

run().catch((e) => {
  console.error('Failed:', e);
  process.exit(1);
});