import { z } from "zod";

export const runtimeConfig = z.object({
  agentChatStreaming: z.boolean().default(false).meta({
    env: "AGENT_NATIVE_AGENT_CHAT_STREAM_RUNTIME",
    doc: "Run the dedicated Nitro agent-chat response-streaming route used by an AWS Lambda Function URL.",
  }),
});
