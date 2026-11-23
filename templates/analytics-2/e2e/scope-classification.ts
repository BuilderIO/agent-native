export function classifyFlows(
  scope: string,
  names: readonly string[],
): Set<string> {
  function section(name: string): string {
    const match = scope.match(
      new RegExp(
        `^## ${name} \\([^\\n]+\\)\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`,
        "m",
      ),
    );
    if (!match?.[1]) throw new Error(`Missing ${name} scope section`);
    return match[1];
  }
  const core = section("Core");
  const secondary = `${section("Labs")}\n${section("Cut")}`;
  const nonCore = new Set(
    names.filter((name) => secondary.includes(`\`${name}\``)),
  );
  for (const name of names) {
    if (!core.includes(`\`${name}\``) && !nonCore.has(name))
      throw new Error(`Unclassified core flow: ${name}`);
    if (core.includes(`\`${name}\``) && nonCore.has(name))
      throw new Error(`Flow classified as both core and non-core: ${name}`);
  }
  return nonCore;
}
