import { z } from "zod";

import type { RecorderEventType } from "../client/recorder.js";

export const RECORDER_EVENT_TYPES = [
  "action",
  "state",
  "nav",
  "error",
  "toast",
  "log",
] as const satisfies readonly RecorderEventType[];

// Loose objects: a field the recorder adds later is stored, not stripped.
const recorderEventSchema = z.looseObject({
  t: z.number(),
  at: z.number(),
  type: z.enum(RECORDER_EVENT_TYPES),
  name: z.string().optional(),
  ok: z.boolean().optional(),
  status: z.number().optional(),
  errorCode: z.string().optional(),
  ms: z.number().optional(),
  requestId: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const recorderReportSchema = z.looseObject({
  app: z.string().max(200),
  build: z.string(),
  url: z.string(),
  at: z.string(),
  reason: z.enum(["user", "error", "test", "manual"]),
  windowSeconds: z.number(),
  events: z.array(recorderEventSchema),
  watched: z.record(z.string(), z.unknown()),
  pending: z.array(
    z.looseObject({ type: z.string(), name: z.string(), ageMs: z.number() }),
  ),
  dropped: z.number(),
});
