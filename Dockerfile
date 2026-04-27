FROM node:18-alpine

# Install gh CLI binary (Alpine)
RUN apk add --no-cache git curl && \
    GH_VER="2.63.2" && \
    curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VER}/gh_${GH_VER}_linux_amd64.tar.gz" | tar xz -C /usr/local --strip-components=1

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

# Ensure data directory exists for SQLite
RUN mkdir -p /app/data

# Expose the default port
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]
