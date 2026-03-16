// @agent-native/pinpoint — Server-side file storage adapter
// MIT License
//
// Writes to data/pins/{uuid}.json — one file per annotation.
// Atomic writes (temp + rename). Path traversal validation on all IDs.

import {
  readdir,
  readFile,
  writeFile,
  unlink,
  rename,
  mkdir,
} from "fs/promises";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import type { Pin, PinStatus, PinStorage } from "../types/index.js";
import { PinSchema } from "./schemas.js";

const VALID_ID = /^[a-zA-Z0-9_-]+$/;

export class FileStore implements PinStorage {
  private dir: string;

  constructor(dataDir: string = "data/pins") {
    this.dir = resolve(dataDir);
  }

  private validateId(id: string): void {
    if (!VALID_ID.test(id)) {
      throw new Error(`Invalid pin ID: ${id}`);
    }
  }

  private pinPath(id: string): string {
    this.validateId(id);
    const resolved = join(this.dir, `${id}.json`);
    // Ensure resolved path is within the data directory
    if (!resolved.startsWith(this.dir)) {
      throw new Error("Path traversal detected");
    }
    return resolved;
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private async readPin(filePath: string): Promise<Pin | null> {
    try {
      const content = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(content);
      const result = PinSchema.safeParse(parsed);
      return result.success ? (result.data as Pin) : null;
    } catch {
      return null;
    }
  }

  private async atomicWrite(filePath: string, data: string): Promise<void> {
    await this.ensureDir();
    const tempPath = join(tmpdir(), `pinpoint-${randomUUID()}.tmp`);
    await writeFile(tempPath, data, "utf-8");
    await rename(tempPath, filePath);
  }

  async load(pageUrl: string): Promise<Pin[]> {
    return this.list({ pageUrl });
  }

  async save(pin: Pin): Promise<void> {
    const filePath = this.pinPath(pin.id);
    await this.atomicWrite(filePath, JSON.stringify(pin, null, 2));
  }

  async update(id: string, patch: Partial<Pin>): Promise<void> {
    const filePath = this.pinPath(id);
    const existing = await this.readPin(filePath);
    if (!existing) return;
    const updated: Pin = {
      ...existing,
      ...patch,
      id: existing.id,
      updatedAt: new Date().toISOString(),
    };
    await this.atomicWrite(filePath, JSON.stringify(updated, null, 2));
  }

  async delete(id: string): Promise<void> {
    try {
      await unlink(this.pinPath(id));
    } catch {
      // File already deleted or doesn't exist
    }
  }

  async list(filter?: {
    pageUrl?: string;
    status?: PinStatus;
  }): Promise<Pin[]> {
    await this.ensureDir();
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return [];
    }

    const pins: Pin[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const pin = await this.readPin(join(this.dir, file));
      if (!pin) continue;
      if (filter?.pageUrl && pin.pageUrl !== filter.pageUrl) continue;
      if (filter?.status && pin.status.state !== filter.status) continue;
      pins.push(pin);
    }

    return pins.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }

  async clear(pageUrl?: string): Promise<void> {
    await this.ensureDir();
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return;
    }

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = join(this.dir, file);
      if (pageUrl) {
        const pin = await this.readPin(filePath);
        if (pin && pin.pageUrl === pageUrl) {
          await unlink(filePath).catch(() => {});
        }
      } else {
        await unlink(filePath).catch(() => {});
      }
    }
  }
}
