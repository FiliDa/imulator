import fs from 'fs';
import path from 'path';

// Lazy init to avoid crashing if sqlite3 is not installed yet
let sqlite3;
try {
  // sqlite3 is CommonJS; default import works in ESM
  // eslint-disable-next-line import/no-extraneous-dependencies
  // @ts-ignore
  sqlite3 = (await import('sqlite3')).default;
} catch (e) {
  sqlite3 = null;
}

const dataDir = path.resolve(process.cwd(), 'data');
const dbFile = path.join(dataDir, 'cheater-buster.db');

function ensureDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

let db = null;

export function getDB() {
  if (!sqlite3) return null;
  if (db) return db;
  ensureDir();
  db = new sqlite3.Database(dbFile);
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      route TEXT,
      ip TEXT,
      input_json TEXT,
      output_text TEXT,
      error_text TEXT,
      ms INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      route TEXT,
      ip TEXT,
      success INTEGER,
      ms INTEGER,
      llm INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      ip TEXT,
      actor TEXT,
      action TEXT,
      details_json TEXT
    )`);
  });
  return db;
}

export function insertLog({ ts, route, ip, input, output, error, ms }) {
  const database = getDB();
  if (!database) return;
  const stmt = database.prepare(
    'INSERT INTO logs (ts, route, ip, input_json, output_text, error_text, ms) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  stmt.run(
    ts,
    route || '',
    ip || '',
    JSON.stringify(input ?? null),
    output ?? '',
    error ?? '',
    ms ?? null
  );
  stmt.finalize();
}

export function insertRequest({ ts, route, ip, success, ms, llm }) {
  const database = getDB();
  if (!database) return;
  const stmt = database.prepare(
    'INSERT INTO requests (ts, route, ip, success, ms, llm) VALUES (?, ?, ?, ?, ?, ?)'
  );
  stmt.run(ts, route || '', ip || '', success ? 1 : 0, ms ?? null, llm ? 1 : 0);
  stmt.finalize();
}

export function insertAudit({ ts, ip, actor, action, details }) {
  const database = getDB();
  if (!database) return;
  const stmt = database.prepare(
    'INSERT INTO admin_audit (ts, ip, actor, action, details_json) VALUES (?, ?, ?, ?, ?)'
  );
  stmt.run(ts, ip || '', actor || 'unknown', action || '', JSON.stringify(details ?? null));
  stmt.finalize();
}

export function queryDailyStats({ days = 7 }) {
  const database = getDB();
  if (!database) return [];
  const sinceTs = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT date(ts/1000, 'unixepoch') as day,
             COUNT(*) as total,
             SUM(success) as success,
             AVG(ms) as avg_ms,
             SUM(llm) as llm_calls
      FROM requests
      WHERE ts >= ?
      GROUP BY day
      ORDER BY day DESC
    `;
    database.all(sql, [sinceTs], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

export function searchLogs({ q, limit = 200 }) {
  const database = getDB();
  if (!database || !q) return [];
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT ts, route, ip, input_json, output_text, error_text, ms
      FROM logs
      WHERE (output_text LIKE ? OR error_text LIKE ? OR input_json LIKE ?)
      ORDER BY ts DESC
      LIMIT ?
    `;
    const like = `%${q}%`;
    database.all(sql, [like, like, like, limit], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

export function getAudit({ limit = 100 }) {
  const database = getDB();
  if (!database) return [];
  return new Promise((resolve, reject) => {
    database.all(
      'SELECT ts, ip, actor, action, details_json FROM admin_audit ORDER BY ts DESC LIMIT ?',
      [limit],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      }
    );
  });
}