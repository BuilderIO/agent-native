import { chromium } from "@playwright/test";

import { AgentClient } from "./helpers";

async function globalTeardown() {
  const baseURL = process.env.CONTENT_BASE_URL || "http://127.0.0.1:8090";
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL,
      storageState: ".auth/state.json",
    });
    await AgentClient.revokeShared(await context.newPage());
  } finally {
    await browser.close();
  }
}

export default globalTeardown;
