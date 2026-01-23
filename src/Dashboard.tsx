import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveContainer,
  ComposedChart,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Bar,
  Line,
  ErrorBar,
  Legend,
} from "recharts";

type StatRow = { length: number; count: number; avg_ops: number; min_ops: number; max_ops: number; valid_rate?: number };
type ResultRow = { id: number; seq: string; length: number; operations: number; valid: number; runtime_ms: number; created_at: number };

export function Dashboard() {
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<any[]>([]);
  const [stats, setStats] = useState<StatRow[]>([]);
  const [percentiles, setPercentiles] = useState<any[]>([]);
  const [recent, setRecent] = useState<ResultRow[]>([]);
  const [runtimeStats, setRuntimeStats] = useState<any[]>([]);
  const [progressPercent, setProgressPercent] = useState<number | null>(null);

  const [minLength, setMinLength] = useState(3);
  const [maxLength, setMaxLength] = useState(8);
  const [iterations, setIterations] = useState(50);
  const [concurrency, setConcurrency] = useState(2);
  const esRef = useRef<EventSource | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<"events" | "results">("events");

  // derived metrics
  const totalRuns = stats.reduce((acc, s) => acc + (s.count || 0), 0);
  const overallAvg = totalRuns > 0 ? Math.round(stats.reduce((acc, s) => acc + (s.avg_ops || 0) * (s.count || 0), 0) / totalRuns) : 0;
  const overallValid = totalRuns > 0 ? Math.round((stats.reduce((acc, s) => acc + ((s.valid_rate || 0) * (s.count || 0)), 0) / totalRuns) * 100) : 0;

  // theme (persisted)
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      if (typeof window === "undefined") return "dark";
      const stored = localStorage.getItem("theme");
      if (stored === "dark" || stored === "light") return stored;
      return document.documentElement.classList.contains("dark") ? "dark" : "light";
    } catch (e) {
      return "dark";
    }
  });

  useEffect(() => {
    try {
      if (theme === "dark") document.documentElement.classList.add("dark");
      else document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", theme);
    } catch (e) {
      // ignore
    }
  }, [theme]);

  useEffect(() => {
    // initial fetches
    fetchStats();
    fetchRecent();
    fetchPercentiles();
    fetchRuntimeStats();

    // SSE stream for live events
    const es = new EventSource("/api/stream");
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const obj = JSON.parse(e.data);
        setEvents((prev) => [obj, ...prev].slice(0, 500));
        if (typeof obj.progress === "number") {
          setProgressPercent(Math.round(obj.progress));
        }
        if (obj.type === "init") setRunning(Boolean(obj.running));
        if (obj.type === "progress") {
          setRunning(true);
          // refresh some UI parts
          fetchStats();
          fetchRecent();
          fetchPercentiles();
          fetchRuntimeStats();
        }
        if (obj.type === "stopped") {
          setRunning(false);
          setProgressPercent(null);
          fetchStats();
          fetchRecent();
          fetchPercentiles();
          fetchRuntimeStats();
        }
      } catch (err) {
        // ignore malformed events
      }
    };
    es.onerror = () => {
      // EventSource will handle reconnection; nothing to do here
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);
  async function fetchPercentiles() {
    try {
      const res = await fetch("/api/percentiles?limit=2000");
      const data = await res.json();
      if (Array.isArray(data)) setPercentiles(data);
      else setPercentiles([]);
    } catch (e) {
      setPercentiles([]);
    }
  }

  async function fetchStats() {
    try {
      const res = await fetch("/api/stats");
      const data = await res.json();
      const arr = (data as StatRow[]) || [];
      setStats(arr);
    } catch (e) {
      // ignore
    }
  }

  async function fetchRuntimeStats() {
    try {
      const res = await fetch("/api/runtime-stats");
      const data = await res.json();
      setRuntimeStats(data || []);
    } catch (e) {
      setRuntimeStats([]);
    }
  }

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function doExport() {
    // trigger browser download
    window.location.href = "/api/export.csv";
  }

  async function doReset() {
    setBusy(true);
    try {
      const res = await fetch("/api/reset", { method: "POST" });
      const data = await res.json();
      if (data && data.ok) {
        // refresh UI
        await fetchStats();
        await fetchRecent();
        await fetchPercentiles();
        await fetchRuntimeStats();
      } else {
        console.error("reset failed", data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
      setShowResetConfirm(false);
    }
  }



  async function fetchRecent() {
    try {
      const res = await fetch("/api/recent");
      const data = await res.json();
      setRecent(data as ResultRow[]);
    } catch (e) { }
  }

  async function start() {
    const body = {
      minLength,
      maxLength,
      iterations,
      concurrency,
    };
    try {
      await fetch("/api/simulations/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setRunning(true);
      setDrawerOpen(false);
    } catch (e) {
      console.error(e);
    }
  }

  async function stop() {
    try {
      await fetch("/api/simulations/stop", { method: "POST" });
      setRunning(false);
    } catch (e) {
      console.error(e);
    }
  }

  // simple SVG bar chart for avg_ops per length
  const maxAvg = Math.max(1, ...(stats.map((s) => s.avg_ops) as number[]));
  return (
    <div className="flex flex-col gap-6 w-full min-h-[70vh]">
      {/* Top control bar */}
      <div className="flex items-center gap-4 w-full">
        <div className="flex-1">
          <div className="mt-0 flex items-center gap-2">
            <div className="px-3 py-1 rounded-full bg-popover text-popover-foreground text-sm">Lengths: <span className="font-semibold">{stats.length}</span></div>
            <div className="px-3 py-1 rounded-full bg-popover text-popover-foreground text-sm">Runs: <span className="font-semibold">{totalRuns}</span></div>
            <div className="px-3 py-1 rounded-full bg-popover text-popover-foreground text-sm">Avg ops: <span className="font-semibold">{overallAvg}</span></div>
            <div className="px-3 py-1 rounded-full bg-popover text-popover-foreground text-sm">Valid: <span className="font-semibold">{overallValid}%</span></div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Label>Range</Label>
            <Input type="number" value={minLength} onChange={(e) => setMinLength(Number(e.target.value))} className="w-20" />
            <span className="px-1">—</span>
            <Input type="number" value={maxLength} onChange={(e) => setMaxLength(Number(e.target.value))} className="w-20" />
          </div>

          <div className="flex items-center gap-2">
            <Label>Iter</Label>
            <Input type="number" value={iterations} onChange={(e) => setIterations(Number(e.target.value))} className="w-20" />
          </div>
          <div className="flex items-center gap-2">
            <Label>Conc</Label>
            <Input type="number" value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} className="w-20" />
          </div>

          <Button onClick={start} disabled={running}>Start</Button>
          <Button variant="destructive" onClick={stop} disabled={!running}>Stop</Button>
          <Button variant="outline" onClick={doExport}>Export</Button>
          <Button variant="ghost" onClick={() => setShowResetConfirm(true)}>Reset</Button>
          <Button onClick={() => setDrawerOpen((s) => !s)}>{drawerOpen ? "Hide" : "Events / Results"}</Button>
          <Button variant="ghost" onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} aria-label="Toggle theme">
            {theme === "dark" ? "☀️" : "🌙"}
          </Button>
        </div>
      </div>

      {/* Progress bar & status */}
      <div className="w-full">
        <div className="flex items-center gap-4 mb-2">
          <div className="text-sm">Status: <span className="font-medium">{running ? "Running" : "Idle"}</span></div>
          <div className="text-sm">Recent rows: <span className="font-medium">{recent.length}</span></div>
          <div className="text-sm">Streams: <span className="font-medium">{events.length}</span></div>
        </div>
        <div className="h-3 w-full bg-input rounded overflow-hidden">
          {running ? (
            <div
              className="h-full transition-[width] duration-500"
              style={{ width: progressPercent != null ? `${progressPercent}%` : `30%`, background: 'linear-gradient(90deg,var(--chart-4),var(--chart-2))' }}
            />
          ) : (
            <div className="h-full bg-input" style={{ width: "0%" }} />
          )}
        </div>
        {progressPercent != null && <div className="text-xs text-muted-foreground mt-1">Progress: {progressPercent}%</div>}
      </div>

      {/* Main chart (takes most of the space) */}
      <Card className="w-full flex-1 bg-card border border-border backdrop-blur-sm">
        <CardHeader>
          <CardTitle>Min / Avg / Max by Length</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ width: "100%", height: '72vh' }} className="w-full">
            {(() => {
              // Calculate the max value from left axis data only (avg, p50, p90)
              const leftMaxValues = stats.map(s => s.max_ops || 0);
              const percentileValues = percentiles.flatMap(p => [p.p50 || 0, p.p75 || 0, p.p90 || 0]);
              const rawMaxLeftValue = Math.max(...leftMaxValues, ...percentileValues, 1);
              // Add 10% padding to account for Recharts' internal spacing
              const maxLeftValue = Math.ceil(rawMaxLeftValue * 1.1);

              return (
                <ResponsiveContainer>
                  <ComposedChart
                    data={(() => {
                      // prepare data + raw theoretical curves (no scaling)
                      const arr = stats.map((s) => s.length);

                      // raw theoretical values
                      const theoN2 = arr.map((n) => n ** 2);
                      const theoNSqrt = arr.map((n) => n * Math.sqrt(n));
                      const theoNLog = arr.map((n) => n * Math.log2(Math.max(2, n)));

                      return stats.map((s, i) => {
                        const p = percentiles.find((x) => x.length === s.length) || {};
                        return {
                          length: s.length,
                          avg: s.avg_ops,
                          avgError: [s.avg_ops - s.min_ops, s.max_ops - s.avg_ops],
                          p50: p.p50,
                          p75: p.p75,
                          p90: p.p90,
                          valid_rate: s.valid_rate,
                          theo_n2_raw: theoN2[i] ?? 0,
                          theo_n_sqrtn_raw: theoNSqrt[i] ?? 0,
                          theo_n_log_raw: theoNLog[i] ?? 0,
                        };
                      });
                    })()}
                  >
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                    <XAxis dataKey="length" label={{ value: "length", position: "insideBottom", offset: -5 }} />
                    <YAxis type="number" domain={[0, maxLeftValue]} allowDataOverflow={true} />
                    <YAxis yAxisId="right" type="number" orientation="right" stroke="#cbd5e1" domain={[0, maxLeftValue]} allowDataOverflow={true} label={{ value: "theoretical (raw)", angle: -90, position: "insideRight" }} />
                    <Tooltip formatter={(value: any, name: any) => [value, name]} labelFormatter={(label) => `length: ${label}`} />
                    <Bar dataKey="avg" fill="#7c3aed">
                      <ErrorBar dataKey="avgError" width={8} strokeWidth={2} />
                    </Bar>
                    <Line type="monotone" dataKey="p50" stroke="#10b981" strokeWidth={2} dot={false} name="p50" />
                    <Line type="monotone" dataKey="p90" stroke="#f97316" strokeWidth={2} dot={false} name="p90" />
                    {/* Theoretical complexity overlays (raw values) mapped to right axis */}
                    <Line type="monotone" yAxisId="right" dataKey="theo_n_log_raw" stroke="#60a5fa" strokeWidth={4} dot={false} name="O(n log n)" strokeDasharray="12 6" />
                    <Line type="monotone" yAxisId="right" dataKey="theo_n_sqrtn_raw" stroke="#f59e0b" strokeWidth={4} dot={false} name="O(n sqrt(n))" strokeDasharray="12 6" />
                    <Line type="monotone" yAxisId="right" dataKey="theo_n2_raw" stroke="#ef4444" strokeWidth={4} dot={false} name="O(n²)" strokeDasharray="12 6" />
                    <Legend />
                  </ComposedChart>
                </ResponsiveContainer>
              );
            })()}
          </div>
        </CardContent>
      </Card>

      {/* Runtime chart */}
      <Card className="w-full bg-card border border-border backdrop-blur-sm">
        <CardHeader>
          <CardTitle>Runtime (ms) by Length</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ width: "100%", height: '40vh' }} className="w-full">
            <ResponsiveContainer>
              <ComposedChart data={runtimeStats}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                <XAxis dataKey="length" label={{ value: "length", position: "insideBottom", offset: -5 }} />
                <YAxis label={{ value: "runtime (ms)", angle: -90, position: "insideLeft" }} />
                <Tooltip formatter={(value: any, name: any) => [value, name]} labelFormatter={(label) => `length: ${label}`} />
                <Bar dataKey="avg_runtime" fill="#3b82f6" name="avg runtime">
                  <ErrorBar dataKey={(data: any) => [data.avg_runtime - data.min_runtime, data.max_runtime - data.avg_runtime]} width={8} strokeWidth={2} />
                </Bar>
                <Line type="monotone" dataKey="min_runtime" stroke="#10b981" strokeWidth={2} dot={false} name="min" />
                <Line type="monotone" dataKey="max_runtime" stroke="#ef4444" strokeWidth={2} dot={false} name="max" />
                <Legend />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Drawer for events and recent results (desktop) */}
      <div className={`hidden md:block fixed top-16 right-4 bottom-4 w-96 bg-popover border border-border rounded-lg shadow-xl transform transition-transform duration-300 z-50 ${drawerOpen ? "translate-x-0" : "translate-x-[110%]"}`}>
        <div className="p-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Events & Results</h3>
            <div className="text-xs text-muted-foreground">Logs</div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setDrawerTab("events")}>Events</Button>
            <Button variant="ghost" onClick={() => setDrawerTab("results")}>Results</Button>
            <Button variant="outline" onClick={() => setDrawerOpen(false)}>Close</Button>
          </div>
        </div>
        <div className="p-3 overflow-y-auto h-full">
          {drawerTab === "events" ? (
            <div className="font-mono text-xs space-y-2">
              {events.slice(0, 1000).map((ev, i) => (
                <div key={i} className="p-2 bg-card rounded">
                  <pre className="whitespace-pre-wrap">{JSON.stringify(ev)}</pre>
                </div>
              ))}
            </div>
          ) : (
            <div className="font-mono text-sm">
              {recent.length === 0 && <div className="text-sm text-muted-foreground">No recent results</div>}
              <div className="space-y-2">
                {recent.map((r) => (
                  <div key={r.id} className="flex justify-between gap-4 py-1 border-b last:border-b-0">
                    <div className="flex-1">#{r.id} len={r.length} ops={r.operations} valid={r.valid ? "ok" : "ko"}</div>
                    <div className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleTimeString()}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile: bottom sheet */}
      <div className={`md:hidden fixed left-4 right-4 bottom-4 h-1/2 bg-popover border border-border rounded-t-lg shadow-xl transform transition-transform duration-300 z-50 ${drawerOpen ? "translate-y-0" : "translate-y-full"}`}>
        <div className="p-3 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Events & Results</h3>
            <div className="text-xs text-muted-foreground">Logs</div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setDrawerTab("events")}>Events</Button>
            <Button variant="ghost" onClick={() => setDrawerTab("results")}>Results</Button>
            <Button variant="outline" onClick={() => setDrawerOpen(false)}>Close</Button>
          </div>
        </div>
        <div className="p-3 overflow-y-auto h-full">
          {drawerTab === "events" ? (
            <div className="font-mono text-xs space-y-2">
              {events.slice(0, 1000).map((ev, i) => (
                <div key={i} className="p-2 bg-card rounded">
                  <pre className="whitespace-pre-wrap">{JSON.stringify(ev)}</pre>
                </div>
              ))}
            </div>
          ) : (
            <div className="font-mono text-sm">
              {recent.length === 0 && <div className="text-sm text-muted-foreground">No recent results</div>}
              <div className="space-y-2">
                {recent.map((r) => (
                  <div key={r.id} className="flex justify-between gap-4 py-1 border-b last:border-b-0">
                    <div className="flex-1">#{r.id} len={r.length} ops={r.operations} valid={r.valid ? "ok" : "ko"}</div>
                    <div className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleTimeString()}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-popover rounded-lg p-6 w-96 border border-border">
            <h3 className="text-lg font-semibold">Reset database?</h3>
            <p className="mt-2 text-sm text-muted-foreground">This will permanently delete all simulation results. This action cannot be undone.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowResetConfirm(false)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={doReset} disabled={busy}>
                {busy ? "Resetting..." : "Confirm Reset"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
