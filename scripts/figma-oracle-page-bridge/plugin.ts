type PageIdentity = { id: string; name: string };
type PageRequest = { type: "get-active-page"; requestId: string };

declare const __html__: string;
declare const figma: {
  currentPage: PageIdentity;
  showUI(
    html: string,
    options: { width: number; height: number; themeColors: boolean },
  ): void;
  on(type: "currentpagechange", callback: () => void): void;
  ui: {
    onmessage: ((message: unknown) => void) | null;
    postMessage(message: unknown): void;
  };
};

let pageChangeCount = 0;

function isPageRequest(value: unknown): value is PageRequest {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "get-active-page" &&
    typeof (value as { requestId?: unknown }).requestId === "string"
  );
}

function publishActivePage(requestId: string): void {
  figma.ui.postMessage({
    type: "active-page",
    requestId,
    page: {
      id: figma.currentPage.id,
      name: figma.currentPage.name,
      pageChangeCount,
    },
  });
}

figma.ui.onmessage = (message: unknown) => {
  if (!isPageRequest(message)) return;
  publishActivePage(message.requestId);
};

figma.on("currentpagechange", () => {
  pageChangeCount += 1;
  publishActivePage("__page-change__");
});
figma.showUI(__html__, { width: 300, height: 64, themeColors: true });
