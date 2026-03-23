/**
 * Check which image generation providers are configured.
 */

const config = async () => {
  try {
    const m = await import("dotenv");
    m.config();
  } catch {}
};

export default async function main(_args: string[]) {
  await config();

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
