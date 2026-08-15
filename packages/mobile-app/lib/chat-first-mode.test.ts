import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
  },
}));

import {
  CHAT_FIRST_MODE_STORAGE_KEY,
  loadChatFirstMode,
} from "./chat-first-mode";

describe("mobile chat-first mode", () => {
  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
  });

  it("defaults new installs to chat-first mode", async () => {
    await expect(loadChatFirstMode()).resolves.toMatchObject({
      ok: true,
      enabled: true,
    });
  });

  it("honors an explicitly saved home-first preference", async () => {
    storage.set(CHAT_FIRST_MODE_STORAGE_KEY, "false");

    await expect(loadChatFirstMode()).resolves.toMatchObject({
      ok: true,
      enabled: false,
    });
  });
});
