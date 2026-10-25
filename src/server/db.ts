import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { Job, JobInput } from '../shared/scheduler.js';
import type { Quote } from '../shared/economics.js';

export interface Charter {
  id: string;
  ref: string;
  company: string;
  contactEmail: string;
  vesselId: string | null;
  createdAt: number;
  status: 'reserved' | 'cancelled';
  quote: Quote;
}

export interface WaitlistEntry {
  id: string;
  email: string;
  company: string;
  mw: number;
  useCase: string;
  createdAt: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS charters (
  id TEXT PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  company TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  vessel_id TEXT,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  quote_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  input_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS waitlist (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  company TEXT NOT NULL,
  mw REAL NOT NULL,
  use_case TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

type Row = Record<string, string | number | null>;

export class Store {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // ── meta ──────────────────────────────────────────────────────────────
  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as Row | undefined;
    return row ? String(row.value) : null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  // ── charters ──────────────────────────────────────────────────────────
  createCharter(input: Omit<Charter, 'id' | 'ref' | 'createdAt' | 'status'>): Charter {
    const id = randomUUID();
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM charters').get() as Row).n as number;
    const ref = `CP-${String(2601 + count).padStart(4, '0')}-${id.slice(0, 4).toUpperCase()}`;
    const charter: Charter = { ...input, id, ref, createdAt: Date.now(), status: 'reserved' };
    this.db
      .prepare(
        'INSERT INTO charters (id, ref, company, contact_email, vessel_id, created_at, status, quote_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        ref,
        charter.company,
        charter.contactEmail,
        charter.vesselId,
        charter.createdAt,
        charter.status,
        JSON.stringify(charter.quote),
      );
    return charter;
  }

  listCharters(): Charter[] {
    const rows = this.db.prepare('SELECT * FROM charters ORDER BY created_at DESC').all() as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      ref: String(r.ref),
      company: String(r.company),
      contactEmail: String(r.contact_email),
      vesselId: r.vessel_id === null ? null : String(r.vessel_id),
      createdAt: Number(r.created_at),
      status: r.status as Charter['status'],
      quote: JSON.parse(String(r.quote_json)) as Quote,
    }));
  }

  cancelCharter(id: string): boolean {
    const res = this.db
      .prepare("UPDATE charters SET status = 'cancelled' WHERE id = ? AND status = 'reserved'")
      .run(id);
    return Number(res.changes) > 0;
  }

  // ── jobs ──────────────────────────────────────────────────────────────
  createJob(input: JobInput): Job {
    const job: Job = { ...input, id: randomUUID(), createdAt: Date.now() };
    this.db
      .prepare('INSERT INTO jobs (id, created_at, input_json) VALUES (?, ?, ?)')
      .run(job.id, job.createdAt, JSON.stringify(input));
    return job;
  }

  listJobs(): Job[] {
    const rows = this.db.prepare('SELECT * FROM jobs ORDER BY created_at ASC').all() as Row[];
    return rows.map((r) => ({
      ...(JSON.parse(String(r.input_json)) as JobInput),
      id: String(r.id),
      createdAt: Number(r.created_at),
    }));
  }

  deleteJob(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM jobs WHERE id = ?').run(id).changes) > 0;
  }

  clearJobs(): void {
    this.db.exec('DELETE FROM jobs');
  }

  // ── waitlist ──────────────────────────────────────────────────────────
  addToWaitlist(input: Omit<WaitlistEntry, 'id' | 'createdAt'>): {
    entry: WaitlistEntry;
    position: number;
    duplicate: boolean;
  } {
    const existing = this.db.prepare('SELECT * FROM waitlist WHERE email = ?').get(input.email) as
      Row | undefined;
    if (existing) {
      const position = (
        this.db
          .prepare('SELECT COUNT(*) AS n FROM waitlist WHERE created_at <= ?')
          .get(existing.created_at) as Row
      ).n as number;
      return {
        entry: {
          id: String(existing.id),
          email: String(existing.email),
          company: String(existing.company),
          mw: Number(existing.mw),
          useCase: String(existing.use_case),
          createdAt: Number(existing.created_at),
        },
        position,
        duplicate: true,
      };
    }
    const entry: WaitlistEntry = { ...input, id: randomUUID(), createdAt: Date.now() };
    this.db
      .prepare(
        'INSERT INTO waitlist (id, email, company, mw, use_case, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(entry.id, entry.email, entry.company, entry.mw, entry.useCase, entry.createdAt);
    const position = (this.db.prepare('SELECT COUNT(*) AS n FROM waitlist').get() as Row)
      .n as number;
    return { entry, position, duplicate: false };
  }

  waitlistStats(): { count: number; mw: number } {
    const r = this.db
      .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(mw), 0) AS mw FROM waitlist')
      .get() as Row;
    return { count: Number(r.n), mw: Number(r.mw) };
  }
}
