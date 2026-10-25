FROM node:20-alpine AS builder

WORKDIR /app

# Copy package descriptors for workspaces
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN npm ci

# Copy web app sources
COPY tsconfig.base.json ./
COPY apps/web ./apps/web

# Build Vite React production bundle
RUN npm run build -w @pickup-counter/web

FROM nginx:alpine AS runner

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY docker/nginx/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
