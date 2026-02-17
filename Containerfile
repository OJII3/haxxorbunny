FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY src/ ./src/
COPY data/personality.json ./data/personality.json
COPY tsconfig.json ./

CMD ["bun", "run", "src/index.ts"]
