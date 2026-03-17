// @agent-native/pinpoint — List annotation sessions by page URL
// MIT License

import { FileStore } from "../storage/file-store.js";

export default async function (_args: string[]) {
  const store = new FileStore();
  const pins = await store.list();

  // Group by page URL
  const sessions = new Map<string, { count: number; latest: string }>();
  for (const pin of pins) {
    const existing = sessions.get(pin.pageUrl);
    if (!existing || pin.updatedAt > existing.latest) {
      sessions.set(pin.pageUrl, {
        count: (existing?.count ?? 0) + 1,
        latest: pin.updatedAt,
      });
    } else {
      existing.count++;
    }
  }

  if (sessions.size === 0) {
    console.log("No annotation sessions found.");
    return;
  }

  console.log(`${sessions.size} page(s) with annotations:\n`);
  for (const [url, info] of sessions) {
    console.log(`  ${url} — ${info.count} pin(s), last updated ${info.latest}`);
  }
}
