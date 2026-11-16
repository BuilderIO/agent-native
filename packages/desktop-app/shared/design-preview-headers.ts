const PREVIEW_PARTITION = /^persist:design-preview:[a-f0-9]{64}$/;

/**
 * The preview WebContentsView loads the screen as its own main frame, so only
 * that document is relaxed. Subframes a visited page creates keep their
 * anti-framing headers; relaxing them would let any page in this signed-in
 * partition frame third-party sites for clickjacking.
 */
export function designPreviewResponseHeaders(
  partition: string,
  resourceType: string,
  headers: Record<string, string[]>,
): Record<string, string[]> {
  if (!PREVIEW_PARTITION.test(partition) || resourceType !== "mainFrame")
    return headers;
  return Object.fromEntries(
    Object.entries(headers).flatMap(([key, values]) => {
      const lower = key.toLowerCase();
      if (lower === "x-frame-options") return [];
      if (
        lower !== "content-security-policy" &&
        lower !== "content-security-policy-report-only"
      ) {
        return [[key, values]];
      }
      return [
        [
          key,
          values.map((value) =>
            value
              .split(";")
              .filter(
                (directive) => !/^\s*frame-ancestors(?:\s|$)/i.test(directive),
              )
              .join(";"),
          ),
        ],
      ];
    }),
  );
}

export function designPreviewChromeUserAgent(userAgent: string): string {
  return userAgent.replace(
    /\s(?:Electron|Agent-Native|agent-native|@agent-native\/desktop-app|AgentNativeDesktop(?:SsoCanary|Nightly)?)\/\S+/g,
    "",
  );
}
