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
# Сборка из корня репозитория:  docker build -t avy-chat-web .
# (docker-compose репозитория avy-local собирает его сам: build.context —
# соседний каталог ../avy-front, см. AVY_FRONT_DIR)
#
# Корпоративная сборка (Nexus вместо Docker Hub и registry.npmjs.org) — см.
# Jenkinsfile. Обе ручки необязательны, без них сборка
# идёт как раньше:
#   --build-arg NODE_IMAGE=nexus.corp:8082/library/node:20-alpine
#   --secret id=npmrc,src=/путь/.npmrc      (registry=..., //host/:_auth=...)
#   --secret id=ca,src=/путь/corp-ca.crt    (если Nexus за корпоративным CA)
# .npmrc передаётся секретом BuildKit, а не COPY/ARG: так токен Nexus не
# оседает ни в слоях, ни в истории образа. Адреса registry.npmjs.org в
# package-lock.json npm сам подменяет на настроенный registry
# (replace-registry-host=npmjs по умолчанию), лок править не нужно.

# Alpine (musl): все нативные пакеты (swc, lightningcss, tailwind oxide, sharp)
# есть в package-lock.json в musl-сборках, поэтому libc6-compat не ставим —
# apk в сборке не вызывается и зеркало Alpine в Nexus не нужно.
ARG NODE_IMAGE=node:20-alpine

# ---- deps: ставим зависимости по lockfile (кэшируется, пока lockfile не менялся)
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Повышенные таймаут/ретраи: сборка падала на транзиентных сетевых сбоях npm
# registry. Делает npm ci устойчивее к коротким провалам сети.
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    --mount=type=secret,id=ca,target=/run/secrets/ca.crt \
    if [ -s /run/secrets/ca.crt ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca.crt; fi; \
    npm ci --fetch-timeout=120000 --fetch-retries=5 --fetch-retry-maxtimeout=120000

# ---- builder: собираем standalone-бандл
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
# Телеметрию Next отключаем — лишний сетевой шум в контейнере.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runner: минимальный рантайм
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Непривилегированный пользователь (не root в контейнере). UID 1001 ждёт
# Helm-чарт (podSecurityContext). Синтаксис busybox: длинных флагов нет.
RUN addgroup -S -g 1001 nodejs \
    && adduser -S -D -H -u 1001 -G nodejs nextjs

# Standalone НЕ включает public/ и .next/static — копируем их отдельно, иначе
# не будет статики (CSS/JS/иконок). Это load-bearing три COPY канонического
# Next-Dockerfile.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
