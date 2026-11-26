const ANTHROPIC_ENGINE = "anthropic";
const TITLE_TIMEOUT_MS = 6_000;

// Prompt text leaves the machine only for the provider the run itself uses;
// every other engine keeps the local fallback title.
export async function generateRunTitle(input: {
  engine: string | undefined;
  prompt: string;
  resolveApiKey: () => string | undefined;
  fetchImpl?: typeof fetch;
}): Promise<string | null> {
  if (input.engine !== ANTHROPIC_ENGINE) return null;
  const apiKey = input.resolveApiKey();
  if (!apiKey) return null;

  const cleanPrompt = input.prompt.replace(/\s+/g, " ").trim().slice(0, 500);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TITLE_TIMEOUT_MS);

  try {
    const res = await (input.fetchImpl ?? fetch)(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 20,
          messages: [
            {
              role: "user",
              content: `Generate a very short title (3-6 words, no quotes, no punctuation at end) for a coding session that starts with this request:\n\n${cleanPrompt}`,
            },
          ],
        }),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      content?: Array<{ type: string; text: string }>;
    };
    const text = data.content?.find((c) => c.type === "text")?.text.trim();
    if (!text) return null;
    const title = text
      .replace(/^["']|["']$/g, "")
      .trim()
      .slice(0, 72);
    return title || null;
    // coercion-ok: a generated title is optional; the caller keeps its fallback
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
