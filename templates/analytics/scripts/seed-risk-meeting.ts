#!/usr/bin/env tsx
/**
 * Seeds the Risk Review extension + dashboard by calling the framework's
 * auto-mounted action HTTP surface against a running dev/prod server —
 * extensions live in SQL and are only reachable through the `create-extension`
 * / `update-extension` / `update-dashboard` actions, not template code.
 *
 * Usage: pnpm exec tsx scripts/seed-risk-meeting.ts
 * Requires the app server running (ANALYTICS_SEED_BASE_URL defaults to
 * http://localhost:8080).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.ANALYTICS_SEED_BASE_URL || "http://localhost:8080";

interface Manifest {
  id: string;
  name: string;
  description: string;
  icon?: string;
  contentFile: string;
}

async function callAction<T = any>(
  name: string,
  args: Record<string, unknown>,
  method: "GET" | "POST" = "POST",
): Promise<T> {
  const url = new URL(`/_agent-native/actions/${name}`, BASE_URL);
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (method === "GET") {
    for (const [key, value] of Object.entries(args)) {
      if (value != null) url.searchParams.set(key, String(value));
    }
  } else {
    init.body = JSON.stringify(args);
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`${name} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

async function findExistingExtensionId(name: string): Promise<string | null> {
  const result = await callAction<{
    extensions?: Array<{ id: string; name: string }>;
  }>("list-extensions", { search: name }, "GET");
  const match = result.extensions?.find((ext) => ext.name === name);
  return match?.id ?? null;
}

async function main() {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../seeds/risk-meeting/manifest.json"),
      "utf8",
    ),
  ) as Manifest;
  const content = fs.readFileSync(
    path.join(__dirname, "../seeds/risk-meeting", manifest.contentFile),
    "utf8",
  );
  const dashboardConfig = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../seeds/dashboards/risk-meeting.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;

  const existingId = await findExistingExtensionId(manifest.name);
  let extensionId: string;
  if (existingId) {
    await callAction("update-extension", {
      id: existingId,
      content,
      description: manifest.description,
      icon: manifest.icon,
    });
    extensionId = existingId;
    console.log(
      `Updated existing extension "${manifest.name}" (${extensionId})`,
    );
  } else {
    const created = await callAction<{ extension: { id: string } }>(
      "create-extension",
      {
        name: manifest.name,
        description: manifest.description,
        icon: manifest.icon,
        content,
      },
    );
    extensionId = created.extension.id;
    console.log(`Created extension "${manifest.name}" (${extensionId})`);
  }

  const panels = (dashboardConfig.panels as Array<Record<string, unknown>>).map(
    (panel) =>
      panel.chartType === "extension"
        ? { ...panel, config: { ...(panel.config as object), extensionId } }
        : panel,
  );

  await callAction("update-dashboard", {
    dashboardId: "risk-meeting",
    config: { ...dashboardConfig, panels },
  });
  console.log(
    `Seeded dashboard "risk-meeting" at ${BASE_URL}/dashboards/risk-meeting`,
  );
}

function isDirectRun(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(
    entrypoint &&
    import.meta.url === pathToFileURL(path.resolve(entrypoint)).href,
  );
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
