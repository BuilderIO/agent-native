import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import {
  attachmentFailureToError,
  mintAttachmentRef,
} from "../../private-blob/index.js";
import { getRequestUserEmail } from "../../server/request-context.js";
import { recorderReportSchema } from "../schema.js";

export default defineAction({
  description:
    "Store a Report a problem recorder report in the caller's private storage and return its ref. Only the reporting user, in the same organization, can read it back with read-problem-report.",
  schema: z.object({
    report: recorderReportSchema.describe(
      "The recorder report built with recorder.report({ reason: 'user' }).",
    ),
  }),
  agentTool: false,
  // The recorder caps its buffer at 512K characters of JSON, up to 1.5 MB of UTF-8.
  maxBodyBytes: 2 * 1024 * 1024,
  changeEvents: false,
  // The report belongs in private storage, not in the audit log's input copy.
  audit: { recordInputs: false },
  run: async ({ report }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      fail("Sign in to report a problem.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    const minted = await mintAttachmentRef({
      data: Buffer.from(JSON.stringify(report), "utf8"),
      filename: "problem-report.json",
      mimeType: "application/json",
      ownerEmail,
      metadata: { resourceType: "problem-report", appId: report.app },
    });
    if (minted.status !== "ok") throw attachmentFailureToError(minted, "save");
    return { ref: minted.ref };
  },
});
