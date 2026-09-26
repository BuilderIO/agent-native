import { defineAction } from "@agent-native/core/action";
import { createBuilderEngine } from "@agent-native/core/agent/engine";
import {
  resolveGeminiApiKey,
  resolveHasBuilderGatewayCredential,
} from "@agent-native/core/server";
import type { GeneratedSlide } from "@shared/api";
import { z } from "zod";

const BUILDER_MODEL = "gpt-5-6-luna";
const GEMINI_MODEL = "gemini-2.0-flash";

export default defineAction({
  // Runs the app's own model. External agents are the model; they draft with
  // create-deck + add-slide, so this stays off MCP/WebMCP.
  mcpTool: false,
  description:
    "Legacy helper for the Generate Slides dialog that drafts a whole new deck outline (multiple slides) from a topic. It returns markdown slide drafts, not the app's rendered slide HTML. Agent chat should create decks with create-deck slides: [] plus add-slide HTML instead of this action. Do NOT use this for a request to generate one or more images/image variations for an existing slide — use generate-image-api for that. The configured Slides model and user Gemini fallback are implementation details, not visual direction.",
  schema: z.object({
    topic: z.string().describe("Presentation topic"),
    slideCount: z.coerce
      .number()
      .optional()
      .describe("Number of slides to generate (default: 8)"),
    style: z
      .string()
      .optional()
      .describe("Presentation style (e.g. minimal, corporate)"),
    includeImages: z.coerce
      .boolean()
      .optional()
      .describe("Whether to include image prompts (default: true)"),
  }),
  run: async (args) => {
    const topic = args.topic;
    // Cap at 10. Single-shot JSON generation reliably truncates
    // beyond that — the resulting JSON fails to parse and the user sees
    // an error. Larger decks should be assembled through the agent chat,
    // which establishes the deck-level visual contract and appends later
    // slides sequentially through `add-slide`.
    const slideCount = Math.min(args.slideCount ?? 8, 10);
    const style = args.style;
    const includeImages = args.includeImages !== false;

    const imageInstruction = includeImages
      ? `For slides where a visual would enhance the message, set the layout to "image" and provide an "imagePrompt" field with a detailed description of what image to generate. The imagePrompt should describe a professional, high-quality image that supports the slide content. Include imagePrompt for roughly 30-40% of slides (not the title slide).`
      : `Do not include imagePrompt fields.`;

    const styleInstruction = style
      ? `The presentation style should be: ${style}.`
      : `Choose a deliberate editorial direction from the topic and keep it consistent across the deck.`;

    const prompt = `Generate a ${slideCount}-slide presentation about: "${topic}"

    ${styleInstruction}

Before drafting slide objects, establish one deck-level visual contract: a single background family, text/surface/accent roles, type pairing, spacing rhythm, and image treatment. Apply that same contract to every slide; vary composition and hierarchy, never alternate dark and light canvases or switch to a new palette or font per slide. Avoid generic AI presentation patterns such as repeated card grids, gradient text, glass panels, fake logos, and filler bullets.

Return a JSON array of slide objects. Each slide has:
- "content": Markdown content for the slide. Use ## for titles, bullet points, **bold**, *italic* as appropriate. For "image" layout slides, include the image description in markdown like ![description](PLACEHOLDER_IMAGE).
- "layout": One of "title", "content", "two-column", "image", "blank". The first slide should always be "title". Use "two-column" for comparison slides (separate columns with ---). Use "image" for visual slides.
- "notes": Brief speaker notes for the slide.
- "background": Optional background value. Use one coherent canvas/background choice for the entire deck; omit it when the default canvas is appropriate.
${includeImages ? '- "imagePrompt": (optional) A detailed prompt to generate an image for this slide. Only for "image" layout slides.' : ""}

Rules:
- First slide must be "title" layout with the main title and subtitle
- Last slide should be a summary or call-to-action
- Content should be concise and presentation-ready (not paragraphs)
- Use bullet points for lists, keep each point brief
- Keep title, section, statement, and call-to-action slides centered with generous, even margins
- Do not use emoji as decorative icons or bullets; use plain text bullets or HTML/CSS shapes instead
- Do not invent factual numbers, metrics, URLs, source attributions, dates, success rates, benchmarks, customer names, or case-study results. Only include concrete factual claims if they are present in the topic/context. If a useful metric is unknown, use qualitative wording, [metric TBD], or clearly label it as a draft assumption.
- ${imageInstruction}

Respond ONLY with valid JSON. No markdown code fences, no explanation. Just the JSON array.`;

    const builderConfigured = await resolveHasBuilderGatewayCredential();
    let text: string | undefined;
    let builderError: Error | null = null;

    if (builderConfigured) {
      try {
        text = await callBuilderGateway(prompt);
      } catch (error) {
        builderError =
          error instanceof Error ? error : new Error(String(error));
      }
    }

    if (!text?.trim()) {
      const apiKey = await resolveGeminiApiKey();
      if (!apiKey) {
        throw (
          builderError ??
          new Error(
            "Slides outline generation needs Builder.io Connect (free tier available) or a Gemini API key (GOOGLE_GENERATIVE_AI_API_KEY).",
          )
        );
      }

      const { GoogleGenAI } = await import("@google/genai");
      const client = new GoogleGenAI({ apiKey });
      const response = await client.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ text: prompt }],
        config: {
          responseMimeType: "application/json",
        },
      });
      text = response.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("No response from Gemini");
    }

    let slides: GeneratedSlide[];
    try {
      const parsed = JSON.parse(text);
      slides = Array.isArray(parsed) ? parsed : parsed.slides || [];
    } catch {
      // Try to extract JSON from the response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        slides = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Failed to parse slide content from AI response");
      }
    }

    // Validate and sanitize slides
    slides = slides.map((slide) => ({
      content: slide.content || "",
      layout: ["title", "content", "two-column", "image", "blank"].includes(
        slide.layout,
      )
        ? slide.layout
        : "content",
      notes: slide.notes || "",
      background: slide.background,
      imagePrompt: includeImages ? slide.imagePrompt : undefined,
    }));

    return { slides };
  },
});

async function callBuilderGateway(prompt: string): Promise<string> {
  const engine = createBuilderEngine();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  let streamedText = "";
  let finalText = "";
  let terminalError: string | undefined;

  try {
    for await (const event of engine.stream({
      model: BUILDER_MODEL,
      systemPrompt:
        "Return only the valid JSON requested by the user. Do not use markdown fences or commentary.",
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      tools: [],
      abortSignal: controller.signal,
      maxOutputTokens: 16_000,
      temperature: 0,
    })) {
      if (event.type === "text-delta") streamedText += event.text;
      if (event.type === "assistant-content") {
        finalText = event.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("")
          .trim();
      }
      if (event.type === "stop" && event.reason === "error") {
        terminalError = event.error ?? "Builder gateway returned an error";
      }
      if (event.type === "stop" && event.reason === "max_tokens") {
        terminalError = "Builder gateway truncated the slide outline";
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  if (terminalError) throw new Error(terminalError);
  const text = (finalText || streamedText).trim();
  if (!text) throw new Error("Builder gateway returned no slide outline");
  return text;
}
