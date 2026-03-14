import { RequestHandler } from "express";
import { requireEnvKey } from "@agent-native/core/server";
import { runQuery } from "../lib/bigquery";

export const handleQuery: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "BIGQUERY_PROJECT_ID", "BigQuery")) return;
  const { query } = req.body;

  if (!query || typeof query !== "string") {
    res.status(400).json({ error: "Missing or invalid query" });
    return;
  }

  try {
    const result = await runQuery(query);
    res.json(result);
  } catch (error: any) {
    const message = error?.message || String(error);
    console.error("BigQuery error:", message);
    res.status(400).json({ error: message });
  }
};
