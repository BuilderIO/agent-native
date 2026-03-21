import {
  defineEventHandler,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";

const MIN_META_DESCRIPTION_LENGTH = 150;
const MAX_META_DESCRIPTION_LENGTH = 160;
const TARGET_META_DESCRIPTION_LENGTH = 155;
const MAX_RETRY_ATTEMPTS = 4;

interface MetaDescriptionRequestBody {
  articleContent?: string;
  projectSlug?: string;
  title?: string;
}

function normalizeDescription(text: string) {
  return text
    .trim()
    .replace(/^['"""'']+|['"""'']+$/g, "")
    .replace(/\s+/g, " ");
}

function getLengthFeedback(description: string) {
  const delta = TARGET_META_DESCRIPTION_LENGTH - description.length;

  if (delta > 0) {
    return `It is currently ${description.length} characters. Add roughly ${delta} characters by changing only 1-3 words while preserving the meaning.`;
  }

  return `It is currently ${description.length} characters. Remove roughly ${Math.abs(delta)} characters by changing only 1-3 words while preserving the meaning.`;
}

async function generateDescription(prompt: string) {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: "gpt-5.4",
    input: prompt,
  });

  return normalizeDescription(response.output_text || "");
}

export const generateMetaDescription = defineEventHandler(
  async (event: H3Event) => {
    try {
      const { articleContent, projectSlug, title } = (await readBody(
        event,
      )) as MetaDescriptionRequestBody;

      if (!projectSlug) {
        setResponseStatus(event, 400);
        return { error: "projectSlug is required" };
      }

      if (!articleContent?.trim()) {
        setResponseStatus(event, 400);
        return { error: "articleContent is required" };
      }

      if (!process.env.OPENAI_API_KEY) {
        setResponseStatus(event, 400);
        return { error: "OpenAI API key not configured" };
      }

      const basePrompt = [
        "You are an SEO editor writing meta descriptions for technical blog posts.",
        `Write exactly one meta description between ${MIN_META_DESCRIPTION_LENGTH} and ${MAX_META_DESCRIPTION_LENGTH} characters inclusive. Aim for ${TARGET_META_DESCRIPTION_LENGTH} characters.`,
        "Return plain text only.",
        "Do not use quotation marks.",
        "Do not add labels, markdown, or explanation.",
        title?.trim() ? `Article title: ${title.trim()}` : null,
        `Full article:\n\n${articleContent.trim()}`,
      ]
        .filter(Boolean)
        .join("\n\n");

      let description = await generateDescription(basePrompt);

      for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt += 1) {
        if (
          description.length >= MIN_META_DESCRIPTION_LENGTH &&
          description.length <= MAX_META_DESCRIPTION_LENGTH
        ) {
          return { description };
        }

        const retryPrompt = [
          "Revise this meta description so it fits the required length.",
          `Target length: ${MIN_META_DESCRIPTION_LENGTH}-${MAX_META_DESCRIPTION_LENGTH} characters inclusive.`,
          `Aim for ${TARGET_META_DESCRIPTION_LENGTH} characters.`,
          "Return plain text only.",
          "Do not use quotation marks.",
          "Keep the meaning aligned with the article.",
          "Keep it to a single sentence.",
          "Do not rewrite from scratch.",
          "Only make the smallest possible edit to the current meta description.",
          getLengthFeedback(description),
          "Before responding, check the final character count and make sure it is within range.",
          title?.trim() ? `Article title: ${title.trim()}` : null,
          `Current meta description:\n\n${description}`,
        ]
          .filter(Boolean)
          .join("\n\n");

        description = await generateDescription(retryPrompt);
      }

      setResponseStatus(event, 500);
      return {
        error: `Failed to generate a meta description between ${MIN_META_DESCRIPTION_LENGTH} and ${MAX_META_DESCRIPTION_LENGTH} characters`,
      };
    } catch (err: any) {
      console.error("Meta description generation error:", err);
      setResponseStatus(event, 500);
      return { error: err.message || "Meta description generation failed" };
    }
  },
);
