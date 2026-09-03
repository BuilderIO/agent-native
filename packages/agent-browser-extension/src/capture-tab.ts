import {
  parseBrowserContextV1,
  type BrowserContextV1,
} from "@agent-native/core/browser-context";

import { isCaptureResultMessage } from "./capture-messages";

export async function captureTabContext(
  tabId: number,
  timeoutMs = 8_000,
): Promise<BrowserContextV1> {
  const contextPromise = waitForCaptureResult(tabId, timeoutMs);
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["assets/capture-page.js"],
  });
  return parseBrowserContextV1(await contextPromise);
}

function waitForCaptureResult(
  tabId: number,
  timeoutMs: number,
): Promise<BrowserContextV1> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error("Page capture timed out."));
    }, timeoutMs);
    const listener = (value: unknown, sender: chrome.runtime.MessageSender) => {
      if (
        sender.id !== chrome.runtime.id ||
        sender.tab?.id !== tabId ||
        !isCaptureResultMessage(value)
      ) {
        return;
      }
      clearTimeout(timeout);
      chrome.runtime.onMessage.removeListener(listener);
      resolve(value.context);
    };
    chrome.runtime.onMessage.addListener(listener);
  });
}
