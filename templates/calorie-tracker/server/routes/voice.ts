import { Router } from "express";
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

interface ExistingItem {
  id: number;
  type: "meal" | "exercise" | "weight";
  name: string;
  calories?: number;
  calories_burned?: number;
  weight?: number;
}

interface ParsedCommand {
  items: Array<{
    type: "meal" | "exercise" | "weight";
    action: "add" | "edit" | "delete" | "unknown";
    existingId?: number; // ID of existing item to edit/delete
    data: {
      name: string;
      calories?: number;
      protein?: number;
      carbs?: number;
      fat?: number;
      calories_burned?: number;
      duration_minutes?: number;
      weight?: number;
      notes?: string;
    };
  }>;
}

router.post("/parse-voice-command", async (req, res) => {
  const { command, date, existingItems } = req.body;

  try {
    if (!command) {
      return res.status(400).json({ error: "Command is required" });
    }

    // Format existing items for context
    let existingContext = "";
    if (existingItems && existingItems.length > 0) {
      existingContext = `\n\nEXISTING ITEMS FOR TODAY (can be edited or deleted):
${existingItems
  .map((item: ExistingItem) => {
    if (item.type === "meal") {
      return `- Meal ID ${item.id}: "${item.name}" (${item.calories} cal)`;
    } else if (item.type === "exercise") {
      return `- Exercise ID ${item.id}: "${item.name}" (${item.calories_burned} cal burned)`;
    } else if (item.type === "weight") {
      return `- Weight ID ${item.id}: ${item.weight} lbs`;
    }
    return "";
  })
  .join("\n")}`;
    }

    const prompt = `You are a nutrition, exercise, and weight tracking assistant. Parse the following voice command and extract the relevant information.

Voice command: "${command}"
Current date context: ${date}${existingContext}

IMPORTANT: Voice transcription is often inaccurate with numbers and formatting:
- "breakfast 4:50" usually means "breakfast 450 calories" (transcription error with numbers)
- "lunch 3:00" likely means "lunch 300 calories" (colon instead of numbers)
- "dinner 7:25" probably means "dinner 725 calories" (time format instead of calories)
- When you see time-like patterns (X:XX) in the context of food, interpret as calorie numbers (XXX)
- Remove colons and interpret as the intended number: "4:50" → 450, "3:00" → 300, "12:50" → 1250

The user may:
1. ADD new items (meals, exercises, weight)
2. EDIT existing items (change calories, name, etc.)
3. DELETE existing items

CRITICAL RULES FOR WEIGHT:
- ONLY interpret something as a weight entry if the user EXPLICITLY uses weight-related keywords like "weight", "weigh", "wait" (common transcription of "weight"), "pounds", "lbs", "kilos", "kg", or "scale"
- A bare number alone should NEVER be interpreted as weight - it's likely calories
- "168" alone = NOT weight (could be calories, ignore or ask for clarification)
- "I weigh 168" = weight (explicit weight keyword)
- "weight 168" = weight (explicit weight keyword)
- "wait 170" = weight ("wait" is commonly how "weight" gets transcribed by speech recognition)
- "168 pounds" = weight (explicit unit)
- "logged 168 on the scale" = weight (explicit scale keyword)
- Be VERY conservative about weight updates - users lose important data if you guess wrong!

EDIT Examples:
- "change salad to 700" → edit the meal containing "salad", set calories to 700
- "update breakfast to 500 calories" → edit the meal containing "breakfast", set calories to 500
- "change my weight to 168" → edit the weight entry (explicit "weight" keyword)
- "fix the run to 400 calories" → edit the exercise containing "run", set calories_burned to 400
- "make the chicken 800" → edit the meal containing "chicken", set calories to 800
- "I now weigh 165" → edit the weight entry (explicit "weigh" keyword)

DELETE Examples:
- "delete the salad" → delete the meal containing "salad"
- "remove breakfast" → delete the meal containing "breakfast"

ADD Examples:
- "gum 100 calories and a jog 400 calories" → 2 items: meal (gum) + exercise (jog)
- "I weigh 165 pounds" → 1 item: weight (165 lbs) - note explicit "weigh" keyword
- "weight is 170" → 1 item: weight (170 lbs) - note explicit "weight" keyword
- "wait 170" → 1 item: weight (170 lbs) - "wait" is how speech recognition often transcribes "weight"
- "168" alone → return empty items array (ambiguous, could be anything)

When editing, match the user's description to the closest existing item by name. Include the existingId from the matching item.

Return ONLY valid JSON (no markdown, no explanatory text, no code blocks) with this exact structure:
{
  "items": [
    {
      "type": "meal" or "exercise" or "weight",
      "action": "add" or "edit" or "delete",
      "existingId": number or null (required for edit/delete - use ID from existing items),
      "data": {
        "name": "descriptive name",
        "calories": number or null (for meals),
        "protein": number or null,
        "carbs": number or null,
        "fat": number or null,
        "calories_burned": number or null (for exercises),
        "duration_minutes": number or null,
        "weight": number or null (for weight entries, in pounds),
        "notes": string or null
      }
    }
  ]
}

Be generous in interpretation. When user says "change X to Y", they want to EDIT. Match names fuzzy (e.g., "salad" matches "Caesar Salad").`;

    const message = await getClient().messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const responseText =
      message.content[0].type === "text" ? message.content[0].text : "";

    // Try to parse JSON, handling potential markdown code blocks
    let jsonText = responseText.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText
        .replace(/```json?\n?/g, "")
        .replace(/```/g, "")
        .trim();
    }

    console.log("Claude response:", { command, responseText, jsonText });

    const parsed: ParsedCommand = JSON.parse(jsonText);
    res.json(parsed);
  } catch (error) {
    console.error("Error parsing voice command:", error);

    // Provide detailed error info
    const errorMessage =
      error instanceof Error ? error.message : "Failed to parse voice command";
    console.error("Voice parsing error details:", {
      command,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });

    res.status(500).json({
      type: "unknown",
      action: "unknown",
      data: { name: "" },
      error: `Voice parsing failed: ${errorMessage}`,
    });
  }
});

export default router;
