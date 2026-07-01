import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { FIXTURE_HTML, seedComponentVariantMetadata } from "./global-setup";
import { designFrame, gotoEditor, selectByText } from "./helpers";

test.describe.configure({ mode: "serial" });

let designId: string;
let fileId: string;
let baseURLForActions: string;

interface DesignFileRecord {
  id: string;
  filename: string;
  content: string;
  updatedAt: string | null;
}

const DEEP_FIXTURE_HTML = FIXTURE_HTML.replace(
  "    <style>",
  '    <link rel="stylesheet" href="theme.css" />\n    <style>',
).replace(
  '      <div style="display:flex;align-items:center;gap:12px">',
  [
    "      <button",
    '        data-agent-native-node-id="e2e-widget-button"',
    '        data-agent-native-layer-name="E2E Widget Button"',
    '        data-agent-native-component="E2EWidget"',
    '        data-agent-native-prop-disabled="false"',
    '        data-agent-native-prop-label="Initial label"',
    '        style="align-self:flex-start;padding:12px 24px;border-radius:10px;border:1px solid #94a3b8;background:#f8fafc;color:#0f172a;font-size:15px"',
    "      >Widget Surface</button>",
    '      <div style="display:flex;align-items:center;gap:12px">',
  ].join("\n"),
);

const SECONDARY_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>E2E Secondary Clean</title>
  </head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a">
    <main style="padding:48px">
      <h1>Clean secondary file</h1>
      <img alt="Decorative mark" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" />
      <label>Email <input type="email" /></label>
      <button class="focus-visible:ring-2 focus-visible:ring-offset-2">Focusable clean control</button>
    </main>
  </body>
</html>`;

async function postAction(
  request: APIRequestContext,
  actionName: string,
  input: Record<string, unknown>,
): Promise<any> {
  const response = await request.post(
    `${baseURLForActions}/_agent-native/actions/${actionName}`,
    {
      data: input,
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!response.ok()) {
    throw new Error(
      `${actionName} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function getAction(
  request: APIRequestContext,
  actionName: string,
  input: Record<string, unknown>,
): Promise<any> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item != null) params.append(`${key}[]`, String(item));
      }
      continue;
    }
    if (value != null) params.append(key, String(value));
  }
  const response = await request.get(
    `${baseURLForActions}/_agent-native/actions/${actionName}?${params}`,
    {
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!response.ok()) {
    throw new Error(
      `${actionName} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function waitForAction(
  page: Page,
  actionName: string,
  trigger: () => Promise<void>,
): Promise<any> {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/_agent-native/actions/${actionName}`) &&
      response.request().method() !== "OPTIONS",
    { timeout: 20_000 },
  );
  await trigger();
  const response = await responsePromise;
  expect(
    response.ok(),
    `${actionName} failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);
  return response.json();
}

async function selectedElementBackgroundImage(page: Page): Promise<string> {
  return designFrame(page)
    .locator('[data-agent-native-node-id="e2e-alpha-button"]')
    .evaluate((el) => window.getComputedStyle(el).backgroundImage);
}

async function fileRecord(
  request: APIRequestContext,
): Promise<DesignFileRecord> {
  const result = await getAction(request, "get-design", { id: designId });
  const file = (result.files ?? []).find((candidate: { id?: string }) => {
    return candidate.id === fileId;
  });
  if (!file) throw new Error(`File not found in get-design result: ${fileId}`);
  return {
    id: file.id,
    filename: file.filename,
    content: file.content ?? "",
    updatedAt: file.updatedAt ?? null,
  };
}

async function fileContent(request: APIRequestContext): Promise<string> {
  return (await fileRecord(request)).content;
}

test.beforeAll(async ({ request }, workerInfo) => {
  baseURLForActions =
    (workerInfo.project.use.baseURL as string | undefined) ??
    "http://127.0.0.1:9333";

  const created = await postAction(request, "create-design", {
    title: "E2E Code-Native Deep Surfaces",
    projectType: "prototype",
  });
  designId = created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) {
    throw new Error(`create-design did not return an id: ${created}`);
  }

  const file = await postAction(request, "create-file", {
    designId,
    filename: "index.html",
    content: DEEP_FIXTURE_HTML,
    fileType: "html",
  });
  fileId = file.id;
  if (!fileId) {
    throw new Error(
      `create-file did not return an id: ${JSON.stringify(file)}`,
    );
  }

  await postAction(request, "create-file", {
    designId,
    filename: "secondary.html",
    content: SECONDARY_HTML,
    fileType: "html",
  });
  await postAction(request, "create-file", {
    designId,
    filename: "theme.css",
    content:
      ".deep-export-sentinel{outline:2px solid #0ea5e9}.deep-export-extra{color:#047857}",
    fileType: "css",
  });
  await postAction(request, "index-components", { designId });
  await seedComponentVariantMetadata(designId);
});

test.afterAll(async ({ request }) => {
  if (!designId) return;
  await postAction(request, "delete-design", { id: designId }).catch(() => {});
});

test.beforeEach(async ({ page }) => {
  await gotoEditor(page, designId);
  await page.getByRole("tab", { name: "Design", exact: true }).click();
});

test("Inspect Code shows the opening tag and copyable selected HTML", async ({
  page,
}) => {
  await selectByText(page, "Alpha Button");
  await page.getByRole("button", { name: "Inspect code", exact: true }).click();

  await expect(page.getByText("Inspect code", { exact: true })).toBeVisible();
  await expect(
    page
      .locator("code")
      .filter({
        hasText: /<button[^>]*data-agent-native-node-id="e2e-alpha-button"/,
      })
      .first(),
  ).toBeVisible();
  await expect(
    page.locator("pre").filter({ hasText: "Alpha Button" }).first(),
  ).toContainText('data-agent-native-layer-name="Alpha Button"');
  await expect(
    page.getByRole("button", { name: "Copy", exact: true }),
  ).toBeEnabled();
});

test("component boolean and text prop controls persist through reload", async ({
  page,
  request,
}) => {
  await selectByText(page, "Widget Surface");
  const componentSection = page.getByTestId("component-section");
  await expect(componentSection).toContainText("E2EWidget");

  await waitForAction(page, "apply-component-prop-edit", async () => {
    await componentSection
      .getByRole("switch", { name: "disabled", exact: true })
      .click();
  });
  await expect
    .poll(() =>
      designFrame(page)
        .locator('[data-agent-native-node-id="e2e-widget-button"]')
        .getAttribute("data-agent-native-prop-disabled"),
    )
    .toBe("true");

  const labelInput = componentSection.locator("input").first();
  await expect(labelInput).toHaveValue("Initial label");
  await labelInput.fill("Updated label");
  const labelResult = await waitForAction(
    page,
    "apply-component-prop-edit",
    async () => {
      await labelInput.press("Enter");
    },
  );
  expect(labelResult.content).toContain(
    'data-agent-native-prop-label="Updated label"',
  );
  expect(labelResult.content).toContain(
    'data-agent-native-prop-disabled="true"',
  );
  await expect
    .poll(() => fileContent(request))
    .toContain('data-agent-native-prop-disabled="true"');
  await expect
    .poll(() => fileContent(request))
    .toContain('data-agent-native-prop-label="Updated label"');
  await expect
    .poll(() =>
      designFrame(page)
        .locator('[data-agent-native-node-id="e2e-widget-button"]')
        .getAttribute("data-agent-native-prop-label"),
    )
    .toBe("Updated label");

  await gotoEditor(page, designId);
  await page.getByRole("tab", { name: "Design", exact: true }).click();
  await selectByText(page, "Widget Surface");
  await expect
    .poll(() =>
      designFrame(page)
        .locator('[data-agent-native-node-id="e2e-widget-button"]')
        .getAttribute("data-agent-native-prop-disabled"),
    )
    .toBe("true");
  await expect
    .poll(() =>
      designFrame(page)
        .locator('[data-agent-native-node-id="e2e-widget-button"]')
        .getAttribute("data-agent-native-prop-label"),
    )
    .toBe("Updated label");
  const reloadedLabelInput = page
    .getByTestId("component-section")
    .locator("input")
    .first();
  await expect(reloadedLabelInput).toHaveValue("Updated label");
});

test("run-design-audit scopes findings to the requested file", async ({
  request,
}) => {
  const noisy = await postAction(request, "run-design-audit", {
    designId,
    fileId,
  });
  expect(
    noisy.findings.map((finding: { message: string }) => finding.message),
  ).toContain("<img> is missing an alt attribute.");

  const clean = await postAction(request, "run-design-audit", {
    designId,
    filename: "secondary.html",
  });
  expect(clean.filename).toBe("secondary.html");
  expect(
    clean.findings.some((finding: { message: string }) =>
      finding.message.includes("missing an alt attribute"),
    ),
  ).toBe(false);
  expect(
    clean.findings.some((finding: { message: string }) =>
      finding.message.includes("missing an accessible label"),
    ),
  ).toBe(false);
});

test("shader preview is transient while apply-shader-fill persists", async ({
  page,
  request,
}) => {
  await selectByText(page, "Alpha Button");
  await expect.poll(() => selectedElementBackgroundImage(page)).toBe("none");

  await page.getByRole("tab", { name: "Extensions", exact: true }).click();
  await page.getByRole("button", { name: /Shader Fills/ }).click();
  await page.getByRole("button", { name: "Browse Shaders" }).click();
  await page.getByRole("button", { name: "Mesh Gradient" }).click();
  await expect
    .poll(() => selectedElementBackgroundImage(page))
    .toMatch(/(?:linear|radial|conic)-gradient/);

  await gotoEditor(page, designId);
  await expect.poll(() => selectedElementBackgroundImage(page)).toBe("none");

  const shaderSourceFile = await fileRecord(request);
  if (!shaderSourceFile.updatedAt) {
    throw new Error(
      "Shader fixture file did not include an updatedAt revision",
    );
  }
  const shaderPendingSentinel = "<!-- shader-current-content-sentinel -->";
  const shaderCurrentContent = shaderSourceFile.content.replace(
    "</body>",
    `${shaderPendingSentinel}\n  </body>`,
  );
  const applied = await postAction(request, "apply-shader-fill", {
    descriptor: { preset: "MeshGradient" },
    target: { nodeId: "e2e-alpha-button" },
    source: {
      kind: "design-file",
      designId,
      fileId,
      revision: shaderSourceFile.updatedAt,
      currentContent: shaderCurrentContent,
    },
  });
  expect(applied.ok).toBe(true);
  expect(applied.persisted).toBe(true);
  expect(typeof applied.updatedAt).toBe("string");
  expect(applied.updatedAt).not.toBe(shaderSourceFile.updatedAt);

  await gotoEditor(page, designId);
  await expect
    .poll(() => selectedElementBackgroundImage(page))
    .toMatch(/(?:linear|radial|conic)-gradient/);
  const saved = await fileContent(request);
  expect(saved.trimStart().startsWith("<!doctype html>")).toBe(true);
  expect(saved).toContain(shaderPendingSentinel);
  expect(saved).toMatch(
    /data-agent-native-node-id="e2e-alpha-button"[\s\S]*background:\s*(?:linear|radial|conic)-gradient/,
  );

  const sameTabSentinel = "<!-- shader-same-tab-second-apply -->";
  const sameTabContent = saved.replace(
    "</body>",
    `${sameTabSentinel}\n  </body>`,
  );
  const secondApplied = await postAction(request, "apply-shader-fill", {
    descriptor: { preset: "MeshGradient", rotation: 0.2 },
    target: { nodeId: "e2e-alpha-button" },
    source: {
      kind: "design-file",
      designId,
      fileId,
      revision: applied.updatedAt,
      currentContent: sameTabContent,
    },
  });
  expect(secondApplied.ok).toBe(true);
  expect(secondApplied.persisted).toBe(true);
  expect(typeof secondApplied.updatedAt).toBe("string");
  expect(secondApplied.updatedAt).not.toBe(applied.updatedAt);
  expect(await fileContent(request)).toContain(sameTabSentinel);

  const staleSourceFile = await fileRecord(request);
  if (!staleSourceFile.updatedAt) {
    throw new Error("Shader fixture file did not include a stale revision");
  }
  const staleTabSentinel = "<!-- shader-stale-tab-sentinel -->";
  const concurrentSaveSentinel = "<!-- shader-concurrent-save-sentinel -->";
  const staleTabContent = staleSourceFile.content.replace(
    "</body>",
    `${staleTabSentinel}\n  </body>`,
  );
  const concurrentContent = staleSourceFile.content.replace(
    "</body>",
    `${concurrentSaveSentinel}\n  </body>`,
  );
  await postAction(request, "update-file", {
    id: fileId,
    content: concurrentContent,
  });
  const conflict = await postAction(request, "apply-shader-fill", {
    descriptor: { preset: "MeshGradient" },
    target: { nodeId: "e2e-alpha-button" },
    source: {
      kind: "design-file",
      designId,
      fileId,
      revision: staleSourceFile.updatedAt,
      currentContent: staleTabContent,
    },
  });
  expect(conflict).toMatchObject({
    ok: false,
    persisted: false,
    conflict: true,
  });
  expect(conflict.error).toContain(
    "changed since this shader fill was previewed",
  );
  const afterConflict = await fileContent(request);
  expect(afterConflict).toContain(concurrentSaveSentinel);
  expect(afterConflict).not.toContain(staleTabSentinel);
});

test("repeated motion writes replace the managed CSS block instead of duplicating", async ({
  page,
  request,
}) => {
  const motionPendingSentinel = "<!-- motion-current-content-sentinel -->";
  const motionCurrentContent = (await fileContent(request)).replace(
    "</body>",
    `${motionPendingSentinel}\n  </body>`,
  );
  const first = await postAction(request, "apply-motion-edit", {
    designId,
    fileId,
    currentContent: motionCurrentContent,
    tracks: [
      {
        targetNodeId: "e2e-alpha-button",
        property: "opacity",
        keyframes: [
          { t: 0, value: "0.2" },
          { t: 1, value: "1" },
        ],
      },
    ],
    durationMs: 300,
    defaultEase: "ease",
  });
  expect(first.persisted).toBe(true);

  const second = await postAction(request, "apply-motion-edit", {
    designId,
    fileId,
    timelineId: first.timelineId,
    currentContent: await fileContent(request),
    tracks: [
      {
        targetNodeId: "e2e-alpha-button",
        property: "transform",
        keyframes: [
          { t: 0, value: "translateY(12px)" },
          { t: 1, value: "translateY(0)" },
        ],
      },
    ],
    durationMs: 640,
    defaultEase: "ease-out",
    includeContent: true,
  });
  expect(second.persisted).toBe(true);
  expect(
    second.patchedContent.match(/<style\s+data-agent-native-motion\b/g),
  ).toHaveLength(1);
  expect(second.patchedContent).toContain("animation-duration: 0.64s");
  expect(second.patchedContent).toContain(
    "an-motion-e2e-alpha-button--transform",
  );
  expect(second.patchedContent).not.toContain(
    "an-motion-e2e-alpha-button--opacity",
  );
  expect(second.patchedContent).toContain(motionPendingSentinel);

  await gotoEditor(page, designId);
  await expect
    .poll(() =>
      designFrame(page).locator("style[data-agent-native-motion]").count(),
    )
    .toBe(1);
  await expect
    .poll(() =>
      designFrame(page)
        .locator("style[data-agent-native-motion]")
        .first()
        .textContent(),
    )
    .toContain("animation-duration: 0.64s");
});

test("export actions include multi-file content across HTML, SVG, ZIP, and PDF payloads", async ({
  request,
}) => {
  const html = await postAction(request, "export-html", { id: designId });
  expect(html.fileCount).toBe(3);
  expect(html.html).toContain("Clean secondary file");
  expect(html.html).toContain("deep-export-sentinel");
  expect(html.filename).toMatch(/E2E-Code-Native-Deep-Surfaces-\d+\.html/);

  const svg = await postAction(request, "export-svg", {
    id: designId,
    width: 800,
    height: 600,
  });
  expect(svg.svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
  expect(svg.svg).toContain('<foreignObject width="800" height="600">');
  expect(svg.svg).toContain("Clean secondary file");

  await postAction(request, "create-file", {
    designId,
    filename: "README.md",
    content: "User-authored README sentinel",
    fileType: "html",
  });
  await postAction(request, "create-file", {
    designId,
    filename: "design-data.json",
    content: "User-authored design data sentinel",
    fileType: "asset",
  });

  const zip = await postAction(request, "export-zip", { id: designId });
  expect(zip.fileCount).toBe(5);
  expect(Buffer.from(zip.zipBase64, "base64").subarray(0, 2).toString()).toBe(
    "PK",
  );
  const JSZip = (await import("jszip")).default;
  const archive = await JSZip.loadAsync(Buffer.from(zip.zipBase64, "base64"));
  expect(archive.file("index.html")).toBeTruthy();
  expect(archive.file("secondary.html")).toBeTruthy();
  expect(archive.file("theme.css")).toBeTruthy();
  expect(archive.file("README.md")).toBeTruthy();
  expect(archive.file("design-data.json")).toBeTruthy();
  expect(archive.file("agent-native-metadata/README.md")).toBeTruthy();
  expect(archive.file("html/index.html")).toBeNull();
  expect(await archive.file("index.html")?.async("string")).toContain(
    "theme.css",
  );
  expect(await archive.file("README.md")?.async("string")).toContain(
    "User-authored README sentinel",
  );
  expect(await archive.file("design-data.json")?.async("string")).toContain(
    "User-authored design data sentinel",
  );
  expect(
    await archive.file("agent-native-metadata/README.md")?.async("string"),
  ).toContain("E2E Code-Native Deep Surfaces");

  const pdf = await getAction(request, "export-pdf", { id: designId });
  expect(pdf.exportInfo.format).toBe("pdf");
  expect(pdf.files.map((file: { filename: string }) => file.filename)).toEqual(
    expect.arrayContaining(["index.html", "secondary.html", "theme.css"]),
  );
});
