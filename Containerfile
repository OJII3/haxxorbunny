FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY src/ ./src/
COPY tsconfig.json ./

# Copy initial data files to a seed directory
# (volume mount will override /app/data, so we seed on first run)
COPY data/personality.json ./data-seed/personality.json
COPY data/goals.json ./data-seed/goals.json
COPY data/heartbeat.json ./data-seed/heartbeat.json

# Entrypoint: seed missing data files, then start
CMD ["sh", "-c", "for f in data-seed/*; do name=$(basename $f); [ ! -f data/$name ] && cp $f data/$name && echo \"[seed] Copied $name\"; done; bun run src/index.ts"]
