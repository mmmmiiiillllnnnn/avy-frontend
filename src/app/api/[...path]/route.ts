// Серверный прокси на бэкенд (same-origin для браузера).
//
// Зачем route handler, а не next.config rewrites: rewrites резолвятся на этапе
// `next build` и впекаются в манифест (.next/routes-manifest.json), поэтому
// рантайм-переменная окружения BACKEND_ORIGIN их НЕ меняет — образ оказался бы
// привязан к адресу бэка времени сборки. Route handler выполняется в рантайме на
// каждом запросе и читает BACKEND_ORIGIN из process.env при старте сервера —
// один образ работает в любой среде (compose: http://backend:8000; локально без
// контейнеров: http://localhost:8000).
//
// Браузер бьёт в /api/... (свой origin) -> этот handler форвардит на бэк,
// прозрачно пробрасывая метод, тело, заголовки (включая Cookie с httpOnly-сессией)
// и СТРИМ ответа как есть (важно для SSE /api/chat — тело отдаётся потоком, без
// буферизации).

import { type NextRequest } from "next/server";

// Узловой рантайм (не edge): нужен потоковый fetch к внутреннему хосту бэка и
// доступ к process.env в рантайме.
export const runtime = "nodejs";
// Прокси не кэшируем и не пытаемся пререндерить — он всегда динамический.
export const dynamic = "force-dynamic";

function backendOrigin(): string {
  return process.env.BACKEND_ORIGIN ?? "http://localhost:8000";
}

/** Заголовки ответа бэка, которые нельзя пробрасывать как есть (hop-by-hop). */
const STRIP_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
]);

/** Hop-by-hop заголовки ЗАПРОСА (RFC 9112 §6.1): описывают соединение
 *  клиент→прокси, а не само сообщение, и пересылке не подлежат. Практика:
 *  OTLP-экспортёр кодера шлёт тело чанками (Transfer-Encoding: chunked), и
 *  проброс этого заголовка валил undici-fetch InvalidArgumentError — все
 *  трейсы умирали на прокси с 500, не доходя до бэка. undici сам решает
 *  framing пересылаемого стрима. Content-Length НЕ трогаем: для тел с
 *  известной длиной он валиден и уже работает (chat, аплоады). */
const STRIP_REQUEST_HEADERS = new Set([
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "te",
  "trailer",
  "proxy-authorization",
  "proxy-authenticate",
]);

async function proxy(req: NextRequest): Promise<Response> {
  // Сохраняем путь /api/... и query как есть.
  const url = new URL(req.url);
  const target = backendOrigin() + url.pathname + url.search;

  // Тело пробрасываем потоком для не-GET/HEAD (важно для больших аплоадов и
  // потокового POST). duplex:"half" обязателен в undici при стриме тела.
  const hasBody = req.method !== "GET" && req.method !== "HEAD";

  const forwardHeaders = new Headers();
  req.headers.forEach((value, key) => {
    if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) forwardHeaders.set(key, value);
  });

  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers: forwardHeaders,
    body: hasBody ? req.body : undefined,
    redirect: "manual",
    // Пробрасываем отмену клиента на бэк: без signal обрыв запроса (Esc в UI)
    // умирал бы на прокси, и бэк «дожимал» работу в пустоту. Критично для
    // /compact (сервер отменяет сжатие по дисконнекту). Живые ходы это не
    // рвёт: /api/chat спроектирован переживать обрыв SSE (LiveTurn + attach).
    signal: req.signal,
    ...(hasBody ? { duplex: "half" } : {}),
  };

  const backendRes = await fetch(target, init);

  // Переносим заголовки ответа, кроме hop-by-hop (их выставит сам узловой сервер
  // по факту стрима). Set-Cookie проходит — так httpOnly-сессия доходит до браузера.
  const headers = new Headers();
  backendRes.headers.forEach((value, key) => {
    if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });

  // Тело отдаём ПОТОКОМ (backendRes.body) — SSE не буферизуется, кадры идут сразу.
  return new Response(backendRes.body, {
    status: backendRes.status,
    statusText: backendRes.statusText,
    headers,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
