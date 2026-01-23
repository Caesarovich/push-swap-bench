# push-swap-bench

A small Bun + React dashboard to run large-scale push_swap simulations, collect statistics in SQLite, and visualize results live.

This repository contains:
- a Bun HTTP server and simulator runner (backend) under `src/server` and `src/index.ts`
- a React + shadcn/Tailwind dashboard in `src/` that connects to the server, listens to SSE events, and shows charts (Recharts)
- a Bun-built SQLite database (stored as `simulations.sqlite`)

<img width="3473" height="2112" alt="image" src="https://github.com/user-attachments/assets/d0f95978-e48d-499d-9775-12cdbe4e66f4" />


## ✴️ Quick start

1. Make sure your `push_swap` and `checker_linux` executables are present in the current directory and are executable.
	```bash
	chmod +x push_swap checker_linux
	```
2. Pull the Docker image with Bun installed:
	```bash
	docker pull ghcr.io/caesarovich/push-swap-bench:master
	```
3. Run the Docker container, mounting the current directory:
	```bash
	docker run -it --rm -p 3000:3000 \
		-v $(pwd)/push_swap:/app/push_swap \
		-v $(pwd)/checker_linux:/app/checker \
		-v $(pwd)/benchmark_data:/app/data \
		ghcr.io/caesarovich/push-swap-bench:master
	```
4. Open your browser and navigate to `http://localhost:3000`. You should see the dashboard.
5. Configure simulation parameters (number of simulations, size of stacks, ...) and start the simulations.
6. Watch the live-updating charts as simulations run.

## 🛑 Stopping the server
To stop the server, simply press `Ctrl+C` in the terminal where the Docker container is running.

## 🗑 Cleaning up
To remove the generated SQLite database and any other data, delete the `benchmark_data` directory:
```bash
rm -rf benchmark_data
```

To remove the Docker image, run:
```bash
docker rmi ghcr.io/caesarovich/push-swap-bench:master
```

Enjoy 🩵
