// A tiny D1-compatible driver on top of node:sqlite, so the Worker routes can
// be exercised against the real migrations in plain `node --test`.
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { errorResponse } from '../../src/worker/lib/http.js';

class Stmt {
  constructor(db, sql, counter) {
    this.db = db;
    this.sql = sql;
    this.counter = counter;
    this.args = [];
  }

  bind(...args) {
    this.args = args.map((a) => (a === undefined || a === null ? null : typeof a === 'boolean' ? Number(a) : a));
    return this;
  }

  #prepared() {
    this.counter.count += 1;
    this.counter.log.push(this.sql.replace(/\s+/g, ' ').trim().slice(0, 90));
    return this.db.prepare(this.sql);
  }

  async first() {
    const row = this.#prepared().get(...this.args);
    return row === undefined ? null : row;
  }

  async all() {
    return { results: this.#prepared().all(...this.args), success: true };
  }

  async run() {
    const info = this.#prepared().run(...this.args);
    return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
  }
}

/** Fresh in-memory database with every migration applied, in order. */
export function createTestEnv() {
  const db = new DatabaseSync(':memory:');
  const dir = new URL('../../migrations/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) db.exec(readFileSync(new URL(file, dir), 'utf8'));
  const counter = { count: 0, log: [] };
  const env = {
    DB: { prepare: (sql) => new Stmt(db, sql, counter) },
    __sqlite: db,
    __queries: counter,
    migrations: files,
  };
  return env;
}

/** Number of D1 statements executed by `fn`. */
export async function countQueries(env, fn) {
  const before = env.__queries.count;
  const value = await fn();
  return { value, queries: env.__queries.count - before };
}

/** Absolutizes the throwaway URLs the tests pass in. */
function abs(url) {
  return /^https?:/.test(String(url)) ? String(url) : `http://localhost/api/${String(url).replace(/^\/+/, '')}`;
}

export function jsonRequest(url, body, { method = 'POST', token } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(abs(url), { method, headers, body: JSON.stringify(body) });
}

export function getRequest(url, { token } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(abs(url), { method: 'GET', headers });
}

/** Runs a route handler and returns { status, body } like the Worker would. */
export async function call(handler) {
  let response;
  try {
    response = await handler();
  } catch (e) {
    response = errorResponse(e);
  }
  return { status: response.status, body: await response.json() };
}
