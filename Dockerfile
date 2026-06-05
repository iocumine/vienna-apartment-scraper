# --- Build stage: compile TypeScript and build native deps ---
FROM node:22-bookworm AS build
WORKDIR /app

# better-sqlite3 compiles a native addon; the full image has the toolchain.
COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies so we copy a lean node_modules to the runtime image.
RUN npm prune --omit=dev

# --- Runtime stage ---
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Persisted at runtime via a volume (SQLite db + WhatsApp auth).
RUN mkdir -p data

EXPOSE 3000
CMD ["node", "dist/index.js"]
