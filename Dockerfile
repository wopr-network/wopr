FROM node:20-slim

WORKDIR /app

# Install git for plugin installation from GitHub
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/

# Build
RUN npm run build

# Create data directory
RUN mkdir -p /data

ENV WOPR_HOME=/data

# Default command runs the daemon
CMD ["node", "dist/cli.js", "daemon", "start", "--foreground"]
