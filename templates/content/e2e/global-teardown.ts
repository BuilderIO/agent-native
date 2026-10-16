import { chromium, type FullConfig } from "@playwright/test";

import { AgentClient } from "./helpers";

async function globalTeardown(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL)
    throw new Error(
      "The Playwright config sets no baseURL, so teardown cannot revoke the shared MCP connector.",
    );
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
