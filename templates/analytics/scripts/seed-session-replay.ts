#!/usr/bin/env tsx

import path from "node:path";
import { pathToFileURL } from "node:url";

import { setPrivateBlobPublicUploadFallbackEnabled } from "@agent-native/core/private-blob";

import { createAnalyticsPublicKey } from "../server/lib/first-party-analytics";
import {
  parseSessionReplayIngestPayload,
  recordSessionReplayChunks,
} from "../server/lib/session-replay";
import migrations from "../server/plugins/db";

type ReplaySeed = {
  app: string;
  path: string;
  title: string;
  body: string;
  action: string;
};

const ownerEmail =
  process.env.AGENT_NATIVE_SEED_OWNER_EMAIL || process.env.AGENT_USER_EMAIL;
const orgId =
  process.env.AGENT_NATIVE_SEED_ORG_ID || process.env.AGENT_ORG_ID || null;

function nowPlus(base: number, offsetMs: number): string {
  return new Date(base + offsetMs).toISOString();
}

function textNode(id: number, textContent: string) {
  return { type: 3, id, textContent, isStyle: false };
}

function elementNode(
  id: number,
  tagName: string,
  attributes: Record<string, string>,
  childNodes: unknown[],
) {
  return { type: 2, id, tagName, attributes, childNodes };
}

function createReplayEvents(seed: ReplaySeed, base: number) {
  const href = `http://localhost:8080${seed.path}`;
  const buttonId = 12;
  return [
    {
      type: 4,
      timestamp: base,
      data: { href, width: 1280, height: 800 },
    },
    {
      type: 2,
      timestamp: base + 25,
      data: {
        initialOffset: { left: 0, top: 0 },
        node: {
          type: 0,
          id: 1,
          childNodes: [
            { type: 1, id: 2, name: "html", publicId: "", systemId: "" },
            elementNode(3, "html", {}, [
              elementNode(4, "head", {}, [
                elementNode(5, "title", {}, [textNode(6, seed.title)]),
                elementNode(7, "style", {}, [
                  textNode(
                    8,
                    "body{margin:0;font:16px system-ui;background:#f8fafc;color:#0f172a}.wrap{padding:56px;max-width:760px}.card{border:1px solid #cbd5e1;border-radius:8px;background:white;padding:28px;box-shadow:0 8px 30px #0f172a14}.muted{color:#64748b}.btn{display:inline-block;margin-top:20px;border-radius:6px;background:#111827;color:white;padding:10px 14px}",
                  ),
                ]),
              ]),
              elementNode(9, "body", {}, [
                elementNode(10, "main", { class: "wrap" }, [
                  elementNode(11, "section", { class: "card" }, [
                    elementNode(13, "h1", {}, [textNode(14, seed.title)]),
                    elementNode(15, "p", { class: "muted" }, [
                      textNode(16, seed.body),
                    ]),
                    elementNode(12, "button", { class: "btn" }, [
                      textNode(17, seed.action),
                    ]),
                  ]),
                ]),
              ]),
            ]),
          ],
        },
      },
    },
    {
      type: 3,
      timestamp: base + 1200,
      data: { source: 2, type: 2, id: buttonId, x: 182, y: 202 },
    },
    {
      type: 3,
      timestamp: base + 3200,
      data: { source: 3, id: 10, x: 0, y: 320 },
    },
  ];
}

async function main() {
  if (!ownerEmail) {
    throw new Error(
      "Set AGENT_NATIVE_SEED_OWNER_EMAIL to the local user that should own seeded replay rows.",
    );
  }
  if (process.env.ANALYTICS_SESSION_REPLAY_SEED_BLOBS !== "1") {
    setPrivateBlobPublicUploadFallbackEnabled(false);
  }
  const scope = { userEmail: ownerEmail, orgId };
  await migrations({});
  const key = await createAnalyticsPublicKey(
    scope,
    "Local session replay seed",
  );
  const publicKey = String(key.publicKey);
  const base = Date.now() - 5 * 60 * 1000;
  const seeds: ReplaySeed[] = [
    {
      app: "analytics",
      path: "/ask",
      title: "Ask Analytics",
      body: "A local seeded session replay that opens the Analytics ask surface.",
      action: "Ask about signups",
    },
    {
      app: "clips",
      path: "/record",
      title: "Record a Clip",
      body: "A local seeded session replay representing another Agent Native app.",
      action: "Start recording",
    },
  ];

  const recordings = [];
  for (const [index, seed] of seeds.entries()) {
    const started = base + index * 90_000;
    const events = createReplayEvents(seed, started);
    const payload = {
      publicKey,
      replayId: `seed-${seed.app}-${started}`,
      sessionId: `seed-session-${seed.app}-${started}`,
      userId: `seed-user-${index + 1}@example.com`,
      anonymousId: `seed-anon-${index + 1}`,
      url: `http://localhost:8080${seed.path}`,
      app: seed.app,
      template: seed.app,
      status: "completed",
      startedAt: nowPlus(started, 0),
      endedAt: nowPlus(started, 4_000),
      durationMs: 4_000,
      privacyMode: "mask-inputs-and-selected-text",
      metadata: { seeded: true, source: "scripts/seed-session-replay.ts" },
      chunks: [
        {
          seq: 0,
          startedAt: nowPlus(started, 0),
          endedAt: nowPlus(started, 4_000),
          events,
        },
      ],
    };
    const result = await recordSessionReplayChunks(
      parseSessionReplayIngestPayload(payload),
      {
        origin: "http://localhost:8080",
        requestBytes: JSON.stringify(payload).length,
      },
    );
    recordings.push(result);
  }

  console.log("Seeded session replay public key:", publicKey);
  console.log("Seeded session replay owner:", ownerEmail);
  for (const recording of recordings) {
    console.log(
      `- http://localhost:8080/sessions/${recording.recordingId} (${recording.sessionId})`,
    );
  }
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
