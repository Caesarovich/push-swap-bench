FROM oven/bun:latest

# Create app directory
WORKDIR /app

# Copy package files first for caching
COPY package.json bunfig.toml tsconfig.json ./
COPY build.ts ./
COPY src/ ./src/
COPY styles/ ./styles/

# Install dependencies
RUN bun install

# Run the production build so the image contains prebuilt frontend assets
RUN bun run build

# Ensure the push_swap/checker binaries (if provided during build) are executable
RUN if [ -f ./push_swap ]; then chmod +x ./push_swap || true; fi
RUN if [ -f ./checker ]; then chmod +x ./checker || true; fi

# Expose port used by the server
EXPOSE 3000

# Default command runs the production server. When using docker-compose or `docker run` you can override the command to `bun run dev`.
ENV NODE_ENV=production
CMD ["bun", "run", "start"]
