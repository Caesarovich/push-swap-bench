import { Database } from "bun:sqlite";

const DB_PATH = "./simulations.sqlite";
export const db = new Database(DB_PATH, { create: true });

// improve concurrency for readers
try {
  db.run("PRAGMA journal_mode = WAL;");
} catch (e) {
  // ignore if pragma fails
}

db.run(`CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seq TEXT,
  length INTEGER,
  operations INTEGER,
  valid INTEGER,
  runtime_ms REAL,
  created_at INTEGER
);`);

const insertStmt = db.prepare(
  "INSERT INTO results (seq, length, operations, valid, runtime_ms, created_at) VALUES ($seq, $length, $operations, $valid, $runtime_ms, $created_at)"
);

export function insertResult({ seq, length, operations, valid, runtime_ms }: { seq: number[]; length: number; operations: number; valid: boolean; runtime_ms: number }) {
  insertStmt.run({
    $seq: JSON.stringify(seq),
    $length: length,
    $operations: operations,
    $valid: valid ? 1 : 0,
    $runtime_ms: runtime_ms,
    $created_at: Date.now(),
  });
}

export function getStats() {
  return db
    .query(
      `SELECT length, COUNT(*) AS count, AVG(operations) AS avg_ops, MIN(operations) AS min_ops, MAX(operations) AS max_ops, SUM(valid) AS valid_count FROM results GROUP BY length ORDER BY length`
    )
    .all()
    .map((r: any) => ({
      ...r,
      valid_rate: r.count ? Number(r.valid_count) / Number(r.count) : 0,
    }));
}

export function getRuntimeStats() {
  return db
    .query(
      `SELECT length, COUNT(*) AS count, AVG(runtime_ms) AS avg_runtime, MIN(runtime_ms) AS min_runtime, MAX(runtime_ms) AS max_runtime FROM results GROUP BY length ORDER BY length`
    )
    .all();
}

export function getRecent(limit = 100) {
  return db.query("SELECT * FROM results ORDER BY id DESC LIMIT ?1").all(limit);
}

export function getOperationsByLength(length: number, limit = 1000) {
  const rows = db.query("SELECT operations FROM results WHERE length = ?1 ORDER BY id DESC LIMIT ?2").all(length, limit);
  // rows are objects like { operations: number }
  return rows.map((r: any) => r.operations as number);
}

export function getPercentilesByLength(limitPerLength = 2000) {
  // get distinct lengths
  const lengths = db.query("SELECT DISTINCT length FROM results ORDER BY length").all().map((r: any) => r.length as number);
  const out: any[] = [];
  for (const len of lengths) {
    const rows = db.query("SELECT operations, valid FROM results WHERE length = ?1 ORDER BY id DESC LIMIT ?2").all(len, limitPerLength);
    const ops = rows.map((r: any) => Number(r.operations)).sort((a: number, b: number) => a - b);
    const count = ops.length;
    const sumValid = rows.reduce((acc: number, r: any) => acc + (Number(r.valid) || 0), 0);
    const avg = count ? ops.reduce((a: number, b: number) => a + b, 0) / count : 0;
    const min = count ? ops[0] : 0;
    const max = count ? ops[ops.length - 1] : 0;

    function pct(p: number) {
      if (count === 0) return 0;
      const idx = Math.floor((p / 100) * (count - 1));
      return ops[Math.max(0, Math.min(count - 1, idx))];
    }

    out.push({
      length: len,
      count,
      avg,
      min,
      max,
      p50: pct(50),
      p75: pct(75),
      p90: pct(90),
      p99: pct(99),
      valid_rate: count ? sumValid / count : 0,
    });
  }
  return out;
}

export default db;
