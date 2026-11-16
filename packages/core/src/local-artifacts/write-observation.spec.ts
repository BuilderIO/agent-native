import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  actionExecutionStorage,
  type ActionExecutionFrame,
} from "../action-frame.js";
import {
  deleteLocalArtifactFile,
  deleteLocalWorkspaceResource,
  deleteLocalWorkspaceResourceIfCurrent,
  readLocalArtifactFile,
  readLocalWorkspaceResource,
  writeLocalArtifactFile,
  writeLocalWorkspaceResource,
  writeLocalWorkspaceResourceIfAbsentAtPath,
  writeLocalWorkspaceResourceIfCurrent,
} from "./index.js";

// Local File Mode saves an action's data to repo files, where no database or
// HTTP layer sees it, so each save and delete reports itself before it touches
// the disk, and a save that is refused first reports nothing.
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-local-observed-"));
  roots.push(root);
  const manifestPath = path.join(root, "agent-native.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      mode: "local-files",
      apps: {
        content: { roots: [{ path: "docs", extensions: [".mdx"] }] },
      },
    }),
  );
  return { root, manifestPath };
}

/** The channel that saw a write while `run` ran in a frame, or null. */
async function observed(run: () => Promise<unknown>): Promise<string | null> {
  const frame: ActionExecutionFrame = {
    key: {},
    run: async () => undefined,
    handlerEntered: true,
    writeEntered: false,
    changeEntered: false,
    writeObserved: false,
  };
  if (!actionExecutionStorage) throw new Error("No AsyncLocalStorage.");
  await actionExecutionStorage.run(
    { frame, failures: new WeakMap() },
    async () => {
      await run().catch(() => undefined);
    },
  );
  return frame.writeObserved ? (frame.writeObservedChannel ?? "?") : null;
}

describe("local artifact files", () => {
  it("sees a save and a delete, and not a read or a save that was refused", async () => {
    const { manifestPath } = workspace();
    const options = { appId: "content", manifestPath, path: "docs/a.mdx" };

    expect(await observed(() => readLocalArtifactFile(options))).toBeNull();
    expect(
      await observed(() =>
        writeLocalArtifactFile({
          ...options,
          content: "# A",
          expectedHash: "stale",
        }),
      ),
    ).toBeNull();
    expect(
      await observed(() =>
        writeLocalArtifactFile({ ...options, content: "# A" }),
      ),
    ).toBe("local-file");
    expect(
      await observed(() =>
        writeLocalArtifactFile({
          ...options,
          content: "# B",
          ifNotExists: true,
        }),
      ),
    ).toBeNull();
    expect(await observed(() => deleteLocalArtifactFile(options))).toBe(
      "local-file",
    );
  });
});

describe("local workspace resources", () => {
  const resource = { path: "skills/probe/SKILL.md", content: "# Probe" };

  it("sees a save and a delete, and not a read", async () => {
    const { manifestPath } = workspace();

    expect(
      await observed(() =>
        readLocalWorkspaceResource({ manifestPath, path: resource.path }),
      ),
    ).toBeNull();
    expect(
      await observed(() =>
        writeLocalWorkspaceResource({ manifestPath, ...resource }),
      ),
    ).toBe("local-file");
    expect(
      await observed(() =>
        deleteLocalWorkspaceResource({ manifestPath, path: resource.path }),
      ),
    ).toBe("local-file");
  });

  it("sees a conditional save and delete only when they go ahead", async () => {
    const { manifestPath } = workspace();
    const first = await writeLocalWorkspaceResource({
      manifestPath,
      ...resource,
    });
    const conditions = {
      manifestPath,
      path: resource.path,
      expectedHash: first.hash,
      expectedAbsolutePath: first.absolutePath,
    };

    expect(
      await observed(() =>
        writeLocalWorkspaceResourceIfCurrent({
          ...conditions,
          expectedHash: "stale",
          content: "# New",
        }),
      ),
    ).toBeNull();
    expect(
      await observed(() =>
        writeLocalWorkspaceResourceIfCurrent({
          ...conditions,
          content: "# New",
        }),
      ),
    ).toBe("local-file");
    expect(
      await observed(() =>
        deleteLocalWorkspaceResourceIfCurrent({
          ...conditions,
          expectedHash: first.hash,
        }),
      ),
    ).toBeNull();
    const current = await readLocalWorkspaceResource({
      manifestPath,
      path: resource.path,
    });
    expect(
      await observed(() =>
        deleteLocalWorkspaceResourceIfCurrent({
          ...conditions,
          expectedHash: current!.hash,
        }),
      ),
    ).toBe("local-file");
  });

  it("sees a save that creates a file, and not one that finds it there", async () => {
    const { manifestPath } = workspace();
    const absolutePath = path.join(
      path.dirname(manifestPath),
      ".agents",
      "skills",
      "probe",
      "SKILL.md",
    );
    const options = {
      manifestPath,
      path: resource.path,
      content: "# Probe",
      expectedAbsolutePath: absolutePath,
    };

    expect(
      await observed(() => writeLocalWorkspaceResourceIfAbsentAtPath(options)),
    ).toBe("local-file");
    expect(
      await observed(() => writeLocalWorkspaceResourceIfAbsentAtPath(options)),
    ).toBeNull();
  });
});
