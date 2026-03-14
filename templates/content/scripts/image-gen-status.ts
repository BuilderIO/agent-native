import { loadEnv } from "./_utils.js";

export default async function main(_args: string[]) {
  loadEnv();

  console.log("Image generation provider status:");
  console.log(`  OpenAI:        ${process.env.OPENAI_API_KEY ? "configured" : "not configured"}`);
  console.log(`  Gemini:        ${process.env.GEMINI_API_KEY ? "configured" : "not configured"}`);
  console.log(`  Flux (fal.ai): ${process.env.FAL_KEY ? "configured" : "not configured"}`);
}
