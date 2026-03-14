/**
 * POC: Validate diff computation approach for article version history.
 *
 * Tests that the `diff` library (jsdiff) produces usable, human-readable
 * diffs for markdown content at word-level and line-level granularity,
 * and that we can compute meaningful change summaries.
 */
import { describe, it, expect } from "vitest";
import * as Diff from "diff";

// ---------------------------------------------------------------------------
// Helpers that would live in a real version-history module
// ---------------------------------------------------------------------------

interface VersionSnapshot {
  id: string;
  content: string;
  timestamp: number;
  actor: { type: "user" | "agent"; id: string; displayName?: string };
  /** Optional description of what changed */
  summary?: string;
}

interface ChangeSummary {
  wordsAdded: number;
  wordsRemoved: number;
  linesChanged: number;
  /** Sections (H2/H3 headings) that were modified */
  sectionsAffected: string[];
}

function computeChangeSummary(oldContent: string, newContent: string): ChangeSummary {
  const wordDiff = Diff.diffWords(oldContent, newContent);
  let wordsAdded = 0;
  let wordsRemoved = 0;
  for (const part of wordDiff) {
    const wordCount = part.value.trim().split(/\s+/).filter(Boolean).length;
    if (part.added) wordsAdded += wordCount;
    if (part.removed) wordsRemoved += wordCount;
  }

  const lineDiff = Diff.diffLines(oldContent, newContent);
  let linesChanged = 0;
  for (const part of lineDiff) {
    if (part.added || part.removed) {
      linesChanged += part.count ?? 0;
    }
  }

  // Detect which markdown sections were affected
  const sectionsAffected = detectAffectedSections(oldContent, newContent);

  return { wordsAdded, wordsRemoved, linesChanged, sectionsAffected };
}

function detectAffectedSections(oldContent: string, newContent: string): string[] {
  const oldSections = parseMarkdownSections(oldContent);
  const newSections = parseMarkdownSections(newContent);
  const affected = new Set<string>();

  // Compare sections by heading
  const allHeadings = new Set([
    ...oldSections.map((s) => s.heading),
    ...newSections.map((s) => s.heading),
  ]);

  for (const heading of allHeadings) {
    const oldSection = oldSections.find((s) => s.heading === heading);
    const newSection = newSections.find((s) => s.heading === heading);
    if (!oldSection || !newSection) {
      affected.add(heading); // added or removed section
    } else if (oldSection.body !== newSection.body) {
      affected.add(heading); // content changed
    }
  }

  return [...affected];
}

interface MarkdownSection {
  heading: string;
  body: string;
}

function parseMarkdownSections(content: string): MarkdownSection[] {
  const lines = content.split("\n");
  const sections: MarkdownSection[] = [];
  let currentHeading = "(intro)";
  let currentBody: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      if (currentBody.length > 0 || currentHeading !== "(intro)") {
        sections.push({ heading: currentHeading, body: currentBody.join("\n") });
      }
      currentHeading = headingMatch[1].trim();
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }
  sections.push({ heading: currentHeading, body: currentBody.join("\n") });
  return sections;
}

/**
 * Group rapid changes into a single "batch" based on time window.
 * This simulates how we'd debounce autosave snapshots.
 */
function groupVersionsByTimeWindow(
  versions: VersionSnapshot[],
  windowMs: number = 30_000
): VersionSnapshot[][] {
  if (versions.length === 0) return [];

  const groups: VersionSnapshot[][] = [[]];
  let lastTs = versions[0].timestamp;

  for (const v of versions) {
    if (v.timestamp - lastTs > windowMs) {
      groups.push([]);
    }
    groups[groups.length - 1].push(v);
    lastTs = v.timestamp;
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Version History POC", () => {
  const v1Content = `---
builder:
  title: "Getting Started with React"
  handle: "getting-started-react"
---

# Getting Started with React

React is a popular JavaScript library for building user interfaces.

## Installation

To install React, run:

\`\`\`bash
npm install react react-dom
\`\`\`

## Your First Component

Here is a simple component:

\`\`\`jsx
function Hello() {
  return <h1>Hello World</h1>;
}
\`\`\`

## Conclusion

React makes building UIs simple and declarative.
`;

  const v2Content = `---
builder:
  title: "Getting Started with React"
  handle: "getting-started-react"
---

# Getting Started with React

React is a powerful JavaScript library for building modern user interfaces. It was created by Facebook and is now maintained by Meta.

## Prerequisites

Before installing React, make sure you have Node.js installed.

## Installation

To install React, run:

\`\`\`bash
npm create vite@latest my-app -- --template react
\`\`\`

## Your First Component

Here is a simple component:

\`\`\`jsx
function Hello({ name }) {
  return <h1>Hello {name}</h1>;
}
\`\`\`

## Conclusion

React makes building UIs simple, declarative, and efficient.
`;

  it("computes word-level diff for markdown content", () => {
    const changes = Diff.diffWords(v1Content, v2Content);
    const added = changes.filter((c) => c.added);
    const removed = changes.filter((c) => c.removed);

    expect(added.length).toBeGreaterThan(0);
    expect(removed.length).toBeGreaterThan(0);

    // Verify the diff captures the "popular" -> "powerful" change
    const removedText = removed.map((c) => c.value).join(" ");
    const addedText = added.map((c) => c.value).join(" ");
    expect(removedText).toContain("popular");
    expect(addedText).toContain("powerful");
  });

  it("computes line-level diff for markdown content", () => {
    const changes = Diff.diffLines(v1Content, v2Content);
    const addedLines = changes.filter((c) => c.added);
    const removedLines = changes.filter((c) => c.removed);

    expect(addedLines.length).toBeGreaterThan(0);
    expect(removedLines.length).toBeGreaterThan(0);
  });

  it("generates a structured patch", () => {
    const patch = Diff.structuredPatch("draft.md", "draft.md", v1Content, v2Content, "", "", {
      context: 3,
    });

    expect(patch.hunks.length).toBeGreaterThan(0);
    // Each hunk should have line info
    for (const hunk of patch.hunks) {
      expect(hunk.oldStart).toBeGreaterThan(0);
      expect(hunk.newStart).toBeGreaterThan(0);
      expect(hunk.lines.length).toBeGreaterThan(0);
    }
  });

  it("computes a meaningful change summary", () => {
    const summary = computeChangeSummary(v1Content, v2Content);

    expect(summary.wordsAdded).toBeGreaterThan(0);
    expect(summary.wordsRemoved).toBeGreaterThan(0);
    expect(summary.linesChanged).toBeGreaterThan(0);
    expect(summary.sectionsAffected.length).toBeGreaterThan(0);
    // "Prerequisites" is a new section
    expect(summary.sectionsAffected).toContain("Prerequisites");
    // "Installation" was modified (command changed)
    expect(summary.sectionsAffected).toContain("Installation");
  });

  it("detects affected markdown sections correctly", () => {
    const sections = detectAffectedSections(v1Content, v2Content);

    // New section added
    expect(sections).toContain("Prerequisites");
    // Intro paragraph changed
    expect(sections).toContain("Getting Started with React");
    // Code block changed
    expect(sections).toContain("Your First Component");
    // Conclusion text changed
    expect(sections).toContain("Conclusion");
  });

  it("groups rapid changes by time window", () => {
    const now = Date.now();
    const versions: VersionSnapshot[] = [
      { id: "v1", content: "a", timestamp: now, actor: { type: "user", id: "u1" } },
      { id: "v2", content: "ab", timestamp: now + 5_000, actor: { type: "user", id: "u1" } },
      { id: "v3", content: "abc", timestamp: now + 10_000, actor: { type: "user", id: "u1" } },
      // 60s gap - new group
      { id: "v4", content: "abcd", timestamp: now + 70_000, actor: { type: "agent", id: "fusion" } },
      { id: "v5", content: "abcde", timestamp: now + 75_000, actor: { type: "agent", id: "fusion" } },
    ];

    const groups = groupVersionsByTimeWindow(versions, 30_000);
    expect(groups.length).toBe(2);
    expect(groups[0].length).toBe(3); // user edits within 30s
    expect(groups[1].length).toBe(2); // agent edits within 30s
  });

  it("can apply a patch to reconstruct content", () => {
    const patch = Diff.createPatch("draft.md", v1Content, v2Content);
    const reconstructed = Diff.applyPatch(v1Content, patch);

    expect(reconstructed).toBe(v2Content);
  });

  it("handles frontmatter changes without breaking", () => {
    const oldFm = `---
builder:
  title: "Old Title"
---

Content here.
`;
    const newFm = `---
builder:
  title: "New Title"
  tags: ["react", "tutorial"]
---

Content here with additions.
`;

    const changes = Diff.diffLines(oldFm, newFm);
    const summary = computeChangeSummary(oldFm, newFm);

    expect(changes.length).toBeGreaterThan(0);
    expect(summary.linesChanged).toBeGreaterThan(0);
  });

  it("produces compact diffs for small edits in large documents", () => {
    // Simulate a ~2000 word article with a small change
    const longContent = Array.from({ length: 100 }, (_, i) =>
      `Line ${i}: This is paragraph content that simulates a real article with enough text to be meaningful.`
    ).join("\n\n");

    const editedContent = longContent.replace(
      "Line 50: This is paragraph",
      "Line 50: This is UPDATED paragraph"
    );

    const patch = Diff.structuredPatch("draft.md", "draft.md", longContent, editedContent, "", "", {
      context: 3,
    });

    // Should produce a single small hunk, not diff the entire file
    expect(patch.hunks.length).toBe(1);
    expect(patch.hunks[0].lines.length).toBeLessThan(15);
  });
});
