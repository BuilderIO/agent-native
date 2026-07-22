export type CreatePlanKind = "auto" | "design" | "ui" | "questions" | "visual";
export type ResolvedPlanKind = Exclude<CreatePlanKind, "auto">;
export type AutoPlanKind = Exclude<ResolvedPlanKind, "questions">;

export function isProbablyImportedPlan(prompt: string) {
  const trimmed = prompt.trim();
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
  if (trimmed.length > 900 && lines.length > 8) return true;
  const hasHeading = lines.some((line) => /^#{1,4}\s+\S/.test(line.trim()));
  const checklistCount = lines.filter((line) =>
    /^[-*]\s+\[[ x]\]\s+\S/i.test(line.trim()),
  ).length;
  const taskCount = lines.filter((line) =>
    /^([-*]|\d+[.)])\s+\S/.test(line.trim()),
  ).length;
  const hasPlanLanguage =
    /\b(implementation plan|acceptance criteria|milestones?|phases?|risks?|open questions?|test plan)\b/i.test(
      trimmed,
    );
  return (
    trimmed.includes("```") ||
    (hasHeading && (taskCount >= 3 || hasPlanLanguage)) ||
    (checklistCount >= 2 && trimmed.length > 220)
  );
}

export function assessPlanPrompt(prompt: string): { kind: AutoPlanKind } {
  const highFidelity =
    /\b(high(?:er)?[- ]fidelity|full[- ]fidelity|hi[- ]fi|polished(?: mockups?)?|production[- ](?:like|ready)|pixel[- ]perfect|brand(?:ed|[- ]aware)|real design|not (?:a )?(?:sketch(?:y)?|wireframe)|beyond (?:the )?(?:sketch|wireframe))\b/i.test(
      prompt,
    );
  if (highFidelity) return { kind: "design" };

  const uiDirection =
    /\b(ui|screen|screens|layout|wireframe|mockup|form factor|mobile|desktop|responsive|nav|sidebar|flow|redesign|empty state|loading state|error state)\b/i.test(
      prompt,
    );
  return { kind: uiDirection ? "ui" : "visual" };
}
