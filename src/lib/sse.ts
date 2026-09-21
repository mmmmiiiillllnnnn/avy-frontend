// Минимальный, но корректный парсер SSE-потока.
//
// Своё решение оправдано тем, что сервер пишем сами (server/streaming.py):
// фреймы разделены "\n\n", полезная нагрузка — в строках "data: ". Тем не менее
// парсер сделан по спецификации SSE, чтобы не зависеть от точного вида вывода:
// - принимает "\n", "\r\n", "\r" как переводы строк;
// - событие завершается пустой строкой;
// - несколько строк "data:" в одном событии склеиваются через "\n";
// - строки, начинающиеся с ":" (комментарии/heartbeat), игнорируются.
//
// Вынесено отдельной чистой функцией parseSSE — её удобно тестировать.

export type SSEMessage = { event: string; data: string };

/**
 * Превратить поток текстовых чанков (как из reader.read()) в поток SSE-событий.
 * Корректно склеивает чанки на границах: незавершённый хвост держится в буфере
 * до прихода следующего чанка.
 */
export async function* parseSSE(
  chunks: AsyncIterable<string>,
): AsyncGenerator<SSEMessage> {
  let buffer = "";

  for await (const chunk of chunks) {
    buffer += chunk;

    // Нормализуем переводы строк к "\n", тогда разделитель события — "\n\n".
    buffer = buffer.replace(/\r\n|\r/g, "\n");

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const msg = parseEvent(raw);
      if (msg) yield msg;
    }
  }

  // Хвост без завершающего "\n\n" — пытаемся разобрать, если там есть data.
  const tail = parseEvent(buffer.replace(/\r\n|\r/g, "\n"));
  if (tail) yield tail;
}

function parseEvent(raw: string): SSEMessage | null {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of raw.split("\n")) {
    if (line === "" || line.startsWith(":")) continue; // пусто / комментарий
    const idx = line.indexOf(":");
    const field = idx === -1 ? line : line.slice(0, idx);
    // По спеке после двоеточия съедается один ведущий пробел.
    let value = idx === -1 ? "" : line.slice(idx + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }

  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

/** Обёртка: тело fetch-ответа -> поток строковых чанков (UTF-8). */
export async function* readBody(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}
