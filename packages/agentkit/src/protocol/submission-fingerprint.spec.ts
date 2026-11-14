import { describe, expect, it } from "vitest";

import {
  fingerprintAgentSubmissionAttachment,
  submissionAttachmentsMatch,
} from "./submission-fingerprint.js";

describe("submission attachment fingerprints", () => {
  it.each([
    ["inline data", { data: "first body" }, { data: "changed body" }],
    ["inline text", { text: "first body" }, { text: "changed body" }],
  ])("binds reused file IDs to %s", (_label, original, changed) => {
    const source = {
      type: "file",
      name: "notes.txt",
      mediaType: "text/plain",
      fileId: "file-notes",
      ...original,
    };
    const submission = {
      attachments: [
        {
          type: "file" as const,
          name: source.name,
          mediaType: source.mediaType,
          fingerprint: fingerprintAgentSubmissionAttachment(source, "file"),
        },
      ],
    };

    expect(
      submissionAttachmentsMatch(submission, [{ ...source, ...changed }]),
    ).toBe(false);
  });

  it("matches file references after the runtime mapper renames identity fields", () => {
    const source = {
      type: "file",
      name: "report.pdf",
      mediaType: "application/pdf",
      fileId: "file-report",
      url: "https://files.example.test/report.pdf",
    };
    const submission = {
      attachments: [
        {
          type: "file" as const,
          name: source.name,
          mediaType: source.mediaType,
          fingerprint: fingerprintAgentSubmissionAttachment(source, "file"),
        },
      ],
    };

    expect(
      submissionAttachmentsMatch(submission, [
        {
          type: "image",
          name: source.name,
          mediaType: source.mediaType,
          contentType: source.mediaType,
          id: source.fileId,
          url: source.url,
        },
      ]),
    ).toBe(true);
    expect(
      submissionAttachmentsMatch(submission, [
        {
          type: "image",
          name: source.name,
          mediaType: source.mediaType,
          contentType: source.mediaType,
          id: source.fileId,
          url: "https://files.example.test/other.pdf",
        },
      ]),
    ).toBe(false);
  });

  it("matches request data and the separate original reference after mapping", () => {
    const source = {
      type: "image",
      name: "chart.png",
      contentType: "image/png",
      data: "data:image/png;base64,SGVsbG8=",
      url: "https://files.example.test/chart-resized.png",
      referenceUrl: "https://files.example.test/chart-original.png",
    };
    const submission = {
      requestAttachments: [
        {
          type: "image" as const,
          name: source.name,
          contentType: source.contentType,
          fingerprint: fingerprintAgentSubmissionAttachment(source, "image"),
        },
      ],
    };

    expect(
      submissionAttachmentsMatch(submission, [
        {
          type: "file",
          name: source.name,
          contentType: "image/jpeg",
          url: source.referenceUrl,
          referenceOnly: true,
        },
        {
          type: "image",
          name: source.name,
          contentType: source.contentType,
          data: source.data,
          url: source.url,
          referenceUrl: source.referenceUrl,
        },
      ]),
    ).toBe(true);

    expect(
      submissionAttachmentsMatch(submission, [
        {
          type: "file",
          name: source.name,
          contentType: source.contentType,
          url: source.referenceUrl,
          referenceOnly: true,
        },
        {
          type: "image",
          name: source.name,
          contentType: source.contentType,
          data: "data:image/png;base64,Rm9yZ2Vk",
          url: source.url,
          referenceUrl: source.referenceUrl,
        },
      ]),
    ).toBe(false);
  });
});
