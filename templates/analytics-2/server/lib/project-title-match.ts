export function normalizeProjectTitle(value: string): string {
  const words = value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return words || value.trim().toLocaleLowerCase();
}

export function matchProjectsByTitle<T extends { title: string }>(
  projects: readonly T[],
  name: string,
): T[] {
  const wanted = normalizeProjectTitle(name);
  const titled = projects.map((project) => ({
    project,
    key: normalizeProjectTitle(project.title),
  }));
  const exact = titled.filter(({ key }) => key === wanted);
  if (exact.length) return exact.map(({ project }) => project);
  const contains = titled.filter(({ key }) => key.includes(wanted));
  if (contains.length) return contains.map(({ project }) => project);
  const words = wanted.split(" ");
  return titled
    .filter(({ key }) => {
      const present = new Set(key.split(" "));
      return words.every((word) => present.has(word));
    })
    .map(({ project }) => project);
}

export function pickProjectByQuestion<T extends { title: string }>(
  matches: readonly T[],
  question: string,
): T | undefined {
  if (matches.length === 1) return matches[0];
  const said = new Set(normalizeProjectTitle(question).split(" "));
  const scored = matches
    .map((project) => ({
      project,
      score: normalizeProjectTitle(project.title)
        .split(" ")
        .filter((word) => word.length > 1 && said.has(word)).length,
    }))
    .sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  return best && best.score > 0 && best.score > (next?.score ?? -1)
    ? best.project
    : undefined;
}
