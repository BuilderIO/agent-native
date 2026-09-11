export function resolveDictionaryTrustDefaults(
  args: { approved?: boolean; aiGenerated?: boolean },
  existing?: { approved?: boolean; aiGenerated?: boolean } | null,
) {
  const aiGenerated = args.aiGenerated ?? existing?.aiGenerated ?? false;
  const approved = args.approved ?? existing?.approved ?? !aiGenerated;
  return { approved, aiGenerated };
}
