# push-swap-bench

A small Bun + React dashboard to run large-scale push_swap simulations, collect statistics in SQLite, and visualize results live.

This repository contains:
- a Bun HTTP server and simulator runner (backend) under `src/server` and `src/index.ts`
- a React + shadcn/Tailwind dashboard in `src/` that connects to the server, listens to SSE events, and shows charts (Recharts)
- a Bun-built SQLite database (stored as `simulations.sqlite`)

## Quick start (development)
1. Install dependencies with Bun (requires Bun installed):

```bash
bun install
```

2. Make sure your `push_swap` and `checker` binaries are present and executable in the project root (or provide custom paths when starting simulations):

```bash
chmod +x ./push_swap ./checker
```

3. Start the dev server (hot reload):

```bash
bun run dev
```

Open http://localhost:3000/ — the dashboard will load.

How to use the dashboard
- Top controls: set Min/Max length, Iterations and Concurrency. Click Start to begin simulations. Click Stop to cancel.
- Progress bar and status show live activity from the simulator.
- The main chart shows Min/Avg/Max operations per length. You can toggle the right-side drawer (desktop) / bottom sheet (mobile) to view raw Events and Recent Results.
- Use the Export button to download a CSV of all results; Reset clears the DB (irreversible) after confirmation.
- Theme toggle (sun/moon) persists your preference to localStorage.

Notes & troubleshooting
- Permission denied spawning `./checker` or `./push_swap`: make the binary executable (see `chmod +x ...`) and ensure the path is correct.
- Port 3000 in use: stop the process using it, or change port in `src/index.ts` if you prefer another port.
- If SSE connection looks stale in the browser, reload the page — EventSource will reconnect automatically in many cases.
- Theoretical complexity overlays: the chart contains optional theoretical curves (O(n log n), O(n sqrt n), O(n^2)). By default they are presented in a readable, scaled way; you can toggle or adjust visualization code in `src/Dashboard.tsx`.

Database
- The app writes to `./simulations.sqlite` next to the project root. You can open it with any SQLite client.

## Docker usage
### Option 1 - Build and run with docker-compose (recommended):

```bash
docker compose up --build -d
```

This will:
- build an image using the included `Dockerfile` (based on Bun),
- mount your local repository into the container so code edits are visible inside the container,
- mount `./push_swap` and `./checker` into the container at `/app/push_swap` and `/app/checker` (these should be executable binaries on the host),
- expose port 3000 to the host so you can open http://localhost:3000.

### Option 2 - Run with `docker run` and volumes

If you prefer a single `docker run` command, here's an example that mounts host binaries and a local data folder into the container:

```bash
# build image
docker build -t push-swap-bench:latest .

# run container, mount binaries and persist data
docker run -d \
	-p 3000:3000 \
	-v $(pwd)/push_swap:/app/push_swap:ro \
	-v $(pwd)/checker:/app/checker:ro \
	-v $(pwd)/data:/app/data \
	--name push-swap-bench push-swap-bench:latest
```

Notes:
- Make sure `./push_swap` and `./checker` exist and are executable on the host before starting the container. The container expects them at `/app/push_swap` and `/app/checker` according to the compose/run examples.
- The `data` volume (or `./data` host folder) will persist `simulations.sqlite` and other files produced by the app.

Enjoy!