import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listLocalComponentFiles,
  registerLocalComponentWorkspace,
  writeLocalComponentFile,
} from "./local-component-workspaces";

const tmpRoots: string[] = [];

function mkdtemp(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(root);
  return root;
}

function writeFile(root: string, filePath: string, content: string) {
  const absolutePath = path.join(root, filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");
}

function symlinkDirectory(target: string, linkPath: string) {
  try {
    fs.symlinkSync(target, linkPath, "dir");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") return false;
    throw error;
  }
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("local component workspaces", () => {
  it("registers, lists, and writes component files inside a workspace", async () => {
    const cwd = mkdtemp("an-content-components-cwd-");
    const workspace = mkdtemp("an-content-components-workspace-");
    writeFile(
      workspace,
      "components/ImpactCounter.tsx",
      "export function ImpactCounter() { return null; }\n",
    );

    const registered = await registerLocalComponentWorkspace({
      cwd,
      workspacePath: workspace,
    });
    const realWorkspace = fs.realpathSync(workspace);

    expect(registered.componentDirs).toEqual([
      path.join(realWorkspace, "components"),
    ]);

    await expect(listLocalComponentFiles({ cwd })).resolves.toMatchObject([
      {
        workspaceId: registered.workspace.id,
        path: "ImpactCounter.tsx",
        absolutePath: path.join(realWorkspace, "components/ImpactCounter.tsx"),
      },
    ]);

    await writeLocalComponentFile({
      cwd,
      workspaceId: registered.workspace.id,
      filePath: "Nested/Callout.tsx",
      content: "export function Callout() { return null; }\n",
    });

    expect(
      fs.readFileSync(
        path.join(workspace, "components/Nested/Callout.tsx"),
        "utf8",
      ),
    ).toContain("Callout");
  });

  it("honors agent-native.json component paths", async () => {
    const cwd = mkdtemp("an-content-components-cwd-");
    const workspace = mkdtemp("an-content-components-workspace-");
    writeFile(
      workspace,
      "agent-native.json",
      JSON.stringify({
        apps: { content: { components: ["mdx-blocks"] } },
      }),
    );
    writeFile(
      workspace,
      "mdx-blocks/Hero.tsx",
      "export function Hero() { return null; }\n",
    );

    const registered = await registerLocalComponentWorkspace({
      cwd,
      workspacePath: workspace,
    });
    const realWorkspace = fs.realpathSync(workspace);

    expect(registered.workspace.componentPaths).toEqual(["mdx-blocks"]);
    await expect(listLocalComponentFiles({ cwd })).resolves.toMatchObject([
      {
        componentRoot: path.join(realWorkspace, "mdx-blocks"),
        path: "Hero.tsx",
      },
    ]);
  });

  it("creates the configured component folder when writing the first file", async () => {
    const cwd = mkdtemp("an-content-components-cwd-");
    const workspace = mkdtemp("an-content-components-workspace-");
    const registered = await registerLocalComponentWorkspace({
      cwd,
      workspacePath: workspace,
    });

    await writeLocalComponentFile({
      cwd,
      workspaceId: registered.workspace.id,
      filePath: "FirstBlock.tsx",
      content: "export function FirstBlock() { return null; }\n",
    });

    expect(
      fs.readFileSync(
        path.join(workspace, "components/FirstBlock.tsx"),
        "utf8",
      ),
    ).toContain("FirstBlock");
  });

  it("rejects writes through symlinked parent directories", async () => {
    const cwd = mkdtemp("an-content-components-cwd-");
    const workspace = mkdtemp("an-content-components-workspace-");
    const outside = mkdtemp("an-content-components-outside-");
    fs.mkdirSync(path.join(workspace, "components"), { recursive: true });
    if (
      !symlinkDirectory(outside, path.join(workspace, "components/Redirected"))
    ) {
      return;
    }
    const registered = await registerLocalComponentWorkspace({
      cwd,
      workspacePath: workspace,
    });

    await expect(
      writeLocalComponentFile({
        cwd,
        workspaceId: registered.workspace.id,
        filePath: "Redirected/Escape.tsx",
        content: "export function Escape() { return null; }\n",
      }),
    ).rejects.toThrow(/symlinks/);
    expect(fs.existsSync(path.join(outside, "Escape.tsx"))).toBe(false);
  });

  it("does not expose symlinked configured component roots", async () => {
    const cwd = mkdtemp("an-content-components-cwd-");
    const workspace = mkdtemp("an-content-components-workspace-");
    const outside = mkdtemp("an-content-components-outside-");
    writeFile(
      workspace,
      "agent-native.json",
      JSON.stringify({
        apps: { content: { components: ["linked-components"] } },
      }),
    );
    writeFile(
      outside,
      "OutsideBlock.tsx",
      "export function OutsideBlock() { return null; }\n",
    );
    if (!symlinkDirectory(outside, path.join(workspace, "linked-components"))) {
      return;
    }
    const registered = await registerLocalComponentWorkspace({
      cwd,
      workspacePath: workspace,
    });

    expect(registered.componentDirs).toEqual([]);
    await expect(listLocalComponentFiles({ cwd })).resolves.toEqual([]);
  });

  it("rejects writes that escape or use non-component extensions", async () => {
    const cwd = mkdtemp("an-content-components-cwd-");
    const workspace = mkdtemp("an-content-components-workspace-");
    writeFile(
      workspace,
      "components/ImpactCounter.tsx",
      "export function ImpactCounter() { return null; }\n",
    );
    const registered = await registerLocalComponentWorkspace({
      cwd,
      workspacePath: workspace,
    });

    await expect(
      writeLocalComponentFile({
        cwd,
        workspaceId: registered.workspace.id,
        filePath: "../Escape.tsx",
        content: "export const x = 1;\n",
      }),
    ).rejects.toThrow(/safe relative path/);

    await expect(
      writeLocalComponentFile({
        cwd,
        workspaceId: registered.workspace.id,
        filePath: "notes.md",
        content: "# nope\n",
      }),
    ).rejects.toThrow(/Component files must be/);
  });
});
