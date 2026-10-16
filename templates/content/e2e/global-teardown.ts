import { chromium, type FullConfig } from "@playwright/test";

import { AUTH_FILES } from "./auth-files";
import { AgentClient } from "./helpers";
import { leaveGateArm } from "./live-body-gate";

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
      storageState: AUTH_FILES.state,
    });
    const page = await context.newPage();
    try {
      await leaveGateArm(page);
    } finally {
      await AgentClient.revokeShared(page);
    }
  } finally {
    await browser.close();
  }
}

export default globalTeardown;
