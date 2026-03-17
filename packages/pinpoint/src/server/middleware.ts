// @agent-native/pinpoint — Express middleware for pin CRUD
// MIT License
//
// REST routes: GET (list), GET/:id, POST, PATCH/:id, DELETE/:id
// Path traversal validation on all IDs.

import { Router, type Request, type Response } from "express";
import { FileStore } from "../storage/file-store.js";
import { PinSchema } from "../storage/schemas.js";

const VALID_ID = /^[a-zA-Z0-9_-]+$/;

function validateId(id: string): boolean {
  return VALID_ID.test(id) && id.length > 0 && id.length <= 128;
}

export interface PinRoutesOptions {
  /** Directory for pin data files. Default: data/pins */
  dataDir?: string;
}

/**
 * Create Express router with pin CRUD endpoints.
 *
 * Usage:
 * ```ts
 * import { pagePinRoutes } from '@agent-native/pinpoint/server';
 * app.use('/api/pins', pagePinRoutes());
 * ```
 */
export function pagePinRoutes(options: PinRoutesOptions = {}): Router {
  const router = Router();
  const store = new FileStore(options.dataDir || "data/pins");

  // GET / — List all pins, optionally filtered
  router.get("/", async (req: Request, res: Response) => {
    try {
      const pageUrl = String(req.query.pageUrl || "") || undefined;
      const status = req.query.status
        ? (String(req.query.status) as any)
        : undefined;
      const pins = await store.list({ pageUrl, status });
      res.json(pins);
    } catch (err) {
      res.status(500).json({ error: "Failed to list pins" });
    }
  });

  // GET /:id — Get a single pin
  router.get("/:id", async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      if (!validateId(id)) {
        res.status(400).json({ error: "Invalid pin ID" });
        return;
      }
      const pins = await store.list();
      const pin = pins.find((p) => p.id === id);
      if (!pin) {
        res.status(404).json({ error: "Pin not found" });
        return;
      }
      res.json(pin);
    } catch (err) {
      res.status(500).json({ error: "Failed to get pin" });
    }
  });

  // POST / — Create a new pin
  router.post("/", async (req: Request, res: Response) => {
    try {
      const result = PinSchema.safeParse(req.body);
      if (!result.success) {
        res
          .status(400)
          .json({ error: "Invalid pin data", details: result.error.issues });
        return;
      }
      await store.save(result.data as any);
      res.status(201).json(result.data);
    } catch (err) {
      res.status(500).json({ error: "Failed to create pin" });
    }
  });

  // PATCH /:id — Update a pin
  router.patch("/:id", async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      if (!validateId(id)) {
        res.status(400).json({ error: "Invalid pin ID" });
        return;
      }
      const result = PinSchema.partial().safeParse(req.body);
      if (!result.success) {
        res
          .status(400)
          .json({ error: "Invalid pin data", details: result.error.issues });
        return;
      }
      await store.update(id, result.data);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to update pin" });
    }
  });

  // DELETE /:id — Delete a pin
  router.delete("/:id", async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      if (!validateId(id)) {
        res.status(400).json({ error: "Invalid pin ID" });
        return;
      }
      await store.delete(id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete pin" });
    }
  });

  // DELETE / — Clear pins (optionally by pageUrl)
  router.delete("/", async (req: Request, res: Response) => {
    try {
      const pageUrl = String(req.query.pageUrl || "") || undefined;
      await store.clear(pageUrl);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to clear pins" });
    }
  });

  return router;
}
