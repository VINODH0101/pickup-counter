FROM node:20-alpine AS builder

WORKDIR /app

# Copy package descriptors for workspaces
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN npm ci

# Copy API sources
COPY tsconfig.json ./
COPY apps/api ./apps/api

# Compile TypeScript to dist/
RUN npm run build -w @pickup-counter/api

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/

# Install only production dependencies
RUN npm ci --omit=dev

# Copy compiled artifacts and SQL migrations
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY apps/api/migrations ./apps/api/migrations

EXPOSE 3001

# Automatically waits for DB readiness, runs migrations, seeds data, and starts API
CMD ["node", "apps/api/dist/db/wait-and-start.js"]
