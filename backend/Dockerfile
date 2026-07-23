# ---- deps: install dependencies with full devDependencies for the build stage ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: generate the Prisma client, then compile TypeScript to dist/ ----
FROM node:20-alpine AS build
WORKDIR /app
# Alpine ships no OpenSSL by default; Prisma needs it to detect which query
# engine binary to fetch during `generate`.
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# ---- runtime: production-only deps + compiled output, non-root user ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# The generated query engine binary is linked against OpenSSL — needed here too.
RUN apk add --no-cache openssl

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=appuser:appgroup /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=appuser:appgroup /app/dist ./dist

USER appuser
EXPOSE 3000
CMD ["node", "dist/index.js"]
