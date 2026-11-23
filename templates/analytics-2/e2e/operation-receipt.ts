import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

const requestIdSchema = z.object({ requestId: z.string().uuid() });

export function readRequestId(body: unknown): string | undefined {
  const parsed = requestIdSchema.safeParse(body);
  return parsed.success ? parsed.data.requestId : undefined;
}

export function retainRequestId(
  dir: string,
  requestId: string,
  writer: string,
): void {
  mkdirSync(dir, { recursive: true });
  const fd = openSync(resolve(dir, `bigquery-request-${requestId}.json`), "w");
  try {
    writeSync(fd, JSON.stringify({ requestId, writer }));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
