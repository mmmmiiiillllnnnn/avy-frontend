import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Разрешить доступ к dev-ресурсам с WSL-IP (для Electron в Windows).
  allowedDevOrigins: ["172.26.2.255"],

  // Standalone-сборка: next build кладёт самодостаточный сервер в
  // .next/standalone (минимум зависимостей, свой server.js) — для лёгкого
  // production-образа (см. web/Dockerfile).
  output: "standalone",

  // Проксирование браузер -> бэк сделано РАНТАЙМ route handler'ом
  // (src/app/api/[...path]/route.ts), а НЕ через rewrites здесь. Причина:
  // rewrites резолвятся на этапе next build и впекаются в манифест, поэтому
  // рантайм-переменная BACKEND_ORIGIN их не меняет — образ был бы привязан к
  // адресу бэка времени сборки. Route handler читает env в рантайме -> один
  // образ работает в любой среде (compose: backend:8000; локально: localhost).
};

export default nextConfig;
