// @agent-native/pinpoint — Browser-side REST client storage adapter
// MIT License
//
// The browser never writes files directly — it always goes through the server.
// This is the default adapter when a server endpoint is available.

import type { Pin, PinStatus, PinStorage } from "../types/index.js";
import { PinSchema } from "./schemas.js";

export class RestClient implements PinStorage {
  constructor(private endpoint: string) {
    // Normalize: remove trailing slash
    this.endpoint = endpoint.replace(/\/+$/, "");
  }

  async load(pageUrl: string): Promise<Pin[]> {
    const params = new URLSearchParams({ pageUrl });
    const res = await fetch(`${this.endpoint}?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data)
      ? data.filter((item) => PinSchema.safeParse(item).success)
      : [];
  }

  async save(pin: Pin): Promise<void> {
    await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pin),
    });
  }

  async update(id: string, patch: Partial<Pin>): Promise<void> {
    await fetch(`${this.endpoint}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  async delete(id: string): Promise<void> {
    await fetch(`${this.endpoint}/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  async list(filter?: {
    pageUrl?: string;
    status?: PinStatus;
  }): Promise<Pin[]> {
    const params = new URLSearchParams();
    if (filter?.pageUrl) params.set("pageUrl", filter.pageUrl);
    if (filter?.status) params.set("status", filter.status);
    const res = await fetch(`${this.endpoint}?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data)
      ? data.filter((item) => PinSchema.safeParse(item).success)
      : [];
  }

  async clear(pageUrl?: string): Promise<void> {
    const params = new URLSearchParams();
    if (pageUrl) params.set("pageUrl", pageUrl);
    await fetch(`${this.endpoint}?${params}`, { method: "DELETE" });
  }
}
