import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { z } from "zod";

import {
  acknowledgeCaptureMarker,
  pollCaptureHost,
  registerCaptureHost,
  releaseCaptureHost,
  reportCaptureHost,
} from "../server/lib/motion-capture.js";
import { captureHostTransportSchema } from "./lib/capture-schemas.js";

const errors = defineActionErrors("missing_arguments");

function missing(message: string): never {
  return errors.fail(message, "missing_arguments", { statusCode: 400 });
}

export default defineAction({
  description:
    "Recorder-only authenticated transport for registering an armed capture host, heartbeats, recording state (including the begin gate) and marker acknowledgements.",
  agentTool: false,
  toolCallable: false,
  schema: z.object({
    operation: z.enum(["register", "poll", "report", "mark", "release"]),
    hostId: z.string().uuid().optional(),
    secret: z.string().length(64).optional(),
    kind: z.enum(["desktop", "chrome-extension", "browser"]).optional(),
    label: z.string().trim().min(1).max(120).optional(),
    surface: z.string().trim().min(1).max(200).optional(),
    sessionId: z.string().uuid().optional(),
    state: z
      .enum([
        "starting",
        "beginning",
        "recording",
        "finalizing",
        "complete",
        "failed",
        "cancelled",
      ])
      .optional(),
    pendingOutcome: z.enum(["complete", "failed", "cancelled"]).optional(),
    recordingId: z.string().min(1).max(100).optional(),
    startedAtMs: z.number().finite().positive().optional(),
    startUncertaintyMs: z.number().finite().nonnegative().optional(),
    observedFrameRate: z.number().finite().positive().max(240).optional(),
    error: z.string().max(500).optional(),
    markerId: z.string().length(64).optional(),
    mediaTimeMs: z.number().finite().nonnegative().max(130000).optional(),
    uncertaintyMs: z.number().finite().nonnegative().optional(),
  }),
  outputSchema: captureHostTransportSchema,
  errors,
  run: async (args) => {
    if (args.operation === "register") {
      if (!args.kind || !args.label || !args.surface)
        return missing("Recorder kind, label and explicit surface required.");
      return registerCaptureHost({
        kind: args.kind,
        label: args.label,
        surface: args.surface,
      });
    }
    if (!args.hostId || !args.secret)
      return missing("Recorder host credential required.");
    if (args.operation === "poll")
      return pollCaptureHost(
        args.hostId,
        args.secret,
        args.sessionId && args.pendingOutcome
          ? { sessionId: args.sessionId, outcome: args.pendingOutcome }
          : undefined,
      );
    if (args.operation === "release")
      return releaseCaptureHost(args.hostId, args.secret);
    if (!args.sessionId) return missing("Capture session required.");
    if (args.operation === "report") {
      if (!args.state) return missing("Recorder state required.");
      return reportCaptureHost({
        hostId: args.hostId,
        secret: args.secret,
        sessionId: args.sessionId,
        state: args.state,
        recordingId: args.recordingId,
        startedAtMs: args.startedAtMs,
        startUncertaintyMs: args.startUncertaintyMs,
        observedFrameRate: args.observedFrameRate,
        error: args.error,
      });
    }
    if (
      !args.markerId ||
      args.mediaTimeMs === undefined ||
      args.uncertaintyMs === undefined
    )
      return missing("Marker ID, media time and uncertainty required.");
    return acknowledgeCaptureMarker({
      hostId: args.hostId,
      secret: args.secret,
      sessionId: args.sessionId,
      markerId: args.markerId,
      mediaTimeMs: args.mediaTimeMs,
      uncertaintyMs: args.uncertaintyMs,
    });
  },
});
