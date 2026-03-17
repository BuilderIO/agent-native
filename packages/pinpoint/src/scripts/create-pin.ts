// @agent-native/pinpoint — Create annotation script
// MIT License

import { parseArgs, fail } from "@agent-native/core/scripts";
import { FileStore } from "../storage/file-store.js";
import { randomUUID } from "crypto";
import type { Pin } from "../types/index.js";

export default async function (args: string[]) {
  const { pageUrl, selector, comment, author } = parseArgs(args) as {
    pageUrl?: string;
    selector?: string;
    comment?: string;
    author?: string;
  };

  if (!pageUrl) fail("--pageUrl is required");
  if (!selector) fail("--selector is required");
  if (!comment) fail("--comment is required");

  const now = new Date().toISOString();
  const pin: Pin = {
    id: randomUUID(),
    pageUrl: pageUrl!,
    createdAt: now,
    updatedAt: now,
    author,
    comment: comment!,
    element: {
      tagName: "unknown",
      classNames: [],
      selector: selector!,
      boundingRect: { x: 0, y: 0, width: 0, height: 0 },
    },
    status: { state: "open", changedAt: now, changedBy: "agent" },
  };

  const store = new FileStore();
  await store.save(pin);
  console.log(`Created annotation ${pin.id} on ${pageUrl} → ${selector}`);
}
