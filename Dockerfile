FROM node:18-alpine

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
