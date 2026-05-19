export function isTrustedCanvasBridgeMessage({
  source,
  origin,
  iframeWindow,
  parentOrigin,
}: {
  source: MessageEventSource | null;
  origin: string;
  iframeWindow: Window | null | undefined;
  parentOrigin: string;
}): boolean {
  if (!iframeWindow || source !== iframeWindow) return false;
  return origin === parentOrigin || origin === "null";
}
