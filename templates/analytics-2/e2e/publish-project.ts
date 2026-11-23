import { expect, type Page } from "@playwright/test";
import { z } from "zod";

export async function publishProject(
  page: Page,
  base: string,
  projectId: string,
) {
  const headers = {
    "x-agent-native-frontend": "1",
    "x-agent-native-csrf": "1",
  };
  const snapshotResponse = await page.request.get(
    `${base}/_agent-native/actions/get-notebook-snapshot?${new URLSearchParams({ projectId })}`,
    { headers },
  );
  expect(snapshotResponse.ok()).toBe(true);
  const accepted = z
    .object({
      status: z.literal("accepted"),
      snapshot: z.object({ head: z.unknown() }),
    })
    .passthrough()
    .parse(await snapshotResponse.json());
  const expectedHead = accepted.snapshot.head;
  const expectedReleaseId = z
    .object({
      project: z.object({ publishedVersionId: z.string().nullable() }),
    })
    .passthrough()
    .parse(
      await (async () => {
        const response = await page.request.get(
          `${base}/_agent-native/actions/get-project?${new URLSearchParams({ projectId })}`,
          { headers },
        );
        expect(response.ok()).toBe(true);
        return response.json();
      })(),
    ).project.publishedVersionId;
  const created = await page.request.post(
    `${base}/_agent-native/actions/create-project-publish-preview`,
    {
      headers,
      data: {
        projectId,
        expectedHead,
        expectedReleaseId,
        requestId: crypto.randomUUID(),
      },
    },
  );
  expect(created.ok()).toBe(true);
  const previewId = z
    .object({ previewId: z.string().min(1) })
    .parse(await created.json()).previewId;
  let preview:
    | {
        head: unknown;
        compareReleaseId: string | null;
        manifestRevision: string;
      }
    | undefined;
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `${base}/_agent-native/actions/get-project-publish-preview?${new URLSearchParams({ projectId, previewId })}`,
        { headers },
      );
      if (!response.ok())
        throw new Error(
          `get-project-publish-preview ${response.status()}: ${await response.text()}`,
        );
      const value = z
        .object({
          state: z.enum([
            "queued",
            "running",
            "ready",
            "failed",
            "cancelled",
            "published",
          ]),
          head: z.unknown(),
          compareReleaseId: z.string().nullable(),
          manifestRevision: z.string(),
        })
        .passthrough()
        .parse(await response.json());
      if (value.state === "failed" || value.state === "cancelled")
        throw new Error(`Publish preview ${value.state}`);
      if (value.state === "ready") preview = value;
      return value.state;
    })
    .toBe("ready");
  if (!preview) throw new Error("Publish preview did not become ready");
  const published = await page.request.post(
    `${base}/_agent-native/actions/publish-project`,
    {
      headers,
      data: {
        projectId,
        previewId,
        requestId: crypto.randomUUID(),
        expectedHead: preview.head,
        expectedReleaseId: preview.compareReleaseId,
        expectedManifestRevision: preview.manifestRevision,
        mode: "ready",
      },
    },
  );
  if (!published.ok())
    throw new Error(
      `publish-project HTTP ${published.status()}:${await published.text()}`,
    );
  return published.json();
}
