# Production Multi-Stage Dockerfile for KhetVaani
FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy source code and assets
COPY src/ ./src/
COPY public/ ./public/

# Set production environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Non-root user for security
USER node

# Expose HTTP port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start server
CMD ["node", "src/server.js"]
