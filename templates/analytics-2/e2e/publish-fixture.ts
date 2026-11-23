import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import { z } from "zod";

import { draftHeadSchema } from "../shared/notebook-snapshot-contract.js";
import {
  publishPreviewDetailSchema,
  publishPreviewReceiptSchema,
  publishProjectReceiptSchema,
} from "../shared/project-publish.js";
import { EvidenceFailure } from "./phase1/verdict.js";

type FixtureAction = (
  action: string,
  params: Record<string, unknown>,
  method: "GET" | "POST",
) => Promise<unknown>;

export async function waitForReadyPublishPreview(
  read: () => Promise<unknown>,
  timeout: number,
) {
  const readPreview = async () =>
    publishPreviewDetailSchema.parse(await read());
  let preview = await readPreview();
  const pending = () =>
    preview.state === "queued" || preview.state === "running";
  if (pending()) {
    await expect
      .poll(
        async () => {
          preview = await readPreview();
          return pending();
        },
        { timeout },
      )
      .toBe(false);
  }
  if (preview.state !== "ready") {
    const failed = preview.outputs.filter(
      ({ state }) => state === "failed",
    ).length;
    const missing = preview.outputs.filter(
      ({ state }) => state === "missing",
    ).length;
    const reasons =
      preview.run?.attempts.flatMap(({ state }) =>
        state.status === "failed" || state.status === "blocked"
          ? [state.reason]
          : [],
      ) ?? [];
    throw new EvidenceFailure(
      `Publish preview ${preview.state} (${failed} failed, ${missing} missing${reasons.length ? `, ${[...new Set(reasons)].join(", ")}` : ""})`,
    );
  }
  return preview;
}

export async function publishFixture(
  action: FixtureAction,
  projectId: string,
  description?: string,
) {
  const { project } = z
    .object({
      project: z.object({
        draftHead: draftHeadSchema,
        publishedVersionId: z.string().nullable(),
      }),
    })
    .parse(await action("get-project", { projectId }, "GET"));
  const accepted = {
    projectId,
    expectedHead: project.draftHead,
    expectedReleaseId: project.publishedVersionId,
  };
  const { previewId } = publishPreviewReceiptSchema.parse(
    await action(
      "create-project-publish-preview",
      { ...accepted, requestId: randomUUID() },
      "POST",
    ),
  );
  const preview = await waitForReadyPublishPreview(
    () =>
      action("get-project-publish-preview", { projectId, previewId }, "GET"),
    30_000,
  );
  return publishProjectReceiptSchema.parse(
    await action(
      "publish-project",
      {
        ...accepted,
        previewId,
        expectedManifestRevision: preview.manifestRevision,
        requestId: randomUUID(),
        description,
        mode: "ready",
      },
      "POST",
    ),
  );
}

export function publishBrowserFixture(
  page: Page,
  base: string,
  projectId: string,
) {
  return publishFixture(async (action, params, method) => {
    const url = `${base}/_agent-native/actions/${action}`;
    const headers = {
      "x-agent-native-frontend": "1",
      "x-agent-native-csrf": "1",
    };
    const result = await page.request.fetch(url, {
      headers,
      method,
      ...(method === "GET"
        ? { params: z.record(z.string(), z.string()).parse(params) }
        : { data: params }),
    });
    expect(result.ok(), `${action} HTTP ${result.status()}`).toBe(true);
    return result.json();
  }, projectId);
}
