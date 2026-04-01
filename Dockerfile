# OrcaBot — NanoClaw fork for construction budgeting
# Runs the gateway (LLM proxy + API channel + agent runtime)

FROM node:20-slim

# System deps: Python 3 for PaddleOCR, poppler for pdf2pic, curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    poppler-utils \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Install production deps only (container uses npm, not bun)
RUN npm ci --omit=dev

# Copy source and config
COPY tsconfig.json ./
COPY src/ ./src/
COPY agents/ ./agents/

# Build TypeScript
RUN npx tsc

# Expose LLM proxy and API channel
EXPOSE 8200 8300

# Healthcheck via API channel
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8300/health || exit 1

CMD ["node", "dist/src/index.js"]
