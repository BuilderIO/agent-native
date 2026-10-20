import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import {
  ATTACHMENT_REF_MAX_CHARS,
  resolveAttachment,
  unwrapAttachment,
} from "../../private-blob/index.js";
import { getRequestUserEmail } from "../../server/request-context.js";
import { clipText, formatRecorderEvent } from "../format.js";
import { RECORDER_EVENT_TYPES, recorderReportSchema } from "../schema.js";

const SLICE_MAX_CHARS = 16_000;
const EVENT_DATA_MAX_CHARS = 2_000;
const WATCHED_MAX_CHARS = 4_000;

function failUnreadable(): never {
  fail("The stored problem report could not be read.", {
    errorCode: "problem_report_unreadable",
    statusCode: 422,
  });
}

function parseStoredReport(data: Buffer) {
  let json: unknown;
  try {
    json = JSON.parse(data.toString("utf8"));
  } catch {
    failUnreadable();
  }
  const parsed = recorderReportSchema.safeParse(json);
  if (!parsed.success) failUnreadable();
  return parsed.data;
}

export default defineAction({
  description:
    "Read events from a problem report the user attached with Report a problem. Returns the report's app, route and time, watched values, pending work, and a bounded text slice of events (oldest first), filtered by type and by time in seconds before the report. When `truncated` is true, call again with the same filters and `start: nextStart` for the rest.",
  schema: z.object({
    ref: z
      .string()
      .min(1)
      .max(ATTACHMENT_REF_MAX_CHARS)
      .describe(
        "The problem report ref from the report context, starting with attachment:v1:. Pass it exactly as given.",
      ),
    type: z
      .enum(RECORDER_EVENT_TYPES)
      .optional()
      .describe(
        'Only events of this type: "action", "state", "nav", "error", "toast" or "log". Omit for every type.',
      ),
    from: z.coerce
      .number()
      .optional()
      .describe(
        "Earliest event to include, in seconds relative to the report (negative, e.g. -30). Omit to start at the beginning of the report.",
      ),
    to: z.coerce
      .number()
      .optional()
      .describe(
        "Latest event to include, in seconds relative to the report (negative, e.g. -5). Omit to read up to the moment of the report.",
      ),
    start: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "How many matching events to skip. Pass `nextStart` from the previous call to continue.",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    idempotentHint: true,
  },
  run: async ({ ref, type, from, to, start = 0 }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      fail("Sign in to read problem reports.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    const file = unwrapAttachment(await resolveAttachment(ref, { ownerEmail }));
    const report = parseStoredReport(file.data);

    const matched = report.events.filter(
      (event) =>
        (type === undefined || event.type === type) &&
        (from === undefined || event.t >= from) &&
        (to === undefined || event.t <= to),
    );
    const lines: string[] = [];
    let chars = 0;
    for (const event of matched.slice(start)) {
      const line = formatRecorderEvent(event, EVENT_DATA_MAX_CHARS);
      if (chars + line.length + 1 > SLICE_MAX_CHARS) break;
      lines.push(line);
      chars += line.length + 1;
    }
    const nextStart = start + lines.length;

    return {
      app: report.app,
      build: report.build,
      url: report.url,
      at: report.at,
      windowSeconds: report.windowSeconds,
      droppedByRecorder: report.dropped,
      totalEvents: report.events.length,
      matchedEvents: matched.length,
      events: lines.join("\n"),
      truncated: nextStart < matched.length,
      ...(nextStart < matched.length ? { nextStart } : {}),
      watched: clipText(JSON.stringify(report.watched), WATCHED_MAX_CHARS),
      pending: report.pending,
    };
  },
});
