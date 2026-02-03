import { insertResult } from "./db";
import fs from "fs";
import os from "os";

type Options = {
  pushSwapPath?: string;
  checkerPath?: string;
  minLength?: number;
  maxLength?: number;
  iterations?: number;
  concurrency?: number;
  delayMs?: number;
  timeoutMs?: number;
  maxTotalJobs?: number;
  retries?: number;
};

let running = false;
let stopRequested = false;
let lastProgressLog = 0;
const subscribers = new Set<(payload: any) => void>();
const activeChildren = new Set<any>();

export function subscribe(cb: (payload: any) => void) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

function broadcast(payload: any) {
  for (const cb of subscribers) {
    try {
      cb(payload);
    } catch (e) {
      // ignore subscriber errors
    }
  }
}

function shuffle(array: any[]) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = array[i];
    array[i] = array[j];
    array[j] = tmp;
  }
}

function genSequence(n: number) {
  const arr = Array.from({ length: n }, (_, i) => i + 1);
  shuffle(arr);
  return arr;
}

export async function startSimulation(opts: Options = {}) {
  if (running) throw new Error("Simulation already running");
  running = true;
  stopRequested = false;

  const {
    pushSwapPath = "./push_swap",
    checkerPath = "./checker",
    minLength = 3,
    maxLength = 10,
    iterations = 100,
    concurrency = os.cpus().length * 2,
    delayMs = 0,
    timeoutMs = 60_000,
    maxTotalJobs = 100_000,
    retries = 1,
  } = opts;

  // validate and clamp
  const minL = Math.max(1, Math.trunc(minLength));
  const maxL = Math.max(minL, Math.trunc(maxLength));
  const iters = Math.max(0, Math.trunc(iterations));
  const conc = Math.max(1, Math.trunc(concurrency));
  const delay = Math.max(0, Math.trunc(delayMs));
  const tmo = Math.max(100, Math.trunc(timeoutMs));
  const maxJobs = Math.max(1, Math.trunc(maxTotalJobs));
  const maxRetries = Math.max(0, Math.trunc(retries));

  // Preflight: ensure binaries exist and are executable. Broadcast a clear error if not.
  try {
    fs.accessSync(pushSwapPath, fs.constants.X_OK);
  } catch (e) {
    const msg = `push_swap not found or not executable: ${pushSwapPath}`;
    broadcast({ type: "fatal", error: msg });
    running = false;
    return;
  }
  try {
    fs.accessSync(checkerPath, fs.constants.X_OK);
  } catch (e) {
    const msg = `checker not found or not executable: ${checkerPath}`;
    broadcast({ type: "fatal", error: msg });
    running = false;
    return;
  }

  let total = 0;
  const jobs: { id: number; length: number; seq?: number[] }[] = [];
  let nextId = 1;

  for (let len = minL; len <= maxL; len++) {
    for (let i = 0; i < iters; i++) {
      if (jobs.length >= maxJobs) break;
      jobs.push({ id: nextId++, length: len });
    }
    if (jobs.length >= maxJobs) break;
  }

  if (jobs.length === 0) {
    running = false;
    broadcast({ type: "stopped", total: 0, reason: "no-jobs" });
    return;
  }

  // Reset progress logging timer
  lastProgressLog = 0;
  console.log(`[Simulation] Starting with ${jobs.length} jobs (lengths ${minL}-${maxL}, ${iters} iterations each)`);


  function killChild(c: any) {
    try {
      if (c && typeof c.kill === "function") c.kill();
      else if (c && typeof c.terminate === "function") c.terminate();
    } catch (e) {
      // ignore
    }
  }

  async function runJob(job: { id: number; length: number; seq?: number[] }) {
    let attempt = 0;
    while (attempt <= maxRetries && !stopRequested) {
      attempt++;
      const seq = job.seq ?? genSequence(job.length);
      const t0 = Date.now();
      let ps: any = null;
      let ch: any = null;

      try {
        // Spawn push_swap
        ps = Bun.spawn({ cmd: [pushSwapPath, ...seq.map(String)], stdout: "pipe", stderr: "pipe" });
        activeChildren.add(ps);

        const psOutPromise = new Response(ps.stdout).text();
        const psErrPromise = new Response(ps.stderr).text();

        // wait with timeout
        await Promise.race([
          ps.exited,
          new Promise((_, rej) => setTimeout(() => rej(new Error("push_swap timeout")), tmo)),
        ]);

        const psOut = await psOutPromise.catch(() => "");
        const psErr = await psErrPromise.catch(() => "");

        // Spawn checker and feed stdout
        ch = Bun.spawn({ cmd: [checkerPath, ...seq.map(String)], stdout: "pipe", stdin: "pipe", stderr: "pipe" });
        activeChildren.add(ch);

        if (ch.stdin) {
          try {
            // try writable stream approach
            const gw = (ch.stdin as any).getWriter?.();
            if (gw) {
              await gw.write(new TextEncoder().encode(psOut));
              await gw.close();
            } else if (typeof (ch.stdin as any).write === "function") {
              await (ch.stdin as any).write(psOut);
              if (typeof (ch.stdin as any).end === "function") (ch.stdin as any).end();
            }
          } catch (e) {
            // ignore
          }
        }

        await Promise.race([
          ch.exited,
          new Promise((_, rej) => setTimeout(() => rej(new Error("checker timeout")), tmo)),
        ]);

		// Output must be "OK" or "KO"
		const chOutPromise = new Response(ch.stdout).text();
        const valid = ((await chOutPromise.catch(() => "")).trim() === "OK");
        const ops = (psOut || "").split(/\r?\n/).filter(Boolean).length;
        const runtime_ms = Date.now() - t0;

        // persist result
        try {
          insertResult({ seq, length: job.length, operations: ops, valid, runtime_ms });
        } catch (e) {
          // db insert failed, but continue
          broadcast({ type: "db-error", job: job.id, error: String(e) });
        }

        total++;
        
        // Periodically log completion percentage (every 5 seconds)
        const now = Date.now();
        if (now - lastProgressLog > 5000) {
          const percent = ((total / jobs.length) * 100).toFixed(1);
          console.log(`[Simulation] Progress: ${total}/${jobs.length} jobs completed (${percent}%)`);
          lastProgressLog = now;
        }
        
        broadcast({ type: "progress", total, job: job.id, attempt, last: { length: job.length, operations: ops, valid, runtime_ms } });

        // finished successfully, break retry loop
        break;
      } catch (err) {
        // kill any still-running children for this job
        if (ps) killChild(ps);
        if (ch) killChild(ch);
        broadcast({ type: "job-error", job: job.id, attempt, error: String(err) });
        if (attempt > maxRetries) {
          broadcast({ type: "job-failed", job: job.id, attempts: attempt });
        } else {
          // Re-queue the job for retry instead of blocking
          jobQueue.push({ ...job, attempts: attempt });
        }
      } finally {
        if (ps) activeChildren.delete(ps);
        if (ch) activeChildren.delete(ch);
      }
    }
  }

  const jobQueue: { id: number; length: number; seq?: number[]; attempts?: number }[] = [...jobs];
  let jobIndex = 0;

  function getNextJob() {
    if (jobIndex < jobQueue.length) {
      return jobQueue[jobIndex++];
    }
    return null;
  }

  const worker = async () => {
    while (!stopRequested) {
      const job = getNextJob();
      if (!job) break;
      await runJob(job);
      if (delay) await new Promise((r) => setTimeout(r, delay));
    }
  };

  const workers: Promise<void>[] = [];
  for (let i = 0; i < conc; i++) workers.push(worker());

  // wait for workers to finish
  await Promise.all(workers);

  // ensure any active children are terminated on stop
  if (stopRequested) {
    for (const c of Array.from(activeChildren)) {
      try {
        if (c && typeof c.kill === "function") c.kill();
      } catch (e) {
        // ignore
      }
    }
  }

  running = false;
  const percent = ((total / jobs.length) * 100).toFixed(1);
  const status = stopRequested ? "STOPPED" : "COMPLETED";
  console.log(`[Simulation] ${status}: ${total}/${jobs.length} jobs (${percent}%)`);
  broadcast({ type: "stopped", total });
}

export function stopSimulation() {
  stopRequested = true;
  // kill any active children immediately
  for (const c of Array.from(activeChildren)) {
    try {
      if (c && typeof c.kill === "function") c.kill();
    } catch (e) {
      // ignore
    }
  }
}

export function isRunning() {
  return running;
}

export function subscribersCount() {
  return subscribers.size;
}
