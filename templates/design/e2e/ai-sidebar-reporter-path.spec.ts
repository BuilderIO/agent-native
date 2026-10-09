import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertNoInlineImageBytes } from "@agent-native/core/testing";
import { expect, test, type Locator, type Page } from "@playwright/test";

import enUS from "../app/i18n/en-US";
import { appPath, designFrame, gotoEditor, selectByText } from "./helpers";
import {
  CANARY_SESSION_ID,
  INLINE_BYTES_CANARIES,
  newInlineBytesHits,
  readChatRows,
  scanSqlForInlineBytes,
  scanSqlWithPoisonedRows,
} from "./sql-inline-bytes-scan";

const IMAGE_PROMPT = "Describe the attached image reference.";
const LINKEDIN_AD_PROMPT =
  "Create a LinkedIn single-image ad at exactly 1200x627 pixels. Use the uploaded PNG as visual inspiration and include this copy: Launch your next campaign with confidence.";
const EDIT_PROMPT =
  "Increase the selected heading's font size from 36px to 48px.";
const SEEDED_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      body { margin: 0; }
      .title { font-size: 36px; line-height: 1.15; }
    </style>
  </head>
  <body>
    <main data-agent-native-node-id="main">
      <h1 class="title" data-agent-native-node-id="launch-heading">Launch overview</h1>
    </main>
  </body>
</html>`;

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function padPngToBytes(source: Buffer, targetBytes: number): Buffer {
  let iendOffset = 8;
  while (iendOffset + 12 <= source.byteLength) {
    const chunkLength = source.readUInt32BE(iendOffset);
    const chunkType = source.toString("ascii", iendOffset + 4, iendOffset + 8);
    if (chunkType === "IEND") break;
    iendOffset += chunkLength + 12;
  }
  if (
    iendOffset + 12 > source.byteLength ||
    source.toString("ascii", iendOffset + 4, iendOffset + 8) !== "IEND"
  ) {
    throw new Error("PNG fixture has no IEND chunk.");
  }

  const textKeyword = Buffer.from("E2E reference\0", "latin1");
  const textPayloadBytes = Math.max(
    1,
    targetBytes - source.byteLength - textKeyword.byteLength - 12,
  );
  const chunkData = Buffer.concat([
    textKeyword,
    Buffer.alloc(textPayloadBytes, 0x78),
  ]);
  const chunkType = Buffer.from("tEXt", "ascii");
  const crcInput = Buffer.concat([chunkType, chunkData]);
  const chunk = Buffer.alloc(chunkData.byteLength + 12);
  chunk.writeUInt32BE(chunkData.byteLength, 0);
  chunkType.copy(chunk, 4);
  chunkData.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(crcInput), chunk.byteLength - 4);
  return Buffer.concat([
    source.subarray(0, iendOffset),
    chunk,
    source.subarray(iendOffset),
  ]);
}

function addExifOrientationAndPadJpeg(
  source: Buffer,
  targetBytes: number,
  orientation: number,
): Buffer {
  if (source[0] !== 0xff || source[1] !== 0xd8) {
    throw new Error("JPEG fixture has no start marker.");
  }
  const exifSegment = Buffer.alloc(36);
  exifSegment.set([0xff, 0xe1], 0);
  exifSegment.writeUInt16BE(34, 2);
  exifSegment.write("Exif\0\0", 4, "binary");
  exifSegment.write("II", 10, "ascii");
  exifSegment.writeUInt16LE(42, 12);
  exifSegment.writeUInt32LE(8, 14);
  exifSegment.writeUInt16LE(1, 18);
  exifSegment.writeUInt16LE(0x0112, 20);
  exifSegment.writeUInt16LE(3, 22);
  exifSegment.writeUInt32LE(1, 24);
  exifSegment.writeUInt16LE(orientation, 28);
  exifSegment.writeUInt32LE(0, 32);
  const oriented = Buffer.concat([
    source.subarray(0, 2),
    exifSegment,
    source.subarray(2),
  ]);
  const endOffset = oriented.lastIndexOf(Buffer.from([0xff, 0xd9]));
  if (endOffset < 2) throw new Error("JPEG fixture has no end marker.");
  const comments: Buffer[] = [];
  let paddedLength = oriented.byteLength;
  while (paddedLength < targetBytes) {
    const payloadLength = Math.max(
      0,
      Math.min(65_533, targetBytes - paddedLength - 4),
    );
    const comment = Buffer.alloc(payloadLength + 4, 0x78);
    comment.set([0xff, 0xfe], 0);
    comment.writeUInt16BE(payloadLength + 2, 2);
    comments.push(comment);
    paddedLength += comment.byteLength;
  }
  return Buffer.concat([
    oriented.subarray(0, endOffset),
    ...comments,
    oriented.subarray(endOffset),
  ]);
}

test.use({
  viewport: { width: 2800, height: 1200 },
  ignoreHTTPSErrors: true,
});

type DesignFile = { id: string; filename: string; content: string };
type DesignRecord = { data?: string; files?: DesignFile[] };
type ProviderProof = {
  callNames: string[];
  modelsSeen: string[];
  imageSha256Seen: string[];
  imageUrlsSeen: string[];
  toolCallsSeen: Array<{
    name: string;
    designId?: string;
    fileId?: string;
  }>;
  requestSummaries: Array<{
    toolResults: string[];
    assistantToolCalls: Array<{ name: string; arguments: string }>;
    userMessages: string[];
    availableTools: string[];
    editPromptMatched: boolean;
  }>;
};

async function readDesign(page: Page, id: string) {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${encodeURIComponent(id)}`),
  );
  if (!response.ok())
    throw new Error(`get-design failed: ${await response.text()}`);
  return (await response.json()) as DesignRecord;
}

async function action(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await page.request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input },
  );
  if (!response.ok())
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  return response.json();
}

async function createDesign(page: Page) {
  const created = await action(page, "create-design", {
    title: `Image attachment transport ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (typeof designId !== "string")
    throw new Error(`create-design returned no id: ${JSON.stringify(created)}`);
  const createdFile = await action(page, "create-file", {
    designId,
    filename: "index.html",
    content: SEEDED_HTML,
    fileType: "html",
  });
  const fileId = createdFile.id ?? createdFile.data?.id;
  if (typeof fileId !== "string")
    throw new Error(
      `create-file returned no id: ${JSON.stringify(createdFile)}`,
    );
  await action(page, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["screenMetadata", fileId],
        value: { sourceType: "inline", width: 390, height: 844 },
      },
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: { x: 0, y: 0, width: 390, height: 844, z: 0 },
      },
    ],
  });
  return { designId, fileId };
}

async function configureProvider(
  page: Page,
  designId: string,
  fileId: string,
  mode: "observe" | "edit" | "linkedin-ad",
) {
  const port = test.info().config.metadata.sidebarLoopbackPort as number;
  const response = await page.request.post(
    `http://127.0.0.1:${port}/__configure`, // e2e-harness-ignore: configure the separate deterministic test provider.
    { data: { designId, fileId, mode } },
  );
  expect(response.status()).toBe(204);
}

async function holdProviderResponseTo(page: Page, userMessage: string) {
  const port = test.info().config.metadata.sidebarLoopbackPort as number;
  const response = await page.request.post(
    `http://127.0.0.1:${port}/__hold-next-response`, // e2e-harness-ignore: pause the separate deterministic test provider.
    { data: { userMessageStartsWith: userMessage } },
  );
  expect(response.status()).toBe(204);
}

async function releaseHeldProviderResponse(page: Page): Promise<number> {
  const port = test.info().config.metadata.sidebarLoopbackPort as number;
  const response = await page.request.post(
    `http://127.0.0.1:${port}/__release-held-response`, // e2e-harness-ignore: resume the separate deterministic test provider.
  );
  return response.status();
}

async function readProviderProof(page: Page): Promise<ProviderProof> {
  const port = test.info().config.metadata.sidebarLoopbackPort as number;
  const response = await page.request.get(
    `http://127.0.0.1:${port}/__proof`, // e2e-harness-ignore: read state from the separate loopback provider.
  );
  if (!response.ok())
    throw new Error(`loopback provider proof failed: ${response.status()}`);
  return (await response.json()) as ProviderProof;
}

async function routeImageAsOwnedStorageUrl(
  page: Page,
  name: string,
  options: { useOriginalReference?: boolean } = {},
) {
  let rewrittenRequests = 0;
  await page.route(/\/_agent-native\/agent-chat$/, async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }
    const body = request.postDataJSON() as {
      attachments?: Array<Record<string, unknown>>;
    };
    const attachment = body.attachments?.find(
      (candidate) =>
        candidate.type === "image" &&
        candidate.name === name &&
        typeof candidate.data === "string",
    );
    if (!attachment) {
      await route.continue();
      return;
    }
    const originalFile = options.useOriginalReference
      ? body.attachments?.find(
          (candidate) =>
            candidate.type === "file" &&
            candidate.name === name &&
            typeof candidate.url === "string",
        )
      : undefined;
    const url = options.useOriginalReference
      ? (originalFile?.url ?? attachment.referenceUrl ?? attachment.url)
      : (attachment.url ?? attachment.referenceUrl);
    if (typeof url !== "string" || !url.startsWith("https://")) {
      throw new Error(`${name} has no owned HTTPS reference URL.`);
    }
    delete attachment.data;
    delete attachment.referenceUrl;
    attachment.url = url;
    rewrittenRequests += 1;
    await route.continue({ postData: JSON.stringify(body) });
  });
  return () => rewrittenRequests;
}

async function openSidebarComposer(
  page: Page,
  designId: string,
  fileId: string,
) {
  await page.goto(appPath(`/design/${designId}`), {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  const workspaceRail = page.locator(
    '[data-design-chrome-region="workspace-rail"]',
  );
  await expect(workspaceRail).toBeVisible({ timeout: 15_000 });
  await workspaceRail
    .getByRole("button", {
      name: enUS.designEditor.leftRail.agent,
      exact: true,
    })
    .click();
  await expect(
    page.locator(`iframe[data-screen-iframe-id="${fileId}"]`),
  ).toBeVisible({ timeout: 30_000 });
  const heading = designFrame(page, fileId).locator("h1.title");
  await expect(heading).toBeVisible({ timeout: 30_000 });
  const sidebarComposer = page.locator(".agent-composer-root").last();
  const sidebarPrompt = sidebarComposer.locator(".ProseMirror").last();
  await expect(sidebarPrompt).toBeVisible({ timeout: 15_000 });
  return { heading, sidebarComposer, sidebarPrompt };
}

async function uploadImage(
  page: Page,
  sidebarComposer: Locator,
  targetBytes = 1_500_000,
): Promise<{ bytes: Buffer; sha256: string; dataUrl: string }> {
  const imagePath = path.resolve(
    import.meta.dirname,
    "fixtures",
    "card-art-photo.png",
  );
  const source = await readFile(imagePath);
  const largeRasterBase64 =
    targetBytes > 2 * 1024 * 1024
      ? await page.evaluate(
          async ({ dataUrl, width }) => {
            const image = new Image();
            image.src = dataUrl;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = (canvas.width * 9) / 16;
            const context = canvas.getContext("2d");
            if (!context)
              throw new Error("Could not create image fixture canvas");
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL("image/png").split(",", 2)[1]!;
          },
          {
            dataUrl: `data:image/png;base64,${source.toString("base64")}`,
            width: targetBytes >= 5_000_000 ? 2560 : 1280,
          },
        )
      : undefined;
  const largeRaster = largeRasterBase64
    ? Buffer.from(largeRasterBase64, "base64")
    : source;
  const bytes = padPngToBytes(largeRaster, targetBytes);
  expect(bytes.byteLength).toBe(targetBytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;

  await sidebarComposer
    .getByRole("button", { name: "Add context", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Upload File", exact: true })
    .click();
  const imageInput = sidebarComposer.locator('input[type="file"][multiple]');
  await expect(imageInput).toHaveCount(1);
  const acceptedTypes = (await imageInput.getAttribute("accept"))
    ?.split(",")
    .map((type) => type.trim().toLowerCase())
    .filter(Boolean);
  expect(
    !acceptedTypes?.length ||
      acceptedTypes.some((type) =>
        ["image/*", "image/png", ".png"].includes(type),
      ),
    `sidebar upload input accepts PNG images (accept=${JSON.stringify(acceptedTypes)})`,
  ).toBe(true);
  await imageInput.setInputFiles({
    name: "card-art-photo.png",
    mimeType: "image/png",
    buffer: bytes,
  });
  await expect(
    sidebarComposer.getByRole("button", {
      name: "Remove card-art-photo.png",
    }),
  ).toBeVisible();
  return { bytes, sha256, dataUrl };
}

test("Design editor sidebar sends uploaded PNG bytes to model vision input", async ({
  page,
}) => {
  test
    .info()
    .skip(
      process.env.E2E_AI_SIDEBAR_LOOPBACK !== "1",
      "requires E2E_AI_SIDEBAR_LOOPBACK=1",
    );
  await page.context().addInitScript(() => {
    if (location.origin === "null") return;
    const selection = JSON.stringify({
      model: "agentkit-loopback",
      engine: "ai-sdk:openai",
      effort: "medium",
    });
    localStorage.setItem(
      "agent-native:chat-models:selection:design",
      selection,
    );
    localStorage.setItem("agent-native:chat-models:selection", selection);
  });

  const { designId, fileId } = await createDesign(page);
  await configureProvider(page, designId, fileId, "observe");
  const { sidebarComposer, sidebarPrompt } = await openSidebarComposer(
    page,
    designId,
    fileId,
  );
  const image = await uploadImage(page, sidebarComposer);
  await sidebarPrompt.fill(IMAGE_PROMPT);
  await sidebarPrompt.press("Enter");

  await expect
    .poll(
      async () =>
        (await readProviderProof(page)).imageSha256Seen.includes(image.sha256),
      { timeout: 45_000, intervals: [250, 500, 1_000] },
    )
    .toBe(true);
  await expect(
    page
      .getByRole("article", { name: "Agent" })
      .last()
      .getByText("I received the uploaded image reference.", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });

  const providerPort = test.info().config.metadata
    .sidebarLoopbackPort as number;
  const stateResponse = await page.request.get(
    `http://127.0.0.1:${providerPort}/__state`, // e2e-harness-ignore: read full model input from the separate loopback provider.
  );
  const state = (await stateResponse.json()) as {
    imageDataUrlsSeen: string[];
  };
  const seenImage = state.imageDataUrlsSeen.find(
    (value) => value === image.dataUrl,
  );
  expect(seenImage).toBe(image.dataUrl);
  const [imageHeader, imageBase64] = seenImage!.split(",", 2);
  expect(imageHeader).toBe("data:image/png;base64");
  expect(Buffer.from(imageBase64!, "base64").equals(image.bytes)).toBe(true);

  const storagePort = test.info().config.metadata
    .attachmentStorageControlPort as number;
  const storageResponse = await page.request.get(
    `http://127.0.0.1:${storagePort}/__state`, // e2e-harness-ignore: read state from this E2E's HTTPS storage stub.
  );
  const storageState = (await storageResponse.json()) as {
    uploads: Array<{ id: string; size: number; sha256: string }>;
    reads: Array<{
      id: string;
      size: number;
      sha256: string;
      userAgent?: string;
    }>;
  };
  expect(storageState.uploads).toHaveLength(1);
  const storedUpload = storageState.uploads[0]!;
  expect(storedUpload.size).toBe(image.bytes.byteLength);
  expect(storedUpload.sha256).toBe(image.sha256);
  expect(
    storageState.reads.some(
      (read) =>
        read.id === storedUpload.id &&
        !(read.userAgent ?? "").toLowerCase().includes("mozilla"),
    ),
  ).toBe(true);
});

test("Design editor shows an error for invalid exact canvas dimensions", async ({
  page,
}) => {
  const created = await action(page, "create-design", {
    title: `Invalid canvas dimensions ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (typeof designId !== "string")
    throw new Error(`create-design returned no id: ${JSON.stringify(created)}`);
  const imagePath = path.resolve(
    import.meta.dirname,
    "fixtures",
    "card-art-photo.png",
  );
  const dataUrl = `data:image/png;base64,${(await readFile(imagePath)).toString("base64")}`;
  await page.addInitScript(
    ({ id, imageDataUrl }) => {
      sessionStorage.setItem(
        `design.pending-generation.${id}`,
        JSON.stringify({
          createdAt: Date.now(),
          autoGenerate: true,
          skipQuestions: true,
          prompt: "Create a LinkedIn ad at exactly 0x600 pixels",
          files: [
            {
              path: "/uploads/reference.png",
              originalName: "reference.png",
              filename: "reference.png",
              type: "image/png",
              size: 128,
              dataUrl: imageDataUrl,
            },
          ],
        }),
      );
    },
    { id: designId, imageDataUrl: dataUrl },
  );

  let agentChatRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/_agent-native/agent-chat")) {
      agentChatRequests += 1;
    }
  });
  await page.goto(appPath(`/design/${designId}`), {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText(
      "The requested canvas size isn't supported. Use positive pixel dimensions within the editor limits.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 30_000 });
  expect(agentChatRequests).toBe(0);
  await expect
    .poll(() =>
      page.evaluate(
        (id) => sessionStorage.getItem(`design.pending-generation.${id}`),
        designId,
      ),
    )
    .toBeNull();
  await page.screenshot({
    path: test.info().outputPath("invalid-canvas-dimensions.png"),
    fullPage: true,
  });
});

test("Design chat hydrates a 2.3 MB HTTPS upload into model vision input", async ({
  page,
}) => {
  test
    .info()
    .skip(
      process.env.E2E_AI_SIDEBAR_LOOPBACK !== "1",
      "requires E2E_AI_SIDEBAR_LOOPBACK=1",
    );
  await page.context().addInitScript(() => {
    if (location.origin === "null") return;
    const selection = JSON.stringify({
      model: "agentkit-loopback",
      engine: "ai-sdk:openai",
      effort: "medium",
    });
    localStorage.setItem(
      "agent-native:chat-models:selection:design",
      selection,
    );
    localStorage.setItem("agent-native:chat-models:selection", selection);
  });

  const { designId, fileId } = await createDesign(page);
  await configureProvider(page, designId, fileId, "observe");
  const { sidebarComposer, sidebarPrompt } = await openSidebarComposer(
    page,
    designId,
    fileId,
  );
  const image = await uploadImage(page, sidebarComposer, 2_300_000);
  const rewrittenRequests = await routeImageAsOwnedStorageUrl(
    page,
    "card-art-photo.png",
    { useOriginalReference: true },
  );
  await sidebarPrompt.fill(IMAGE_PROMPT);
  await sidebarPrompt.press("Enter");

  await expect
    .poll(async () => (await readProviderProof(page)).imageSha256Seen, {
      timeout: 45_000,
      intervals: [250, 500, 1_000],
    })
    .toContain(image.sha256);
  expect(rewrittenRequests()).toBe(1);

  const providerPort = test.info().config.metadata
    .sidebarLoopbackPort as number;
  const providerResponse = await page.request.get(
    `http://127.0.0.1:${providerPort}/__state`, // e2e-harness-ignore: read full model input from the separate loopback provider.
  );
  const providerState = (await providerResponse.json()) as {
    imageDataUrlsSeen: string[];
    imageSha256Seen: string[];
    requestSummaries: Array<{ userMessages: string[] }>;
  };
  expect(providerState.imageDataUrlsSeen).toHaveLength(1);
  expect(providerState.imageSha256Seen).toEqual([image.sha256]);
  const [imageHeader, base64] = providerState.imageDataUrlsSeen[0]!.split(
    ",",
    2,
  );
  expect(imageHeader).toBe("data:image/png;base64");
  expect(Buffer.from(base64!, "base64").equals(image.bytes)).toBe(true);
  const providerText = providerState.requestSummaries
    .flatMap((summary) => summary.userMessages)
    .join("\n");
  expect(providerText).not.toContain("<chat-attachment-read-error");
  expect(providerText).not.toContain("<chat-attachment-processing-error");

  const storagePort = test.info().config.metadata
    .attachmentStorageControlPort as number;
  const storageResponse = await page.request.get(
    `http://127.0.0.1:${storagePort}/__state`, // e2e-harness-ignore: read state from this E2E's HTTPS storage stub.
  );
  const storageState = (await storageResponse.json()) as {
    uploads: Array<{ id: string; size: number; sha256: string }>;
    reads: Array<{
      id: string;
      size: number;
      sha256: string;
      userAgent?: string;
    }>;
  };
  const upload = storageState.uploads.find(
    (candidate) => candidate.sha256 === image.sha256,
  );
  expect(upload).toMatchObject({
    size: image.bytes.byteLength,
    sha256: image.sha256,
  });
  expect(
    storageState.reads.some(
      (read) =>
        read.id === upload?.id &&
        read.sha256 === image.sha256 &&
        !(read.userAgent ?? "").toLowerCase().includes("mozilla"),
    ),
  ).toBe(true);
});

test("Design editor hydrates a 6 MB PNG's resized durable URL into model vision input", async ({
  page,
}) => {
  test
    .info()
    .skip(
      process.env.E2E_AI_SIDEBAR_LOOPBACK !== "1",
      "requires E2E_AI_SIDEBAR_LOOPBACK=1",
    );
  await page.context().addInitScript(() => {
    if (location.origin === "null") return;
    const selection = JSON.stringify({
      model: "agentkit-loopback",
      engine: "ai-sdk:openai",
      effort: "medium",
    });
    localStorage.setItem(
      "agent-native:chat-models:selection:design",
      selection,
    );
    localStorage.setItem("agent-native:chat-models:selection", selection);
  });

  const { designId, fileId } = await createDesign(page);
  await configureProvider(page, designId, fileId, "observe");
  const { sidebarComposer, sidebarPrompt } = await openSidebarComposer(
    page,
    designId,
    fileId,
  );
  const original = await uploadImage(page, sidebarComposer, 6_000_000);
  const rewrittenRequests = await routeImageAsOwnedStorageUrl(
    page,
    "card-art-photo.png",
  );
  await sidebarPrompt.fill(IMAGE_PROMPT);
  await sidebarPrompt.press("Enter");

  await expect
    .poll(async () => (await readProviderProof(page)).imageSha256Seen, {
      timeout: 45_000,
      intervals: [250, 500, 1_000],
    })
    .toHaveLength(1);
  expect(rewrittenRequests()).toBe(1);

  const providerPort = test.info().config.metadata
    .sidebarLoopbackPort as number;
  const providerResponse = await page.request.get(
    `http://127.0.0.1:${providerPort}/__state`, // e2e-harness-ignore: read full model input from the separate loopback provider.
  );
  const providerState = (await providerResponse.json()) as {
    imageDataUrlsSeen: string[];
    imageSha256Seen: string[];
    requestSummaries: Array<{ userMessages: string[] }>;
  };
  expect(providerState.imageDataUrlsSeen).toHaveLength(1);
  const [imageHeader, imageBase64] = providerState.imageDataUrlsSeen[0]!.split(
    ",",
    2,
  );
  expect(imageHeader).toMatch(/^data:image\/(?:png|jpeg);base64$/);
  const resizedBytes = Buffer.from(imageBase64!, "base64");
  const resizedSha256 = createHash("sha256").update(resizedBytes).digest("hex");
  expect(providerState.imageSha256Seen).toEqual([resizedSha256]);
  expect(resizedSha256).not.toBe(original.sha256);
  const resizedDimensions = await page.evaluate(async (dataUrl) => {
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  }, providerState.imageDataUrlsSeen[0]!);
  expect(Math.max(resizedDimensions.width, resizedDimensions.height)).toBe(
    2048,
  );

  const providerText = providerState.requestSummaries
    .flatMap((summary) => summary.userMessages)
    .join("\n");
  expect(providerText).not.toContain("<chat-attachment-read-error");
  expect(providerText).not.toContain("<chat-attachment-processing-error");

  const storagePort = test.info().config.metadata
    .attachmentStorageControlPort as number;
  const storageResponse = await page.request.get(
    `http://127.0.0.1:${storagePort}/__state`, // e2e-harness-ignore: read state from this E2E's HTTPS storage stub.
  );
  const storageState = (await storageResponse.json()) as {
    uploads: Array<{ id: string; size: number; sha256: string }>;
    reads: Array<{
      id: string;
      size: number;
      sha256: string;
      userAgent?: string;
    }>;
  };
  const originalUpload = storageState.uploads.find(
    (upload) => upload.sha256 === original.sha256,
  );
  const resizedUpload = storageState.uploads.find(
    (upload) => upload.sha256 === resizedSha256,
  );
  expect(originalUpload).toMatchObject({ sha256: original.sha256 });
  expect(resizedUpload).toMatchObject({
    size: resizedBytes.byteLength,
    sha256: resizedSha256,
  });
  expect(
    storageState.reads.some(
      (read) =>
        read.id === resizedUpload?.id &&
        read.sha256 === resizedSha256 &&
        !(read.userAgent ?? "").toLowerCase().includes("mozilla"),
    ),
  ).toBe(true);
});

test("Design editor downscales a 6 MB PNG for vision and retains the original upload", async ({
  page,
}) => {
  test
    .info()
    .skip(
      process.env.E2E_AI_SIDEBAR_LOOPBACK !== "1",
      "requires E2E_AI_SIDEBAR_LOOPBACK=1",
    );
  await page.context().addInitScript(() => {
    if (location.origin === "null") return;
    const selection = JSON.stringify({
      model: "agentkit-loopback",
      engine: "ai-sdk:openai",
      effort: "medium",
    });
    localStorage.setItem(
      "agent-native:chat-models:selection:design",
      selection,
    );
    localStorage.setItem("agent-native:chat-models:selection", selection);
  });

  const sqlBefore = await scanSqlForInlineBytes(test.info());
  const { designId, fileId } = await createDesign(page);
  await configureProvider(page, designId, fileId, "linkedin-ad");
  const { sidebarComposer, sidebarPrompt } = await openSidebarComposer(
    page,
    designId,
    fileId,
  );
  const original = await uploadImage(page, sidebarComposer, 6_000_000);
  await sidebarPrompt.fill(LINKEDIN_AD_PROMPT);
  await sidebarPrompt.press("Enter");

  await expect
    .poll(async () => (await readProviderProof(page)).imageSha256Seen.length, {
      timeout: 45_000,
      intervals: [250, 500, 1_000],
    })
    .toBeGreaterThanOrEqual(2);
  await expect
    .poll(async () => (await readProviderProof(page)).callNames, {
      timeout: 45_000,
      intervals: [250, 500, 1_000],
    })
    .toContain("generate-design");

  const providerPort = test.info().config.metadata
    .sidebarLoopbackPort as number;
  const stateResponse = await page.request.get(
    `http://127.0.0.1:${providerPort}/__state`, // e2e-harness-ignore: read full model input from the separate loopback provider.
  );
  const state = (await stateResponse.json()) as {
    imageDataUrlsSeen: string[];
    imageSha256Seen: string[];
    requestSummaries: Array<{
      roles: string[];
      userMessages: string[];
      imageCount: number;
      availableTools: string[];
      responseMode: "observe" | "edit" | "linkedin-ad";
      linkedinAdPromptMatched: boolean;
      generationIssuedBefore: boolean;
      toolResults: string[];
      assistantToolCalls: Array<{ name: string; arguments: string }>;
    }>;
    callNames: string[];
    toolCallsSeen: Array<{
      name: string;
      designId?: string;
      fileId?: string;
      fileCount?: number;
      prompt?: string;
      imageCount: number;
      imageSha256: string[];
    }>;
  };
  expect(state.imageDataUrlsSeen).toHaveLength(2);
  const [imageHeader, imageBase64] = state.imageDataUrlsSeen[0]!.split(",", 2);
  expect(imageHeader).toMatch(/^data:image\/(?:png|jpeg);base64$/);
  const downscaledBytes = Buffer.from(imageBase64!, "base64");
  const downscaledDimensions = await page.evaluate(async (dataUrl) => {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  }, state.imageDataUrlsSeen[0]!);
  expect(
    Math.max(downscaledDimensions.width, downscaledDimensions.height),
  ).toBe(2048);
  const downscaledSha256 = createHash("sha256")
    .update(downscaledBytes)
    .digest("hex");
  expect(state.imageSha256Seen).toEqual([downscaledSha256, downscaledSha256]);
  expect(downscaledBytes.byteLength).toBeLessThan(2 * 1024 * 1024);
  expect(downscaledSha256).not.toBe(original.sha256);
  const providerText = state.requestSummaries
    .flatMap((summary) => summary.userMessages)
    .join("\n");
  expect(providerText).toContain("card-art-photo.png");
  expect(providerText).toContain(LINKEDIN_AD_PROMPT);
  expect(state.callNames).toContain("generate-design");
  expect(
    state.toolCallsSeen,
    JSON.stringify(
      state.requestSummaries.map(
        ({
          imageCount,
          responseMode,
          linkedinAdPromptMatched,
          generationIssuedBefore,
          userMessages,
          roles,
          assistantToolCalls,
        }) => ({
          imageCount,
          responseMode,
          linkedinAdPromptMatched,
          generationIssuedBefore,
          roles,
          userMessages,
          assistantToolCalls,
        }),
      ),
    ),
  ).toContainEqual(
    expect.objectContaining({
      name: "generate-design",
      prompt: LINKEDIN_AD_PROMPT,
      fileCount: 1,
      imageCount: 1,
      imageSha256: [downscaledSha256],
    }),
  );
  expect(
    state.requestSummaries.some(
      (summary) =>
        summary.responseMode === "linkedin-ad" &&
        summary.imageCount > 0 &&
        summary.linkedinAdPromptMatched,
    ),
    JSON.stringify(
      state.requestSummaries.map(
        ({ imageCount, responseMode, linkedinAdPromptMatched }) => ({
          imageCount,
          responseMode,
          linkedinAdPromptMatched,
        }),
      ),
    ),
  ).toBe(true);
  const toolResults = state.requestSummaries.flatMap(
    (summary) => summary.toolResults,
  );
  const availableDesignTools = [
    ...new Set(
      state.requestSummaries.flatMap((summary) => summary.availableTools),
    ),
  ].filter((name) => name.toLowerCase().includes("design"));
  expect(
    state.requestSummaries.some((summary) =>
      summary.availableTools.includes("generate-design"),
    ),
    JSON.stringify(availableDesignTools),
  ).toBe(true);
  expect(toolResults, JSON.stringify(state.requestSummaries)).not.toHaveLength(
    0,
  );
  expect(toolResults.join("\n")).not.toMatch(/tool call failed|action failed/i);
  const visionRequests = state.requestSummaries.filter(
    (summary) => summary.imageCount > 0,
  );
  expect(visionRequests.length).toBeGreaterThanOrEqual(2);
  expect(visionRequests.every((summary) => summary.imageCount === 1)).toBe(
    true,
  );
  expect(providerText).not.toContain("<chat-attachment-read-error");
  expect(providerText).not.toContain("<chat-attachment-processing-error");

  const storagePort = test.info().config.metadata
    .attachmentStorageControlPort as number;
  const storageResponse = await page.request.get(
    `http://127.0.0.1:${storagePort}/__state`, // e2e-harness-ignore: read state from this E2E's HTTPS storage stub.
  );
  const storageState = (await storageResponse.json()) as {
    uploads: Array<{ id: string; size: number; sha256: string }>;
    reads: Array<{
      id: string;
      size: number;
      sha256: string;
      userAgent?: string;
    }>;
  };
  const originalUploads = storageState.uploads.filter(
    (upload) => upload.sha256 === original.sha256,
  );
  expect(originalUploads.length).toBeGreaterThan(0);
  expect(
    originalUploads.every(
      (upload) => upload.size === original.bytes.byteLength,
    ),
  ).toBe(true);
  const servedBaseUrl =
    test.info().project.use.baseURL ?? process.env.E2E_BASE_URL;
  expect(servedBaseUrl).toBeDefined();
  const storageObjectUrl = new URL(servedBaseUrl!);
  storageObjectUrl.protocol = "https:";
  storageObjectUrl.port = String(
    test.info().config.metadata.attachmentStorageHttpsPort,
  );
  expect(
    originalUploads.some((upload) => {
      storageObjectUrl.pathname = `/objects/${upload.id}`;
      return providerText.includes(storageObjectUrl.toString());
    }),
  ).toBe(true);
  expect(
    storageState.reads.some(
      (read) =>
        originalUploads.some((upload) => upload.id === read.id) &&
        !(read.userAgent ?? "").toLowerCase().includes("mozilla"),
    ),
  ).toBe(false);
  const resizedUpload = storageState.uploads.find(
    (upload) => upload.sha256 === downscaledSha256,
  );
  expect(resizedUpload).toMatchObject({
    size: downscaledBytes.byteLength,
    sha256: downscaledSha256,
  });

  await expect
    .poll(
      async () => {
        const design = await readDesign(page, designId);
        return design.data ? JSON.parse(design.data).lastPrompt : undefined;
      },
      { timeout: 15_000, intervals: [250, 500, 1_000] },
    )
    .toBe(LINKEDIN_AD_PROMPT);

  await expect
    .poll(
      async () => {
        const design = await readDesign(page, designId);
        const screen = design.files?.find(
          (file) => file.filename === "index.html",
        );
        const data = design.data ? JSON.parse(design.data) : {};
        const frame = screen ? data.canvasFrames?.[screen.id] : undefined;
        const metadata = screen ? data.screenMetadata?.[screen.id] : undefined;
        return {
          fileCount: design.files?.length ?? 0,
          canvasFrameCount: Object.keys(data.canvasFrames ?? {}).length,
          frameSize: frame ? [frame.width, frame.height] : null,
          screenSize: metadata ? [metadata.width, metadata.height] : null,
          fixedHeight:
            metadata?.heightPinned === true && metadata?.heightMode === "fixed",
          breakpointWidths: metadata?.breakpointWidths ?? null,
          breakpointSet: data.breakpointSet ?? null,
        };
      },
      { timeout: 45_000, intervals: [250, 500, 1_000] },
    )
    .toEqual({
      fileCount: 2,
      canvasFrameCount: 1,
      frameSize: [1200, 627],
      screenSize: [1200, 627],
      fixedHeight: true,
      breakpointWidths: [],
      breakpointSet: null,
    });

  // The reference image reached generate-design; none of it may land in SQL.
  expect(
    newInlineBytesHits(sqlBefore, await scanSqlForInlineBytes(test.info())),
  ).toEqual([]);
});

test("Design editor sidebar applies a same-thread edit and persists it", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_AI_SIDEBAR_LOOPBACK !== "1",
    "requires E2E_AI_SIDEBAR_LOOPBACK=1",
  );
  await page.context().addInitScript(() => {
    if (location.origin === "null") return;
    const selection = JSON.stringify({
      model: "agentkit-loopback",
      engine: "ai-sdk:openai",
      effort: "medium",
    });
    localStorage.setItem(
      "agent-native:chat-models:selection:design",
      selection,
    );
    localStorage.setItem("agent-native:chat-models:selection", selection);
  });

  const { designId, fileId } = await createDesign(page);
  await configureProvider(page, designId, fileId, "edit");
  const { heading, sidebarPrompt } = await openSidebarComposer(
    page,
    designId,
    fileId,
  );
  const selection = await selectByText(page, "Launch overview", {
    screenId: fileId,
  });
  expect(selection.sourceId).toBeTruthy();

  await sidebarPrompt.fill(EDIT_PROMPT);
  await sidebarPrompt.press("Enter");

  await expect
    .poll(
      async () => {
        const proof = await readProviderProof(page);
        return (
          proof.toolCallsSeen.some(
            (call) =>
              call.name === "edit-design" &&
              call.designId === designId &&
              call.fileId === fileId,
          ) || JSON.stringify(proof)
        );
      },
      { timeout: 45_000, intervals: [250, 500, 1_000] },
    )
    .toBe(true);

  await expect
    .poll(
      async () => {
        const proof = await readProviderProof(page);
        return (
          proof.requestSummaries.some((summary) =>
            summary.toolResults.some((candidate) => candidate.length > 0),
          ) || JSON.stringify(proof)
        );
      },
      { timeout: 45_000, intervals: [250, 500, 1_000] },
    )
    .toBe(true);
  const proof = await readProviderProof(page);
  expect(proof.callNames).toContain("edit-design");
  expect(proof.modelsSeen).toContain("agentkit-loopback");
  expect(
    proof.requestSummaries.flatMap((summary) => summary.assistantToolCalls),
  ).toContainEqual(
    expect.objectContaining({
      name: "edit-design",
      arguments: expect.stringContaining(fileId),
    }),
  );
  expect(
    proof.requestSummaries.flatMap((summary) => summary.toolResults),
  ).not.toHaveLength(0);

  const edited = await readDesign(page, designId);
  const editedFile = edited.files?.find((candidate) => candidate.id === fileId);
  expect(editedFile?.content).toContain(
    ".title { font-size: 48px; line-height: 1.15; }",
  );
  await expect(heading).toHaveCSS("font-size", "48px", { timeout: 30_000 });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.locator(`iframe[data-screen-iframe-id="${fileId}"]`),
  ).toBeVisible({ timeout: 30_000 });
  await expect(designFrame(page, fileId).locator("h1.title")).toHaveCSS(
    "font-size",
    "48px",
    { timeout: 30_000 },
  );
});

test("Design chat preserves EXIF-rotated JPEG dimensions and orientation", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_AI_SIDEBAR_LOOPBACK !== "1",
    "requires E2E_AI_SIDEBAR_LOOPBACK=1",
  );
  await page.context().addInitScript(() => {
    if (location.origin === "null") return;
    const selection = JSON.stringify({
      model: "agentkit-loopback",
      engine: "ai-sdk:openai",
      effort: "medium",
    });
    localStorage.setItem(
      "agent-native:chat-models:selection:design",
      selection,
    );
    localStorage.setItem("agent-native:chat-models:selection", selection);
  });

  const { designId, fileId } = await createDesign(page);
  await configureProvider(page, designId, fileId, "observe");
  const { sidebarComposer, sidebarPrompt } = await openSidebarComposer(
    page,
    designId,
    fileId,
  );
  const sourceBase64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 4000;
    canvas.height = 3000;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not create JPEG fixture canvas.");
    context.fillStyle = "#ff0000";
    context.fillRect(0, 0, 2000, 1500);
    context.fillStyle = "#00ff00";
    context.fillRect(2000, 0, 2000, 1500);
    context.fillStyle = "#0000ff";
    context.fillRect(0, 1500, 2000, 1500);
    context.fillStyle = "#ffff00";
    context.fillRect(2000, 1500, 2000, 1500);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) =>
          result ? resolve(result) : reject(new Error("JPEG encoding failed.")),
        "image/jpeg",
        0.98,
      );
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32_768) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
    }
    return btoa(binary);
  });
  const originalBytes = addExifOrientationAndPadJpeg(
    Buffer.from(sourceBase64, "base64"),
    3_000_000,
    6,
  );
  const imageInput = sidebarComposer.locator('input[type="file"][multiple]');
  await sidebarComposer
    .getByRole("button", { name: "Add context", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Upload File", exact: true })
    .click();
  await imageInput.setInputFiles({
    name: "rotated-reference.jpg",
    mimeType: "image/jpeg",
    buffer: originalBytes,
  });
  await expect(
    sidebarComposer.getByRole("button", {
      name: "Remove rotated-reference.jpg",
    }),
  ).toBeVisible();
  await sidebarPrompt.fill(IMAGE_PROMPT);
  await sidebarPrompt.press("Enter");

  await expect
    .poll(async () => (await readProviderProof(page)).imageSha256Seen.length, {
      timeout: 45_000,
      intervals: [250, 500, 1_000],
    })
    .toBe(1);
  const providerPort = test.info().config.metadata
    .sidebarLoopbackPort as number;
  const stateResponse = await page.request.get(
    `http://127.0.0.1:${providerPort}/__state`, // e2e-harness-ignore: read full model input from the separate loopback provider.
  );
  const state = (await stateResponse.json()) as {
    imageDataUrlsSeen: string[];
    imageSha256Seen: string[];
    requestSummaries: Array<{ userMessages: string[] }>;
  };
  expect(state.imageDataUrlsSeen).toHaveLength(1);
  const [imageHeader, imageBase64] = state.imageDataUrlsSeen[0]!.split(",", 2);
  expect(imageHeader).toBe("data:image/png;base64");
  const resizedBytes = Buffer.from(imageBase64!, "base64");
  const resizedSha256 = createHash("sha256").update(resizedBytes).digest("hex");
  expect(state.imageSha256Seen).toEqual([resizedSha256]);
  const transformed = await page.evaluate(async (dataUrl) => {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not inspect resized JPEG output.");
    context.drawImage(bitmap, 0, 0);
    const sample = (x: number, y: number) =>
      Array.from(context.getImageData(x, y, 1, 1).data).slice(0, 3);
    const result = {
      width: bitmap.width,
      height: bitmap.height,
      topLeft: sample(32, 32),
      topRight: sample(bitmap.width - 32, 32),
      bottomLeft: sample(32, bitmap.height - 32),
      bottomRight: sample(bitmap.width - 32, bitmap.height - 32),
    };
    bitmap.close();
    return result;
  }, state.imageDataUrlsSeen[0]!);
  expect(transformed).toMatchObject({ width: 1536, height: 2048 });
  expect(transformed.topLeft[2]).toBeGreaterThan(transformed.topLeft[0] + 40);
  expect(transformed.topLeft[2]).toBeGreaterThan(transformed.topLeft[1] + 40);
  expect(transformed.topRight[0]).toBeGreaterThan(transformed.topRight[1] + 40);
  expect(transformed.bottomLeft[0]).toBeGreaterThan(
    transformed.bottomLeft[2] + 40,
  );
  expect(transformed.bottomLeft[1]).toBeGreaterThan(
    transformed.bottomLeft[2] + 40,
  );
  expect(transformed.bottomRight[1]).toBeGreaterThan(
    transformed.bottomRight[0] + 40,
  );
  expect(transformed.bottomRight[1]).toBeGreaterThan(
    transformed.bottomRight[2] + 40,
  );
  const providerText = state.requestSummaries
    .flatMap((summary) => summary.userMessages)
    .join("\n");
  expect(providerText).not.toContain("<chat-attachment-read-error");
  expect(providerText).not.toContain("<chat-attachment-processing-error");
});

test("Design chat keeps uploaded image bytes out of every SQL table", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_AI_SIDEBAR_LOOPBACK !== "1",
    "requires E2E_AI_SIDEBAR_LOOPBACK=1",
  );
  test.setTimeout(240_000);
  await page.context().addInitScript(() => {
    if (location.origin === "null") return;
    const selection = JSON.stringify({
      model: "agentkit-loopback",
      engine: "ai-sdk:openai",
      effort: "medium",
    });
    localStorage.setItem(
      "agent-native:chat-models:selection:design",
      selection,
    );
    localStorage.setItem("agent-native:chat-models:selection", selection);
  });

  const sqlBefore = await scanSqlForInlineBytes(test.info());
  const marker = `sql-scan-${randomUUID()}`;
  const { designId, fileId } = await createDesign(page);
  await configureProvider(page, designId, fileId, "observe");
  const { sidebarComposer, sidebarPrompt } = await openSidebarComposer(
    page,
    designId,
    fileId,
  );
  const replies = page
    .getByRole("article", { name: "Agent" })
    .getByText("I received the uploaded image reference.", { exact: true });
  const providerImages = async () =>
    (await readProviderProof(page)).imageSha256Seen;
  const providerPoll = { timeout: 45_000, intervals: [250, 500, 1_000] };

  // At most 2 MiB: the PNG travels inline as a data URL.
  const inline = await uploadImage(page, sidebarComposer);
  await sidebarPrompt.fill(`${IMAGE_PROMPT} ${marker} inline`);
  await sidebarPrompt.press("Enter");
  await expect.poll(providerImages, providerPoll).toEqual([inline.sha256]);
  await expect(replies).toHaveCount(1, { timeout: 15_000 });

  // Over 2 MiB: the request names only the owned upload, which the server hydrates.
  const uploaded = await uploadImage(page, sidebarComposer, 2_300_000);
  const rewrittenRequests = await routeImageAsOwnedStorageUrl(
    page,
    "card-art-photo.png",
    { useOriginalReference: true },
  );
  await sidebarPrompt.fill(`${IMAGE_PROMPT} ${marker} uploaded`);
  await sidebarPrompt.press("Enter");
  await expect
    .poll(providerImages, providerPoll)
    .toEqual([inline.sha256, uploaded.sha256]);
  expect(rewrittenRequests()).toBe(1);
  await page.unroute(/\/_agent-native\/agent-chat$/);
  await expect(replies).toHaveCount(2, { timeout: 15_000 });

  // A 6 MB PNG queued behind a running turn is uploaded before it is sent.
  const busyPrompt = `Keep this turn running. ${marker}`;
  await holdProviderResponseTo(page, busyPrompt);
  await sidebarPrompt.fill(busyPrompt);
  await sidebarPrompt.press("Enter");
  await expect(
    sidebarComposer.getByRole("button", { name: "Stop response" }),
  ).toBeVisible();
  await uploadImage(page, sidebarComposer, 6_000_000);
  await sidebarPrompt.fill(`${IMAGE_PROMPT} ${marker} queued`);
  await sidebarPrompt.press("Enter");
  await expect(
    page.getByRole("region", { name: "Queued messages" }),
  ).toBeVisible();
  await expect.poll(() => releaseHeldProviderResponse(page)).toBe(204);
  await expect(replies).toHaveCount(4, { timeout: 45_000 });

  // Absent is not clean: each image turn must be persisted with its stored upload.
  const persistedImageTurnUrls = async () => {
    const [thread] = (await readChatRows(test.info(), marker)).threads;
    const snapshot = JSON.parse(thread?.thread_data ?? "{}") as {
      agentKit?: {
        messages: Array<{
          role: string;
          parts: Array<{ type: string; text?: string; url?: string }>;
        }>;
      };
    };
    return (snapshot.agentKit?.messages ?? [])
      .filter(
        (message) =>
          message.role === "user" &&
          message.parts.some((part) => part.text?.includes(IMAGE_PROMPT)),
      )
      .map((message) =>
        message.parts.flatMap((part) =>
          part.type === "file" ? [part.url] : [],
        ),
      );
  };
  const storedUpload = expect.arrayContaining([
    expect.stringMatching(/^https:\/\/[^/]+\/objects\/[a-f0-9-]{36}$/),
  ]);
  await expect
    .poll(persistedImageTurnUrls, { timeout: 30_000 })
    .toEqual([storedUpload, storedUpload, storedUpload]);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(replies).toHaveCount(4, { timeout: 30_000 });
  await expect
    .poll(persistedImageTurnUrls, { timeout: 30_000 })
    .toEqual([storedUpload, storedUpload, storedUpload]);

  const chat = await readChatRows(test.info(), marker);
  expect(chat.threads).toHaveLength(1);
  const [thread] = chat.threads;
  assertNoInlineImageBytes(thread!.thread_data, "chat_threads.thread_data");
  for (const run of chat.runs) {
    assertNoInlineImageBytes(run, `agent_runs ${String(run.id)}`);
  }
  for (const event of chat.events) {
    assertNoInlineImageBytes(
      event.event_data,
      `agent_run_events ${event.run_id}#${event.seq}`,
    );
  }
  expect(chat.runs.length).toBeGreaterThanOrEqual(4);
  expect(chat.events.length).toBeGreaterThan(0);

  const sqlAfter = await scanSqlForInlineBytes(test.info());
  await writeFile(
    test.info().outputPath("sql-inline-bytes-scan.json"),
    JSON.stringify(
      {
        tableCount: sqlAfter.tables.length,
        columnCount: sqlAfter.columnCount,
        before: sqlBefore.hits,
        after: sqlAfter.hits,
      },
      null,
      2,
    ),
  );
  expect(sqlAfter.tables).toEqual(
    expect.arrayContaining([
      "chat_threads",
      "agent_runs",
      "agent_run_events",
      "application_state",
      "settings",
      "resources",
    ]),
  );
  expect(newInlineBytesHits(sqlBefore, sqlAfter)).toEqual([]);

  // Negative control: planted rows must be flagged, then rolled back.
  const control = await scanSqlWithPoisonedRows(test.info(), thread!.id);
  expect(
    newInlineBytesHits(sqlAfter, control.poisoned)
      .map(({ table, column, row }) => `${table}.${column}#${row}`)
      .sort(),
  ).toEqual(
    [
      ...Object.keys(INLINE_BYTES_CANARIES).map(
        (key) => `application_state.value#${CANARY_SESSION_ID}|${key}`,
      ),
      `chat_threads.thread_data#${thread!.id}`,
    ].sort(),
  );
  expect(newInlineBytesHits(sqlBefore, control.afterRollback)).toEqual([]);
});

test("Design chat sends a queued image to model vision input", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_AI_SIDEBAR_LOOPBACK !== "1",
    "requires E2E_AI_SIDEBAR_LOOPBACK=1",
  );
  await page.context().addInitScript(() => {
    if (location.origin === "null") return;
    const selection = JSON.stringify({
      model: "agentkit-loopback",
      engine: "ai-sdk:openai",
      effort: "medium",
    });
    localStorage.setItem(
      "agent-native:chat-models:selection:design",
      selection,
    );
    localStorage.setItem("agent-native:chat-models:selection", selection);
  });

  const { designId, fileId } = await createDesign(page);
  await configureProvider(page, designId, fileId, "observe");
  const { sidebarComposer, sidebarPrompt } = await openSidebarComposer(
    page,
    designId,
    fileId,
  );
  const busyPrompt = `Keep this turn running. ${randomUUID()}`;
  await holdProviderResponseTo(page, busyPrompt);
  await sidebarPrompt.fill(busyPrompt);
  await sidebarPrompt.press("Enter");
  await expect(
    sidebarComposer.getByRole("button", { name: "Stop response" }),
  ).toBeVisible();
  const image = await uploadImage(page, sidebarComposer);
  await sidebarPrompt.fill(IMAGE_PROMPT);
  await sidebarPrompt.press("Enter");
  await expect(
    page.getByRole("region", { name: "Queued messages" }),
  ).toBeVisible();
  await expect.poll(() => releaseHeldProviderResponse(page)).toBe(204);

  await expect
    .poll(
      async () => {
        const proof = await readProviderProof(page);
        return {
          imageSha256Seen: proof.imageSha256Seen,
          imageUrlsSeen: proof.imageUrlsSeen,
          queuedTurnInput: proof.requestSummaries
            .map((summary) => summary.userMessages.slice(-1)[0] ?? "")
            .filter((text) => text.includes(IMAGE_PROMPT)),
        };
      },
      { timeout: 45_000, intervals: [250, 500, 1_000] },
    )
    .toEqual(expect.objectContaining({ imageSha256Seen: [image.sha256] }));
  const providerText = (await readProviderProof(page)).requestSummaries
    .flatMap((summary) => summary.userMessages)
    .join("\n");
  expect(providerText).not.toContain("reference-only-unavailable");
});
