// Docs has no application-owned migration list. Keep the plugin slot so the
// server layout stays explicit, but do not make an empty migration runner
// part of every cold start.
export default function docsDbPlugin(): void {}
