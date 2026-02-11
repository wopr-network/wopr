FROM node:lts-slim

WORKDIR /app

# Install git, sudo, curl, jq, and docker CLI
RUN apt-get update && apt-get install -y git sudo curl ca-certificates gnupg jq && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    chmod a+r /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && apt-get install -y docker-ce-cli && \
    rm -rf /var/lib/apt/lists/*

# Make node user a passwordless sudoer
RUN echo "node ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/node && chmod 0440 /etc/sudoers.d/node

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/

# Build
RUN npm run build

# --- Pre-install all official plugins (WOP-69 fat image strategy) ---
# Clone, install deps, and build every wopr-network plugin so the image
# ships ready to go. Users enable/disable plugins at runtime via config.
RUN set -e; mkdir -p /app/bundled-plugins; for repo in \
      wopr-plugin-discord \
      wopr-plugin-telegram \
      wopr-plugin-slack \
      wopr-plugin-signal \
      wopr-plugin-whatsapp \
      wopr-plugin-msteams \
      wopr-plugin-imessage \
      wopr-plugin-github \
      wopr-plugin-p2p \
      wopr-plugin-memory-semantic \
      wopr-plugin-provider-anthropic \
      wopr-plugin-provider-openai \
      wopr-plugin-provider-opencode \
      wopr-plugin-provider-kimi \
      wopr-plugin-webui \
      wopr-plugin-router \
      wopr-plugin-webhooks \
      wopr-plugin-tailscale-funnel \
      wopr-plugin-voice-cli \
      wopr-plugin-voice-chatterbox \
      wopr-plugin-voice-deepgram-stt \
      wopr-plugin-voice-elevenlabs-tts \
      wopr-plugin-voice-openai-tts \
      wopr-plugin-voice-piper-tts \
      wopr-plugin-voice-whisper-local \
      wopr-plugin-channel-discord-voice \
    ; do \
      echo "--- cloning $repo ---"; \
      git clone --depth 1 "https://github.com/wopr-network/${repo}.git" "/app/bundled-plugins/${repo}" \
        && rm -rf "/app/bundled-plugins/${repo}/.git"; \
      if [ -f "/app/bundled-plugins/${repo}/package.json" ]; then \
        (cd "/app/bundled-plugins/${repo}" && npm install --omit=dev 2>/dev/null || true); \
        if [ -f "/app/bundled-plugins/${repo}/tsconfig.json" ]; then \
          (cd "/app/bundled-plugins/${repo}" && npm run build 2>/dev/null || true); \
        fi; \
      fi; \
    done

# Copy bundled-plugin registration script
COPY scripts/register-bundled-plugins.sh /app/scripts/register-bundled-plugins.sh
RUN chmod +x /app/scripts/register-bundled-plugins.sh

# Create data directory and set ownership for node user
RUN mkdir -p /data && chown -R node:node /data

# Create .claude directory for node user credentials
RUN mkdir -p /home/node/.claude && chown -R node:node /home/node/.claude

ENV WOPR_HOME=/data
# Path where pre-installed plugins live inside the image
ENV WOPR_BUNDLED_PLUGINS=/app/bundled-plugins

# Copy entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Run entrypoint as root (it will drop to node user)
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "dist/cli.js", "daemon", "run"]
