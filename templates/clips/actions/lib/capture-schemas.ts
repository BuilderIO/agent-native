import { z } from "zod";

export const captureSessionSchema = z.object({
  id: z.string(),
  ownerEmail: z.string(),
  hostId: z.string(),
  requestId: z.string(),
  captureMode: z.string(),
  maxDurationMs: z.number(),
  state: z.string(),
  recordingId: z.string().nullable(),
  startedAtMs: z.number().nullable(),
  startUncertaintyMs: z.number().nullable(),
  observedFrameRate: z.number().nullable(),
  error: z.string().nullable(),
  pendingOutcome: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const captureHostSchema = z.object({
  id: z.string(),
  kind: z.string(),
  label: z.string(),
  surface: z.string(),
  state: z.string(),
  activeSessionId: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
  connected: z.boolean(),
  requestedFrameRates: z.array(z.number()),
  achievedFrameRate: z.number().nullable(),
});

export const captureSessionStatusSchema = captureSessionSchema.extend({
  recorderConnected: z.boolean(),
  mediaStatus: z.string().nullable(),
  mediaReady: z.boolean(),
});

export const captureHostTransportSchema = z.union([
  z.object({ id: z.string(), secret: z.string(), leaseMs: z.number() }),
  z.object({ session: captureSessionSchema.nullable() }),
  z.object({ released: z.literal(true) }),
  captureSessionSchema,
]);
