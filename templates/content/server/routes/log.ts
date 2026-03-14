import { Request, Response } from "express";
export function logMessage(req: Request, res: Response) {
  console.log("CLIENT LOG:", req.body);
  res.json({ success: true });
}
