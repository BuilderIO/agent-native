import type { Express } from "express";
import type { A2AConfig } from "./types.js";
import { generateAgentCard } from "./agent-card.js";
import { createAuthMiddleware } from "./middleware.js";
import { handleJsonRpc } from "./handlers.js";

export function enableA2A(app: Express, config: A2AConfig): void {
  const auth = createAuthMiddleware(config.apiKeyEnv);

  // Public agent card endpoint (no auth)
  app.get("/.well-known/agent-card.json", (req, res) => {
    const protocol = req.protocol;
    const host = req.get("host") ?? "localhost";
    const baseUrl = `${protocol}://${host}`;
    res.json(generateAgentCard(config, baseUrl));
  });

  // JSON-RPC endpoint (with auth)
  app.post("/a2a", auth, (req, res) => {
    handleJsonRpc(req, res, config);
  });
}
