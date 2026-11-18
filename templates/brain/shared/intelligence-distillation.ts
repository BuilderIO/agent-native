export function intelligenceDistillationInstructions(captureId: string) {
  return (
    `For meeting transcripts and other allowed source text, extract supported decisions, action items and customer feature requests with write-intelligence. ` +
    `First call list-intelligence with captureId=${captureId} to find previous extractions. Update a matching record using its id and expectedRevision instead of creating a duplicate; if hasMore is true, report incomplete coverage rather than assuming the list is complete. ` +
    `Use exact evidence quotes from this capture, with typed people/project/customer entities whose names occur in the quotes. Record an owner or due date only when supported; ownershipConfidence is explicit only when the quote names the owner, otherwise ambiguous. ` +
    `Keep unknown owners and dates empty, distinguish planned decisions from completed work, and never verify records automatically. Preserve the source audience and the configured publish tier; restricted evidence cannot become broadly shared context. `
  );
}
