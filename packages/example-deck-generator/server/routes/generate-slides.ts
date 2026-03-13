import { RequestHandler } from "express";
import type { SlideGenerateRequest, SlideGenerateResponse, GeneratedSlide } from "@shared/api";

/**
 * POST /api/generate-slides
 * Generate slide deck content using Gemini
 */
export const generateSlides: RequestHandler = async (req, res) => {
  const body = req.body as SlideGenerateRequest;
  const { topic, slideCount = 8, style, includeImages = true } = body;

  if (!topic?.trim()) {
    res.status(400).json({ error: "Topic is required" });
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    res.status(400).json({ error: "Gemini API key not configured. Set GEMINI_API_KEY environment variable." });
    return;
  }

  try {
    const { GoogleGenAI } = await import("@google/genai");
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const imageInstruction = includeImages
      ? `For slides where a visual would enhance the message, set the layout to "image" and provide an "imagePrompt" field with a detailed description of what image to generate. The imagePrompt should describe a professional, high-quality image that supports the slide content. Include imagePrompt for roughly 30-40% of slides (not the title slide).`
      : `Do not include imagePrompt fields.`;

    const styleInstruction = style
      ? `The presentation style should be: ${style}.`
      : `The presentation should be professional, modern, and visually clean.`;

    const prompt = `Generate a ${slideCount}-slide presentation about: "${topic}"

${styleInstruction}

Return a JSON array of slide objects. Each slide has:
- "content": Markdown content for the slide. Use ## for titles, bullet points, **bold**, *italic* as appropriate. For "image" layout slides, include the image description in markdown like ![description](PLACEHOLDER_IMAGE).
- "layout": One of "title", "content", "two-column", "image", "blank". The first slide should always be "title". Use "two-column" for comparison slides (separate columns with ---). Use "image" for visual slides.
- "notes": Brief speaker notes for the slide.
- "background": Either "bg-[#000000]" for dark slides or omit for default.
${includeImages ? '- "imagePrompt": (optional) A detailed prompt to generate an image for this slide. Only for "image" layout slides.' : ""}

Rules:
- First slide must be "title" layout with the main title and subtitle
- Last slide should be a summary or call-to-action
- Content should be concise and presentation-ready (not paragraphs)
- Use bullet points for lists, keep each point brief
- ${imageInstruction}

Respond ONLY with valid JSON. No markdown code fences, no explanation. Just the JSON array.`;

    const response = await client.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ text: prompt }],
      config: {
        responseMimeType: "application/json",
      },
    });

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error("No response from Gemini");
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
      layout: ["title", "content", "two-column", "image", "blank"].includes(slide.layout)
        ? slide.layout
        : "content",
      notes: slide.notes || "",
      background: slide.background,
      imagePrompt: includeImages ? slide.imagePrompt : undefined,
    }));

    const result: SlideGenerateResponse = { slides };
    res.json(result);
  } catch (err: any) {
    console.error("Slide generation error:", err);
    res.status(500).json({ error: err.message || "Slide generation failed" });
  }
};
