import type { Request, Response, NextFunction } from "express";
import type { JsonRpcResponse } from "./types.js";

export function createAuthMiddleware(apiKeyEnv: string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!apiKeyEnv) {
      next();
      return;
    }

    const expectedKey = process.env[apiKeyEnv];
    if (!expectedKey) {
      // No key configured — skip auth (dev mode)
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      const error: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32001, message: "Authentication required" },
      };
      res.status(401).json(error);
      return;
    }

    const token = authHeader.slice(7);
    if (token !== expectedKey) {
      const error: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32001, message: "Invalid API key" },
      };
      res.status(401).json(error);
      return;
    }

    next();
  };
}
