export function isTrustedCanvasBridgeMessage({
  source,
  origin,
  iframeWindow,
  parentOrigin,
  allowedOrigins = [],
}: {
  source: MessageEventSource | null;
  origin: string;
  iframeWindow: Window | null | undefined;
  parentOrigin: string;
  allowedOrigins?: string[];
}): boolean {
  if (!iframeWindow || source !== iframeWindow) return false;
  return (
    origin === parentOrigin ||
    origin === "null" ||
    allowedOrigins.includes(origin)
  );
}
