import { z } from "zod";

export const DIAGNOSTIC_SCOPES = [
  "summary",
  "events",
  "state",
  "browser-diagnostics",
  "host-metadata",
] as const;
export type DiagnosticScope = (typeof DIAGNOSTIC_SCOPES)[number];
export const DIAGNOSTIC_ACCESS_PARAM = "diagnostic_access";
export const DIAGNOSTIC_RESOURCE_KIND = "clips-diagnostic-context";
export const DIAGNOSTIC_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const diagnosticScopeSchema = z.enum(DIAGNOSTIC_SCOPES);
const instant = z.iso.datetime();
export const diagnosticWindowSchema = z
  .object({ from: instant, to: instant })
  .refine(({ from, to }) => Date.parse(from) <= Date.parse(to));
export const diagnosticContextInputSchema = z
  .object({
    recordingId: z.string().min(1).max(200),
    captureId: z.string().min(1).max(200),
    contextVersion: z.number().int().positive().default(1),
    consent: z.literal(true),
    captureAuthorization: z.string().max(8000),
    recordingStartedAt: instant,
    requestedWindow: diagnosticWindowSchema,
    captured: z.enum([
      "collecting",
      "ready",
      "partial",
      "disabled",
      "unsupported",
      "failed",
    ]),
    coverage: z
      .array(
        z.object({
          documentId: z.string().max(200),
          from: instant,
          to: instant,
        }),
      )
      .max(200)
      .default([]),
    gaps: z
      .array(
        z.object({ from: instant, to: instant, reason: z.string().max(200) }),
      )
      .max(200)
      .default([]),
    pauses: z.array(diagnosticWindowSchema).max(200).default([]),
    droppedEvents: z.number().int().nonnegative().default(0),
    failureCode: z.string().max(200).optional(),
    activity: z.record(z.string(), z.unknown()).optional(),
    browserDiagnostics: z.record(z.string(), z.unknown()).optional(),
    hostMetadata: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((input, context) => {
    if (
      (input.captured === "ready" || input.captured === "partial") &&
      !input.activity &&
      !input.browserDiagnostics &&
      !input.hostMetadata
    )
      context.addIssue({
        code: "custom",
        message: "Ready context requires a captured evidence payload.",
        path: ["captured"],
      });
    const from = Date.parse(input.requestedWindow.from),
      to = Date.parse(input.requestedWindow.to),
      start = Date.parse(input.recordingStartedAt);
    if (from > start || to < start || start - from > 300_000)
      context.addIssue({
        code: "custom",
        message:
          "Requested interval must include recording start and at most five minutes of history.",
        path: ["requestedWindow"],
      });
    for (const [field, spans] of [
      ["coverage", input.coverage],
      ["gaps", input.gaps],
      ["pauses", input.pauses],
    ] as const) {
      spans.forEach((span, index) => {
        const a = Date.parse(span.from),
          b = Date.parse(span.to);
        if (a > b || a < from || b > to || (field === "pauses" && a < start))
          context.addIssue({
            code: "custom",
            message: "Span lies outside the requested interval.",
            path: [field, index],
          });
      });
    }
    const pauses = [...input.pauses].sort(
      (a, b) => Date.parse(a.from) - Date.parse(b.from),
    );
    let previousEnd = -Infinity;
    for (const pause of pauses) {
      if (Date.parse(pause.from) < previousEnd)
        context.addIssue({
          code: "custom",
          message: "Pause intervals overlap.",
          path: ["pauses"],
        });
      previousEnd = Date.parse(pause.to);
    }
  });

export type DiagnosticContextInput = z.input<
  typeof diagnosticContextInputSchema
>;
export const diagnosticReadSchema = z
  .object({
    contextId: z.string().optional(),
    recordingId: z.string().optional(),
    diagnosticAccess: z.string().max(8000).optional(),
    scopes: z.array(diagnosticScopeSchema).min(1).optional(),
    fromMs: z.number().finite().optional(),
    toMs: z.number().finite().optional(),
    start: z.number().int().nonnegative().default(0),
    maxEvents: z.number().int().min(1).max(200).default(100),
  })
  .refine((input) => !!input.contextId || !!input.recordingId);
