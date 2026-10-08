type ActivePageMessage = {
  type: "active-page";
  requestId: string;
  page: { id: string; name: string; pageChangeCount: number };
};

const FIGMA_ORACLE_PLUGIN_ID = "__FIGMA_ORACLE_PLUGIN_ID__";
const bridge = document.getElementById("agent-native-oracle-page-bridge");
const statusLabel = document.getElementById("status");

window.addEventListener("message", (event: MessageEvent) => {
  const message = (event.data as { pluginMessage?: unknown } | null)
    ?.pluginMessage;
  if (!message || typeof message !== "object") return;
  const pageMessage = message as Partial<ActivePageMessage>;
  if (
    pageMessage.type !== "active-page" ||
    typeof pageMessage.requestId !== "string" ||
    !pageMessage.page ||
    typeof pageMessage.page.id !== "string" ||
    typeof pageMessage.page.name !== "string" ||
    !Number.isSafeInteger(pageMessage.page.pageChangeCount) ||
    !bridge
  ) {
    return;
  }
  bridge.dataset.requestId = pageMessage.requestId;
  bridge.dataset.pageId = pageMessage.page.id;
  bridge.dataset.pageName = pageMessage.page.name;
  bridge.dataset.pageChangeCount = String(pageMessage.page.pageChangeCount);
  if (statusLabel) {
    statusLabel.textContent = `Active Figma page: ${pageMessage.page.name}`;
  }
});

window.parent.postMessage(
  {
    pluginMessage: { type: "get-active-page", requestId: "__bridge-ready__" },
    pluginId: FIGMA_ORACLE_PLUGIN_ID,
  },
  "https://www.figma.com",
);
