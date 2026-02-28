FROM oven/bun:1 AS base
WORKDIR /app

# Install ffmpeg for audio conversion (@discordjs/voice)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY src/ ./src/
COPY tsconfig.json ./

# Copy initial data files to a seed directory (if they exist)
# (volume mount will override /app/data, so we seed on first run)
COPY data/heartbeat.json ./data-seed/heartbeat.json

# Entrypoint: seed missing data files, then start
CMD ["sh", "-c", "mkdir -p data && for f in data-seed/*; do [ -f \"$f\" ] || continue; name=$(basename $f); [ ! -f data/$name ] && cp $f data/$name && echo \"[seed] Copied $name\"; done; bun run src/index.ts"]
