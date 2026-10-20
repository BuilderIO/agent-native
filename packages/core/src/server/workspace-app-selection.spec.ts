import { describe, expect, it } from "vitest";

import { selectWorkspaceAppCandidates } from "./workspace-app-selection.js";

const candidates = [
  {
    id: "notes",
    name: "Notes",
    description: "Write and organize documents",
    whenToUse: ["drafting meeting notes"],
    source: "workspace" as const,
  },
  {
    id: "calendar",
    name: "Calendar",
    description: "Manage events and schedules",
    source: "org-directory" as const,
  },
  {
    id: "remote-notes",
    name: "Notes",
    description: "Remote note taking",
    source: "remote-agent" as const,
  },
  {
    id: "files",
    name: "Files",
    description: "Browse workspace documents",
    source: "builtin" as const,
  },
];

describe("selectWorkspaceAppCandidates", () => {
  it("ranks exact ID or name mentions first and breaks ties by source priority", () => {
    const result = selectWorkspaceAppCandidates(candidates, "open Notes", 5);

    expect(result.agents.slice(0, 2).map(({ id }) => id)).toEqual([
      "notes",
      "remote-notes",
    ]);
    expect(result.status).toBe("selected");
  });

  it("matches lexical phrases across descriptions and usage guidance", () => {
    const result = selectWorkspaceAppCandidates(
      candidates,
      "drafting meeting notes",
      5,
    );

    expect(result.agents[0]?.id).toBe("notes");
    expect(result.selectedIds).toEqual(result.agents.map(({ id }) => id));
  });

  it("ranks QR above Mail when email is part of the request", () => {
    const result = selectWorkspaceAppCandidates(
      [
        {
          id: "mail",
          name: "Mail",
          description: "Send and receive email",
          aliases: ["email"],
          source: "builtin",
        },
        {
          id: "qr",
          name: "QR Code Generator",
          description: "Scan a QR code from an image",
          aliases: ["QR", "QR code"],
          source: "workspace",
        },
      ],
      "email me a QR code",
      2,
    );

    expect(result.selectedIds[0]).toBe("qr");
    expect(result.explicitIds).toEqual(["qr", "mail"]);
  });

  it("does not rank apps on low-signal request words alone", () => {
    const result = selectWorkspaceAppCandidates(
      [
        {
          id: "code-tool",
          name: "Code Tool",
          description: "A tool for this code workspace.",
          source: "workspace",
        },
      ],
      "a for this code",
      3,
    );

    expect(result.status).toBe("no-match");
    expect(result.matchedIds).toEqual([]);
  });

  it("keeps QR in the first three with realistic noisy workspace matches", () => {
    const directory = [
      {
        id: "qr",
        name: "QR Code Generator",
        description: "Generate scannable QR code images.",
        aliases: ["QR", "QR code"],
        whenToUse: ["Make a QR code for a clip link."],
        source: "org-directory" as const,
      },
      {
        id: "mail",
        name: "Mail",
        description: "Send and receive email messages.",
        aliases: ["email"],
        source: "builtin" as const,
      },
      {
        id: "assets",
        name: "Assets",
        description: "Search and manage files, images, and media.",
        source: "workspace" as const,
      },
      {
        id: "content",
        name: "Content",
        description: "Draft, edit, and publish pages.",
        source: "workspace" as const,
      },
      {
        id: "analytics",
        name: "Analytics",
        description: "Explore reports, charts, and metrics.",
        source: "workspace" as const,
      },
      {
        id: "clips",
        name: "Clips",
        description: "Record and share screen recordings.",
        source: "workspace" as const,
      },
      {
        id: "slides",
        name: "Slides",
        description: "Create and edit slide decks.",
        source: "workspace" as const,
      },
      ...Array.from({ length: 23 }, (_, index) => ({
        id: `workspace-app-${index + 1}`,
        name: `Workspace ${index + 1}`,
        description: `Manage records and code for workspace ${index + 1}.`,
        source: "workspace" as const,
      })),
    ];
    const phrases = [
      "give me a QR code",
      "add a QR code to this slide",
      "Make a QR code for this clip link",
    ];

    for (const request of phrases) {
      const result = selectWorkspaceAppCandidates(directory, request, 3);

      expect(result.selectedIds.slice(0, 3)).toContain("qr");
    }
  });

  it("does not treat an ID substring inside a larger word as an exact mention", () => {
    const result = selectWorkspaceAppCandidates(
      [
        {
          id: "mail",
          name: "Mail",
          description: "Send messages",
          source: "workspace",
        },
        {
          id: "email",
          name: "Email",
          description: "Manage email accounts",
          source: "builtin",
        },
      ],
      "email accounts",
      2,
    );

    expect(result.selectedIds[0]).toBe("email");
  });

  it("applies the limit and reports omitted matching candidates", () => {
    const result = selectWorkspaceAppCandidates(candidates, "documents", 1);

    expect(result.agents).toHaveLength(1);
    expect(result.omittedCount).toBe(3);
  });

  it("returns deterministic name and ID ordering for otherwise tied matches", () => {
    const tied = [
      {
        id: "zeta",
        name: "Tool",
        description: "shared topic",
        source: "builtin" as const,
      },
      {
        id: "alpha",
        name: "Tool",
        description: "shared topic",
        source: "builtin" as const,
      },
    ];

    expect(
      selectWorkspaceAppCandidates(tied, "shared topic", 5).selectedIds,
    ).toEqual(["alpha", "zeta"]);
  });

  it("keeps the useful baseline directory for empty and unmatched requests", () => {
    const empty = selectWorkspaceAppCandidates(candidates, "  ", 2);
    const unmatched = selectWorkspaceAppCandidates(candidates, "weather", 2);

    expect(empty.agents.map(({ id }) => id)).toEqual(["notes", "calendar"]);
    expect(unmatched.agents.map(({ id }) => id)).toEqual(["notes", "calendar"]);
    expect(empty).toMatchObject({ omittedCount: 2, status: "no-match" });
    expect(unmatched).toMatchObject({ omittedCount: 2, status: "no-match" });
  });

  it("selects QR apps from positions 1, 31, and 100 in a large directory", () => {
    const phrases = ["scan QR codes", "QR code scanner", "read QR codes"];
    const positions = [0, 30, 99];

    for (const [index, position] of positions.entries()) {
      const directory = Array.from({ length: 100 }, (_, candidateIndex) => ({
        id: `distractor-${candidateIndex + 1}`,
        name: `Document Tool ${candidateIndex + 1}`,
        description: `Manage documents and records ${candidateIndex + 1}`,
        source: "workspace" as const,
      }));
      directory[position] = {
        id: `qr-reader-${index + 1}`,
        name: "QR Reader",
        description: "Scan and read QR codes from an image",
        source: "workspace" as const,
      };

      const result = selectWorkspaceAppCandidates(
        directory,
        phrases[index]!,
        30,
      );

      expect(result.selectedIds).toContain(`qr-reader-${index + 1}`);
      expect(result.agents).toHaveLength(30);
      expect(result.omittedCount).toBe(70);
      expect(result.status).toBe("selected");
    }
  });
});
