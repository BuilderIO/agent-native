const PROTOCOL_VERSION = "1.3";

export type DebuggerSource = chrome.debugger.Debuggee;

function lastErrorMessage(fallback: string): string {
  return chrome.runtime.lastError?.message || fallback;
}

export function attachDebugger(source: DebuggerSource): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(source, PROTOCOL_VERSION, () => {
      if (chrome.runtime.lastError)
        reject(new Error(lastErrorMessage("Could not attach to tab.")));
      else resolve();
    });
  });
}

export function detachDebugger(source: DebuggerSource): Promise<void> {
  return new Promise((resolve) => {
    chrome.debugger.detach(source, () => resolve());
  });
}

export function sendDebuggerCommand<T>(
  source: DebuggerSource,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(source, method, params, (result) => {
      if (chrome.runtime.lastError)
        reject(new Error(lastErrorMessage(`Chrome rejected ${method}.`)));
      else resolve(result as T);
    });
  });
}

export function getTab(tabId: number): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab)
        reject(new Error(lastErrorMessage("Tab no longer exists.")));
      else resolve(tab);
    });
  });
}
