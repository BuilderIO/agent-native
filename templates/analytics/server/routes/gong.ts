import { type RequestHandler } from "express";
import { requireEnvKey } from "@agent-native/core/server";
import { getCalls, searchCalls, getUsers } from "../lib/gong";

export const handleGongCalls: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "GONG_API_KEY", "Gong")) return;
  try {
    const company = req.query.company as string | undefined;
    if (company) {
      const days = req.query.days ? parseInt(req.query.days as string) : 90;
      const calls = await searchCalls(company, days);
      res.json({ calls, total: calls.length });
    } else {
      const days = req.query.days ? parseInt(req.query.days as string) : 30;
      const fromDateTime = new Date(
        Date.now() - days * 24 * 60 * 60 * 1000,
      ).toISOString();
      const result = await getCalls({ fromDateTime });
      res.json({ calls: result.calls, total: result.calls.length });
    }
  } catch (err: any) {
    console.error("Gong calls error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

export const handleGongUsers: RequestHandler = async (_req, res) => {
  if (requireEnvKey(res, "GONG_API_KEY", "Gong")) return;
  try {
    const users = await getUsers();
    res.json({ users, total: users.length });
  } catch (err: any) {
    console.error("Gong users error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
