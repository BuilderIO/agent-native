/**
 * Check which image generation providers are configured.
 */

import { config } from "dotenv";

export default async function main(_args: string[]) {
  config();

  console.log("Image Generation Status:");
  console.log("========================");
  console.log(
    `Gemini: ${process.env.GEMINI_API_KEY ? "Configured" : "Not configured"}`,
  );
  console.log("");

  if (!process.env.GEMINI_API_KEY) {
    console.log(
      "To configure Gemini, set the GEMINI_API_KEY environment variable.",
    );
  }
}
