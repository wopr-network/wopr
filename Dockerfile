# Stage 1: Build
FROM node:24-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install all dependencies (including devDeps needed for build)
RUN pnpm install --frozen-lockfile

# Copy source and compile
COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm run build

# Prune devDependencies so only runtime deps are copied to final image
RUN pnpm prune --prod

# Stage 2: Runtime
FROM node:24-bookworm-slim

# Patch npm's bundled transitive deps and install pnpm via npm (not corepack)
# Installing via npm avoids the corepack cache with its bundled vulnerable node-tar
RUN npm install -g npm@latest pnpm@latest

WORKDIR /app

# Runtime system deps only — no build-essential, no python3
RUN apt-get update && apt-get install -y --no-install-recommends \
    git sudo curl ca-certificates jq docker.io && \
    rm -rf /var/lib/apt/lists/*

# Make node user a passwordless sudoer
RUN echo "node ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Copy only runtime artifacts from builder (no pnpm, no corepack cache, no devDeps)
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/node_modules/ ./node_modules/
COPY package.json ./

# Create data directory and set ownership for node user
RUN mkdir -p /data && chown -R node:node /data

# Create .claude directory for node user credentials
RUN mkdir -p /home/node/.claude && chown -R node:node /home/node/.claude

ENV WOPR_HOME=/data
ENV WOPR_DAEMON_HOST=0.0.0.0

# Copy entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Run entrypoint as root (it will drop to node user)
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "dist/cli.js", "daemon", "run"]
