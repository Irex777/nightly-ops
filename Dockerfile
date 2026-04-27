FROM node:18-alpine

# Install system deps
RUN apk add --no-cache git curl

# Install gh CLI binary (auto-detect arch: amd64 or arm64)
RUN GH_VER="2.63.2" && \
    ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/') && \
    curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VER}/gh_${GH_VER}_linux_${ARCH}.tar.gz" | tar xz -C /usr/local --strip-components=1 && \
    gh --version

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code && \
    claude --version

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

# Ensure data and temp dirs exist
RUN mkdir -p /app/data /tmp/nightly-ops

# Create non-root user and set ownership
RUN adduser -D -u 1001 appuser && \
    chown -R appuser:appuser /app /tmp/nightly-ops

# Expose the default port
EXPOSE 3000

# Start the server as non-root user
USER appuser
CMD ["node", "server.js"]
