import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { enterDirectMode, expandAllLayers, gotoEditor } from "./helpers";

const LOCKED_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Locked template fixture</title></head>
  <body style="margin:0">
    <main class="artboard" data-agent-native-node-id="template-artboard" style="position:relative;width:1080px;height:1080px;overflow:hidden;background:#f3efe6">
      <div class="backdrop" style="position:absolute;inset:0;background:#eee;pointer-events:none" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>
      <div class="brand" style="position:absolute;top:36px;left:42px;z-index:2;display:flex;align-items:center;gap:10px;font-size:13px;font-weight:800" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
        <span class="brand-mark" style="width:24px;height:24px;border-radius:50%;background:#11110f"></span><span>Northstar</span>
      </div>
      <section class="content" data-agent-native-node-id="template-content" style="position:relative;z-index:1;height:100%;display:grid;align-content:end;padding:108px 42px 42px">
        <h1 data-agent-native-node-id="template-headline" style="margin:0;font-size:82px">Make the work feel lighter.</h1>
      </section>
    </main>
  </body>
</html>`;

function baseUrl(): string {
  return e2eBaseURL().replace(/\/$/, "");
}

async function callAction(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    `${baseUrl()}/_agent-native/actions/${name}`,
    { data: input },
  );
  return {
    ok: response.ok(),
    status: response.status(),
    body: await response.text(),
  };
}

async function postAction(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const result = await callAction(request, name, input);
  if (!result.ok) {
    throw new Error(`${name} failed: ${result.status} ${result.body}`);
  }
  return JSON.parse(result.body);
}

async function readContent(request: APIRequestContext, designId: string) {
  const response = await request.get(
    `${baseUrl()}/_agent-native/actions/get-design?id=${designId}`,
  );
  const design = await response.json();
  return (
    design.files?.find(
      (file: { filename?: string }) => file.filename === "index.html",
    )?.content ?? ""
  );
}

function lockedNodeIds(html: string): string[] {
  return Array.from(
    html.matchAll(
      /data-agent-native-node-id="([^"]+)"[^>]*data-agent-native-locked="true"/g,
    ),
    (match) => match[1]!,
  );
}

async function unlockLayer(page: Page, name: RegExp) {
  const row = page.getByRole("treeitem", { name }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.hover();
  const unlock = row.getByRole("button", { name: "Unlock layer" });
  await expect(unlock).toBeVisible();
  await unlock.click();
}

test("a design whose locked layers were unlocked in the UI accepts an agent edit", async ({
  page,
  request,
}) => {
  const created = await postAction(request, "create-design", {
    title: `Unlock locked layer ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");

  try {
    await postAction(request, "create-file", {
      designId,
      filename: "index.html",
      content: LOCKED_HTML,
      fileType: "html",
    });
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);

    await unlockLayer(page, /Logo/);
    await unlockLayer(page, /Background/);

    await expect
      .poll(async () => lockedNodeIds(await readContent(request, designId)), {
        timeout: 20_000,
      })
      .toEqual([]);

    const edit = await callAction(request, "edit-design", {
      designId,
      filename: "index.html",
      edits: [{ search: "Northstar", replace: "Polestar" }],
    });
    expect(
      `${edit.status} ${edit.body}`,
      "agent edit after the user unlocked both layers",
    ).not.toMatch(/locked layer/i);
    expect(edit.ok).toBe(true);

    expect(await readContent(request, designId)).toContain("Polestar");
  } finally {
    await postAction(request, "delete-design", { id: designId }).catch(
      () => {},
    );
  }
});

test("overview mode: unlocking a template-locked layer persists and unblocks the agent", async ({
  page,
  request,
}) => {
  const created = await postAction(request, "create-design", {
    title: `Unlock in overview ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");

  try {
    await postAction(request, "create-file", {
      designId,
      filename: "index.html",
      content: LOCKED_HTML,
      fileType: "html",
    });
    await gotoEditor(page, designId);
    await expect(page.locator("[data-screen-shell]").first()).toBeVisible({
      timeout: 30_000,
    });
    await expandAllLayers(page);

    await unlockLayer(page, /Logo/);
    await unlockLayer(page, /Background/);

    await expect
      .poll(async () => lockedNodeIds(await readContent(request, designId)), {
        timeout: 20_000,
      })
      .toEqual([]);

    const edit = await callAction(request, "edit-design", {
      designId,
      filename: "index.html",
      edits: [{ search: "Northstar", replace: "Polestar" }],
    });
    expect(
      `${edit.status} ${edit.body}`,
      "agent edit after the user unlocked both layers in overview",
    ).not.toMatch(/locked layer/i);
    expect(edit.ok).toBe(true);
  } finally {
    await postAction(request, "delete-design", { id: designId }).catch(
      () => {},
    );
  }
});

test("an agent whole-file write cannot silently re-lock what the user unlocked", async ({
  page,
  request,
}) => {
  const created = await postAction(request, "create-design", {
    title: `Relock loop ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");

  try {
    await postAction(request, "create-file", {
      designId,
      filename: "index.html",
      content: LOCKED_HTML,
      fileType: "html",
    });
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);

    // The agent reads the design BEFORE the user unlocks anything.
    const staleSnapshot = await readContent(request, designId);
    expect(lockedNodeIds(staleSnapshot).sort()).toEqual([
      "template-background",
      "template-logo",
    ]);

    await unlockLayer(page, /Logo/);
    await unlockLayer(page, /Background/);
    await expect
      .poll(async () => lockedNodeIds(await readContent(request, designId)), {
        timeout: 20_000,
      })
      .toEqual([]);

    // The agent now writes a whole file built from that stale snapshot.
    const replace = await callAction(request, "edit-design", {
      designId,
      filename: "index.html",
      mode: "replace-file",
      replacementContent: staleSnapshot.replace(
        "Make the work feel lighter.",
        "Design at the speed of thought.",
      ),
    });

    expect(
      lockedNodeIds(await readContent(request, designId)),
      `stale agent write re-locked the layers (status ${replace.status})`,
    ).toEqual([]);
  } finally {
    await postAction(request, "delete-design", { id: designId }).catch(
      () => {},
    );
  }
});
