import OpenAI from "openai";

export async function summarize() {
  const client = new OpenAI();
  return client.chat.completions.create({
    model: "gpt-4.1",
    messages: [{ role: "user", content: "Summarize" }],
  });
}
