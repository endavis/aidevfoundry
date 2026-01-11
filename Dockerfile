# Multi-stage Docker build for PuzldAI
# Stage 1: Build stage
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production=false

# Copy source code
COPY . .

# Build the CLI
RUN bun run build

# Stage 2: Production stage
FROM node:20-alpine AS production
WORKDIR /app

# Install Bun for runtime
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/

# Copy package files
COPY package.json ./

# Copy built artifacts from base stage
COPY --from=base /app/dist ./dist
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/web ./web
COPY --from=base /app/assets ./assets

# Create a non-root user
RUN addgroup -g 1001 -S puzldai && \
    adduser -S puzldai -u 1001 && \
    chown -R puzldai:puzldai /app

USER puzldai

# Set the entrypoint
ENTRYPOINT ["node", "/app/dist/cli/index.js"]
CMD ["--help"]

# Metadata
LABEL maintainer="PuzldAI"
LABEL description="Multi-LLM orchestration framework with agentic execution"
