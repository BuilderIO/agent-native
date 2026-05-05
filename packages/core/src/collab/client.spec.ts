import { describe, expect, it } from "vitest";
import { dedupeCollabUsersByEmail } from "./client.js";

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
