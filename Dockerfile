FROM node:24-alpine

# Patch npm's bundled transitive deps (tar, brace-expansion CVEs)
RUN npm install -g npm@latest

WORKDIR /app

# Install runtime dependencies
# build-base + python3 needed for better-sqlite3 native addon (node-gyp)
RUN apk add --no-cache git sudo curl ca-certificates jq docker-cli su-exec build-base python3

# Make node user a passwordless sudoer
RUN echo "node ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/

# Build
RUN pnpm run build

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
