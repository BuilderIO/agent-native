import { Router } from "express";
import { AIAnalysisResponse, DualAIAnalysisResponse } from "../../shared/api";
import Anthropic from "@anthropic-ai/sdk";

const router = Router();

// Lazy initialization of Anthropic client for serverless environments
let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return client;
}

async function analyzeWithModel(
  model: string,
  description: string,
  imageBase64?: string,
  imageMediaType?: string
): Promise<AIAnalysisResponse> {
  const basePrompt = `Analyze this meal and provide detailed nutritional estimates.

Think through the specifics step by step:
1. Identify each component/ingredient in the meal
2. Estimate the portion size of each component
3. Calculate the approximate calories for each component
4. Calculate the macros (protein, carbs, fat) for each component
5. Add everything up to get the total

Return ONLY valid JSON (no markdown, no code blocks) with this exact structure:
{
  "name": "meal name",
  "calories": number,
  "protein": number,
  "carbs": number,
  "fat": number,
  "confidence": number between 0 and 1,
  "reasoning": "your step-by-step breakdown of the meal components and calculations"
}`;

  const content: Anthropic.MessageParam["content"] = [];
  
  if (imageBase64) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: (imageMediaType || "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        data: imageBase64,
      },
    });
  }
  
  let prompt = basePrompt;
  if (description) {
    prompt += `\n\nUser's description: "${description}"`;
  }
  if (!imageBase64) {
    prompt += `\n\nNote: No image provided, estimate based on the description only.`;
  }
  
  content.push({ type: "text", text: prompt });

  const message = await getClient().messages.create({
    model: model,
    max_tokens: 16000,
    thinking: {
      type: "enabled",
      budget_tokens: 10000,
    },
    messages: [{ role: "user", content }],
  });

  // Extract thinking and text content
  let thinking = "";
  let responseText = "";
  
  for (const block of message.content) {
    if (block.type === "thinking") {
      thinking = block.thinking;
    } else if (block.type === "text") {
      responseText = block.text;
    }
  }

  // Parse JSON from response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`No JSON found in response: ${responseText.substring(0, 200)}`);
  }
  
  const parsed = JSON.parse(jsonMatch[0]);
  
  // Include thinking as reasoning if not already present or combine them
  if (thinking) {
    parsed.reasoning = thinking + (parsed.reasoning ? `\n\nSummary: ${parsed.reasoning}` : "");
  }
  
  return parsed as AIAnalysisResponse;
}

router.post("/analyze-meal", async (req, res) => {
  console.log("Received analyze-meal request");

  try {
    const { description, imageBase64, imageMediaType } = req.body;
    console.log("Request data:", {
      hasDescription: !!description,
      hasImage: !!imageBase64,
      imageType: imageMediaType
    });

    if (!imageBase64 && !description) {
      return res
        .status(400)
        .json({ error: "Either an image or description is required" });
    }

    // Check if API key is configured
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({
        error: "Server configuration error",
        details: "ANTHROPIC_API_KEY is not configured on the server. Please set it in environment variables."
      });
    }

    // Run both models in parallel - using Claude 4.5 models
    const [haikuResult, opusResult] = await Promise.allSettled([
      analyzeWithModel(
        "claude-haiku-4-5-20251001",
        description || "",
        imageBase64,
        imageMediaType
      ),
      analyzeWithModel(
        "claude-opus-4-5-20251101",
        description || "",
        imageBase64,
        imageMediaType
      ),
    ]);

    // Check results
    const haikuSuccess = haikuResult.status === "fulfilled";
    const opusSuccess = opusResult.status === "fulfilled";

    if (!haikuSuccess && !opusSuccess) {
      const haikuError = haikuResult.status === "rejected" ? haikuResult.reason : null;
      const opusError = opusResult.status === "rejected" ? opusResult.reason : null;
      
      console.error("Both models failed:");
      console.error("Haiku error:", haikuError);
      console.error("Opus error:", opusError);
      
      return res.status(500).json({ 
        error: "Both AI models failed to analyze the meal",
        details: {
          haiku: haikuError?.message || String(haikuError),
          opus: opusError?.message || String(opusError),
        }
      });
    }

    const response: DualAIAnalysisResponse = {
      haiku: haikuSuccess 
        ? haikuResult.value 
        : { name: "Error", calories: 0, protein: 0, carbs: 0, fat: 0, confidence: 0, reasoning: `Error: ${(haikuResult as PromiseRejectedResult).reason?.message || "Unknown error"}` },
      opus: opusSuccess 
        ? opusResult.value 
        : { name: "Error", calories: 0, protein: 0, carbs: 0, fat: 0, confidence: 0, reasoning: `Error: ${(opusResult as PromiseRejectedResult).reason?.message || "Unknown error"}` },
    };

    res.json(response);
  } catch (error) {
    console.error("Error analyzing meal:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    const errorDetails = {
      message: errorMessage,
      stack: errorStack,
      type: error?.constructor?.name,
      raw: String(error)
    };

    res.status(500).json({
      error: "Failed to analyze meal",
      details: JSON.stringify(errorDetails, null, 2)
    });
  }
});

export default router;
