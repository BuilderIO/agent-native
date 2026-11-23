import { chromium } from "@playwright/test";

import { startOwnedQaCdpProxy } from "./qa-cdp-proxy.js";

export { qaBrowserEndpoint } from "./qa-cdp-proxy.js";

export async function openQaBrowser() {
  return connectToQaBrowser();
}

export async function connectToQaBrowser() {
  const proxy = await startOwnedQaCdpProxy();
  try {
    const browser = await chromium.connectOverCDP(proxy.endpoint);
    const closeBrowser = browser.close.bind(browser);
    let closing: Promise<void> | undefined;
    const closeProxy = () => (closing ??= proxy.close());
    browser.on("disconnected", () => void closeProxy());
    browser.close = async (options) => {
      try {
        await closeBrowser(options);
      } finally {
        await closeProxy();
      }
    };
    return browser;
  } catch (error) {
    await proxy.close();
    throw error;
  }
}
