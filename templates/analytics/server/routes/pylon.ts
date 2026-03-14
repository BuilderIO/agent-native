import { type RequestHandler } from "express";
import { requireEnvKey } from "@agent-native/core/server";
import { getAccounts, getIssues } from "../lib/pylon";

export const handlePylonIssues: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "PYLON_API_KEY", "Pylon")) return;
  try {
    const issues = await getIssues({
      account_id: req.query.account_id as string | undefined,
      state: req.query.state as string | undefined,
      query: req.query.query as string | undefined,
    });
    res.json({ issues, total: issues.length });
  } catch (err: any) {
    console.error("Pylon issues error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

export const handlePylonAccounts: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "PYLON_API_KEY", "Pylon")) return;
  try {
    const accounts = await getAccounts(req.query.query as string | undefined);
    res.json({ accounts, total: accounts.length });
  } catch (err: any) {
    console.error("Pylon accounts error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
