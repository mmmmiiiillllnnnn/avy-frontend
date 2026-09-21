# Production-образ фронта (Next.js 16, standalone).
#
# Multi-stage: deps -> builder -> runner. Финальный образ несёт ТОЛЬКО
# самодостаточный standalone-сервер (минимум node_modules) + статику, поэтому
# он лёгкий и стартует быстро.
#
# Браузер ходит на свой origin (/api/...), а Next на сервере проксирует это на
# backend (BACKEND_ORIGIN — рантайм-переменная, см. next.config.ts). Значит
# НИЧЕГО про адрес бэка в бандл не впекается: один образ переносится между
# средами без пересборки.
#
# Сборка из каталога web/:  docker build -t avy-chat-web web/
# (в docker-compose собирается автоматически, build.context: ./web)

# ---- deps: ставим зависимости по lockfile (кэшируется, пока lockfile не менялся)
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Повышенные таймаут/ретраи: сборка падала на транзиентных сетевых сбоях npm
# registry. Делает npm ci устойчивее к коротким провалам сети.
RUN npm ci --fetch-timeout=120000 --fetch-retries=5 --fetch-retry-maxtimeout=120000

# ---- builder: собираем standalone-бандл
FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
# Телеметрию Next отключаем — лишний сетевой шум в контейнере.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runner: минимальный рантайм
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Непривилегированный пользователь (не root в контейнере).
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Standalone НЕ включает public/ и .next/static — копируем их отдельно, иначе
# не будет статики (CSS/JS/иконок). Это load-bearing три COPY канонического
# Next-Dockerfile.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
