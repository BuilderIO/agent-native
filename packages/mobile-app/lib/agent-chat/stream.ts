/**
 * Incremental parser for the agent chat response stream: line-delimited JSON,
 * where lines may be SSE-framed (`data: {...}` with blank-line flushes) or
 * bare JSON objects. Ported from the web runtime's readJsonEventStream.
 */

export class JsonEventStreamParser {
  private buffer = "";
  private pendingSseData: string[] = [];

  /** Feed a decoded chunk; returns every complete event it terminated. */
  push(chunk: string): unknown[] {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";

    const events: unknown[] = [];
    for (const line of lines) {
      if (line.startsWith("data:")) {
        this.pendingSseData.push(line.slice(5).trimStart());
        continue;
      }
      if (line.trim() === "") {
        const flushed = this.flushSse();
        if (flushed !== null) events.push(flushed);
        continue;
      }
      const parsed = parseJsonLine(line);
      if (parsed !== null) events.push(parsed);
    }
    return events;
  }

  /** Call once the stream ends to drain any trailing buffered event. */
  end(): unknown[] {
    const events: unknown[] = [];
    if (this.buffer.trim()) {
      const parsed = parseJsonLine(this.buffer);
      if (parsed !== null) events.push(parsed);
    }
    this.buffer = "";
    const flushed = this.flushSse();
    if (flushed !== null) events.push(flushed);
    return events;
  }

  private flushSse(): unknown {
    if (this.pendingSseData.length === 0) return null;
    const raw = this.pendingSseData.join("\n");
    this.pendingSseData = [];
    return parseJsonLine(raw);
  }
}

function parseJsonLine(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "[DONE]") return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export async function* readJsonEventStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new JsonEventStreamParser();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield* parser.push(decoder.decode(value, { stream: true }));
    }
    yield* parser.end();
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A cancelled stream can report itself locked for a tick.
    }
  }
}
