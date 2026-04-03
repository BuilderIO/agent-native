/**
 * Call a peer agent by posting to its /api/agent-chat endpoint and
 * collecting the SSE text response. This works with every template
 * out of the box — no A2A setup required.
 */
export async function callPeerAgent(
  baseUrl: string,
  message: string,
  opts?: { timeout?: number },
): Promise<string> {
  const timeout = opts?.timeout ?? 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${baseUrl}/api/agent-chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Agent responded with ${res.status}: ${text}`);
    }

    // The response is an SSE stream. Collect all "text" events.
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    const textParts: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const json = line.slice(6).trim();
        if (!json) continue;

        try {
          const event = JSON.parse(json);
          if (event.type === "text" && event.text) {
            textParts.push(event.text);
          }
          if (event.type === "done" || event.type === "error") {
            // Agent is finished
            reader.cancel().catch(() => {});
            return textParts.join("");
          }
        } catch {
          // Skip unparseable lines
        }
      }
    }

    return textParts.join("");
  } finally {
    clearTimeout(timer);
  }
}
