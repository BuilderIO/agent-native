import { describe, expect, it } from "vitest";
import {
  dedupeCollabUsersByEmail,
  reconcileRemoteAwarenessStates,
} from "./client.js";

describe("dedupeCollabUsersByEmail", () => {
  it("keeps one presence entry per email", () => {
    const users = dedupeCollabUsersByEmail([
      {
        name: "Katya",
        email: "Katya@example.com",
        color: "#f87171",
      },
      {
        name: "Katya",
        email: "katya@example.com",
        color: "#60a5fa",
      },
      {
        name: "Steve",
        email: "steve@example.com",
        color: "#34d399",
      },
      {
        name: "Katya",
        email: " katya@example.com ",
        color: "#a78bfa",
      },
    ]);

    expect(users).toEqual([
      {
        name: "Katya",
        email: "katya@example.com",
        color: "#f87171",
      },
      {
        name: "Steve",
        email: "steve@example.com",
        color: "#34d399",
      },
    ]);
  });
});

describe("reconcileRemoteAwarenessStates", () => {
  it("removes remote clients missing from the latest server response", () => {
    const states = new Map<number, unknown>([
      [1, { user: { email: "local@example.com" } }],
      [2, { user: { email: "stale@example.com" } }],
      [3, { user: { email: "active@example.com" } }],
    ]);

    const changes = reconcileRemoteAwarenessStates(states, 1, [
      { clientId: 3, state: { user: { email: "active@example.com" } } },
      { clientId: 4, state: { user: { email: "new@example.com" } } },
    ]);

    expect(changes).toEqual({ added: [4], updated: [3], removed: [2] });
    expect(Array.from(states.keys())).toEqual([1, 3, 4]);
  });
});
