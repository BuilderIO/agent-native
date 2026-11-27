import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { measureCpuMs } from "../testing/cpu-time.js";
import {
  prepareDesignConnectManifest,
  startDesignConnectBridge,
} from "./design-connect.js";

const tmpRoots: string[] = [];

function tmpDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-design-cli-import-"));
  tmpRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
    srv.once("error", reject);
  });
}

async function getText(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    http
      .get(
        {
          hostname: parsed.hostname,
          port: Number(parsed.port),
          path: `${parsed.pathname}${parsed.search}`,
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      )
      .on("error", reject);
  });
}

describe("design connect import rewriting", () => {
  it("authenticates literal imports after JavaScript line comment terminators", async () => {
    const root = tmpDir();
    const devPort = await freePort();
    const port = await freePort();
    const source =
      ["\r", "\n", "\r\n", "\u2028", "\u2029"]
        .map(
          (end, index) =>
            `import(// comment${end}'./module.js?case=${index}');`,
        )
        .join("\n") +
      `\nimport/* before */('./module.js?case=before');\nimport(${"/* x */".repeat(16)}computed);\nimport(${"// comment\r\n".repeat(28)}computed);`;
    const devServer = http.createServer((_req, res) => {
      res
        .writeHead(200, { "content-type": "application/javascript" })
        .end(source);
    });
    await new Promise<void>((resolve) =>
      devServer.listen(devPort, "127.0.0.1", resolve),
    );
    const manifest = await prepareDesignConnectManifest({
      root,
      url: `http://127.0.0.1:${devPort}`,
      port,
    });
    const bridge = await startDesignConnectBridge(manifest);
    try {
      let module!: Awaited<ReturnType<typeof getText>>;
      const cpuMs = await measureCpuMs(async () => {
        module = await getText(
          `http://127.0.0.1:${port}/main.js?previewToken=${bridge.previewToken}`,
          { origin: "null", "sec-fetch-dest": "script" },
        );
      });
      expect(cpuMs).toBeLessThan(1000);
      expect(module.status).toBe(200);
      for (let index = 0; index < 5; index++) {
        expect(module.body).toContain(
          `case=${index}&previewToken=${bridge.previewToken}`,
        );
      }
      expect(module.body).toContain(
        `case=before&previewToken=${bridge.previewToken}`,
      );
      expect(module.body).toContain(`import(${"/* x */".repeat(16)}computed)`);
      expect(module.body).toContain(
        `import(${"// comment\r\n".repeat(28)}computed)`,
      );
    } finally {
      await bridge.close();
      await new Promise<void>((resolve) => devServer.close(() => resolve()));
    }
  });
});
