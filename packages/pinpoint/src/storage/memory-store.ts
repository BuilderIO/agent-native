// @agent-native/pinpoint — In-memory storage adapter
// MIT License
//
// Used for standalone/clipboard-only mode. Pins live in memory for
// the current session. NOT localStorage (violates agent-native Rule 1).
// Pins are lost on page reload — intentional. Connect to a server for persistence.

import type { Pin, PinStatus, PinStorage } from "../types/index.js";

export class MemoryStore implements PinStorage {
  private pins: Map<string, Pin> = new Map();

  async load(pageUrl: string): Promise<Pin[]> {
    return Array.from(this.pins.values()).filter(
      (pin) => pin.pageUrl === pageUrl,
    );
  }

  async save(pin: Pin): Promise<void> {
    this.pins.set(pin.id, { ...pin });
  }

  async update(id: string, patch: Partial<Pin>): Promise<void> {
    const existing = this.pins.get(id);
    if (!existing) return;
    this.pins.set(id, {
      ...existing,
      ...patch,
      id: existing.id, // never overwrite ID
      updatedAt: new Date().toISOString(),
    });
  }

  async delete(id: string): Promise<void> {
    this.pins.delete(id);
  }

  async list(filter?: {
    pageUrl?: string;
    status?: PinStatus;
  }): Promise<Pin[]> {
    let result = Array.from(this.pins.values());
    if (filter?.pageUrl) {
      result = result.filter((pin) => pin.pageUrl === filter.pageUrl);
    }
    if (filter?.status) {
      result = result.filter((pin) => pin.status.state === filter.status);
    }
    return result;
  }

  async clear(pageUrl?: string): Promise<void> {
    if (pageUrl) {
      for (const [id, pin] of this.pins) {
        if (pin.pageUrl === pageUrl) {
          this.pins.delete(id);
        }
      }
    } else {
      this.pins.clear();
    }
  }
}
