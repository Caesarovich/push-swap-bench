import { serve } from "bun";
import index from "./index.html";
import { startSimulation, stopSimulation, subscribe, isRunning, subscribersCount } from "./server/simulator";
import { getStats, getRuntimeStats, getRecent, getOperationsByLength, getPercentilesByLength, db } from "./server/db";

const server = serve({
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/simulations/start": async req => {
      if (req.method !== "POST") return new Response(null, { status: 405 });
      try {
        const body = await req.json().catch(() => ({}));
        // startSimulation will run until completion; we start it and return immediately
        startSimulation(body).catch(err => console.error("simulation error:", err));
        return Response.json({ started: true });
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 400 });
      }
    },

    "/api/simulations/stop": async req => {
      if (req.method !== "POST") return new Response(null, { status: 405 });
      stopSimulation();
      return Response.json({ stopped: true });
    },

    "/api/stats": async () => {
      return Response.json(getStats());
    },
    "/api/runtime-stats": async () => {
      return Response.json(getRuntimeStats());
    },

    "/api/recent": async () => {
      return Response.json(getRecent(100));
    },

    "/api/histogram": async req => {
      const url = new URL(req.url);
      const length = Number(url.searchParams.get("length") || "0");
      const limit = Number(url.searchParams.get("limit") || "1000");
      if (!length || length <= 0) return Response.json({ error: "invalid length" }, { status: 400 });
      try {
        const ops = getOperationsByLength(length, limit);
        return Response.json({ length, count: ops.length, operations: ops });
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },

    "/api/percentiles": async req => {
      try {
        const url = new URL(req.url);
        const limit = Number(url.searchParams.get("limit") || "2000");
        const data = getPercentilesByLength(limit);
        return Response.json(data);
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },

    "/api/export.csv": async () => {
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode("id,seq,length,operations,valid,runtime_ms,created_at\n"));
          try {
            const stmt = db.query("SELECT id, seq, length, operations, valid, runtime_ms, created_at FROM results ORDER BY id");
            for (const anyRow of stmt.iterate()) {
              const row = anyRow as any;
              const line = `${row.id},"${String(row.seq).replace(/"/g, '""')}",${row.length},${row.operations},${row.valid},${row.runtime_ms},${row.created_at}\n`;
              controller.enqueue(encoder.encode(line));
            }
          } catch (e) {
            controller.enqueue(encoder.encode(`# error: ${String(e)}\n`));
          } finally {
            try {
              controller.close();
            } catch (e) {}
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": "attachment; filename=results.csv",
        },
      });
    },

    "/api/reset": async req => {
      if (req.method !== "POST") return new Response(null, { status: 405 });
      try {
        db.run("DELETE FROM results;");
        return Response.json({ ok: true });
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },

    // Server-Sent Events endpoint for live updates
    "/api/stream": async req => {
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          function send(obj: any) {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
            } catch (e) {
              // ignore enqueue errors
            }
          }

          const unsub = subscribe((payload: any) => send(payload));
          const iv = setInterval(() => send({ type: "heartbeat", time: Date.now(), running: isRunning(), subscribers: subscribersCount() }), 5000);
          // send an initial state
          send({ type: "init", running: isRunning(), subscribers: subscribersCount() });

          // close when client disconnects
          (req as any).signal?.addEventListener("abort", () => {
            clearInterval(iv);
            unsub();
            try {
              controller.close();
            } catch (e) {
              // ignore
            }
          });
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
