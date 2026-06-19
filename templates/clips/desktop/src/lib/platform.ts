export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
}

export function isWindowsPlatform(): boolean {
  return (
    typeof navigator !== "undefined" &&
    (/Win/i.test(navigator.platform) ||
      /Win/i.test(
        (navigator as { userAgentData?: { platform?: string } }).userAgentData
          ?.platform ?? "",
      ))
  );
}
