import { type RequestHandler } from "express";
import { requireEnvKey } from "@agent-native/core/server";
import { getMemberByEmail, getMembers } from "../lib/commonroom";

export const handleCommonRoomMembers: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "COMMONROOM_API_KEY", "Common Room")) return;
  try {
    const email = req.query.email as string | undefined;
    if (email) {
      const member = await getMemberByEmail(email);
      res.json({ member });
    } else {
      const result = await getMembers({
        query: req.query.query as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 25,
      });
      res.json({ members: result.items, total: result.items?.length ?? 0 });
    }
  } catch (err: any) {
    console.error("Common Room members error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
