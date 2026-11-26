import { z } from "zod";

const nullablePositiveNumber = z.number().finite().positive().nullable();

export const recordingCaptureMetadataSchema = z.object({
  captureMode: z.enum(["normal", "motion"]),
  requestedFrameRate: z.number().finite().positive().max(240),
  trackReportedFrameRate: nullablePositiveNumber,
  observedFrameRate: nullablePositiveNumber,
  width: z.number().finite().nonnegative().nullable(),
  height: z.number().finite().nonnegative().nullable(),
  startedAtMs: nullablePositiveNumber,
  startUncertaintyMs: z.number().finite().nonnegative().nullable(),
  startClockSource: z
    .enum([
      "media-recorder-start-event",
      "native-recorder-start",
      "recorder-start-call",
    ])
    .nullable(),
});

export type RecordingCaptureMetadataInput = z.infer<
  typeof recordingCaptureMetadataSchema
>;
