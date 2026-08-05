export interface DeckBrief {
  title: string;
  sections: Array<{ label: string; body: string; points?: string[] }>;
  sourceNoteCount: number;
}

function cleanLine(value: string) {
  return value
    .replace(/^[#>*\-\d.)\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceLines(sourceText: string) {
  return sourceText
    .split(/[\n.!?]+/)
    .map(cleanLine)
    .filter((line) => line.length > 0);
}

function matchingLines(lines: string[], pattern: RegExp) {
  return lines.filter((line) => pattern.test(line)).slice(0, 3);
}

export function buildDeckBrief(sourceText: string): DeckBrief {
  const lines = sourceLines(sourceText);
  const [lead = "The notes need a sharper narrative before the meeting."] =
    lines;
  const themes = lines.slice(0, 3);
  const asks = matchingLines(
    lines,
    /\b(ask|decision|need|approve|approval)\b/i,
  );
  const nextSteps = matchingLines(
    lines,
    /\b(next|follow|owner|by\s+\w+day|ship)\b/i,
  );

  return {
    title: "QBR / meeting deck brief",
    sourceNoteCount: lines.length,
    sections: [
      {
        label: "Executive snapshot",
        body: `${lead} Frame the meeting around what changed, why it matters now, and what needs alignment.`,
      },
      {
        label: "Key themes",
        body: "Use these as the short narrative spine for the deck.",
        points:
          themes.length > 0 ? themes : ["No themes found in the source notes."],
      },
      {
        label: "Suggested flow",
        body: "A concise five-part story for a QBR or working session.",
        points: [
          "Context and goal",
          "What changed since the last checkpoint",
          "Evidence, momentum, and friction",
          "Decisions and open questions",
          "Owners and next checkpoint",
        ],
      },
      {
        label: "Decisions and asks",
        body:
          asks.length > 0
            ? asks.join(" ")
            : "Name the decision required, the trade-off behind it, and the person who can unblock it.",
      },
      {
        label: "Next steps",
        body:
          nextSteps.length > 0
            ? nextSteps.join(" ")
            : "Close with one owner, one date, and one measurable follow-up for each open thread.",
      },
    ],
  };
}
