import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClientForkStatus } from "../../shared/client-forks.js";
import {
  clientForkLocalPath,
  createClientForkHandler,
} from "./client-fork-protocol.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((item) => fs.rm(item, { recursive: true, force: true })),
  );
});

describe("client fork interception", () => {
  it("keeps APIs, auth, data requests, foreign origins and POSTs on the server", () => {
    for (const pathname of [
      "/_agent-native/actions/write",
      "/oauth/callback",
      "/sign-in",
      "/inbox.data",
      "/__manifest",
    ]) {
      expect(
        clientForkLocalPath(
          new Request(`https://app.example${pathname}`, {
            headers: { "sec-fetch-dest": "document" },
          }),
          "https://app.example",
        ),
      ).toBeNull();
    }
    expect(
      clientForkLocalPath(
        new Request("https://other.example/assets/a.js"),
        "https://app.example",
      ),
    ).toBeNull();
    expect(
      clientForkLocalPath(
        new Request("https://app.example/inbox", {
          method: "POST",
          body: "data",
        }),
        "https://app.example",
      ),
    ).toBeNull();
  });
  it("handles mounted assets and document deep links", () => {
    expect(
      clientForkLocalPath(
        new Request("https://app.example/mail/assets/a.js"),
        "https://app.example/mail",
      ),
    ).toBe("assets/a.js");
    expect(
      clientForkLocalPath(
        new Request("https://app.example/mail/inbox/thread", {
          headers: { "sec-fetch-dest": "document" },
        }),
        "https://app.example/mail",
      ),
    ).toBe("index.html");
    expect(
      clientForkLocalPath(
        new Request("https://app.example/calendar/assets/a.js"),
        "https://app.example/mail",
      ),
    ).toBeNull();
  });
  it("serves an actual build and rejects symlinks escaping its root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "client-fork-"));
    directories.push(root);
    await fs.mkdir(path.join(root, "assets"));
    await fs.writeFile(path.join(root, "index.html"), "custom client");
    await fs.writeFile(path.join(root, "outside.txt"), "outside");
    const build = path.join(root, "build");
    await fs.mkdir(path.join(build, "assets"), { recursive: true });
    await fs.copyFile(
      path.join(root, "index.html"),
      path.join(build, "index.html"),
    );
    await fs.symlink(
      path.join(root, "outside.txt"),
      path.join(build, "assets", "escape.js"),
    );
    const state: ClientForkStatus = {
      appId: "example",
      sourcePath: root,
      baseSha: "a".repeat(40),
      hostedSha: null,
      enabled: true,
      buildPath: build,
      previousBuildPath: null,
      error: null,
      installMs: null,
      buildMs: null,
    };
    const fail = vi.fn();
    const forward = vi.fn(async () => new Response("hosted"));
    const handle = createClientForkHandler({
      origin: "https://app.example",
      status: () => state,
      forward,
      fail,
    });
    const document = await handle(
      new Request("https://app.example/inbox", {
        headers: { "sec-fetch-dest": "document" },
      }),
    );
    expect(await document.text()).toBe("custom client");
    expect(document.headers.get("cache-control")).toBe("no-store");
    expect(
      await (
        await handle(new Request("https://app.example/assets/escape.js"))
      ).text(),
    ).toBe("hosted");
    expect(fail).toHaveBeenCalledOnce();
  });
});
