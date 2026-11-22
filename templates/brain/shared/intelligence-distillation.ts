export const KNOWLEDGE_UPDATE_INSTRUCTIONS = `To change an existing knowledge entry instead of adding a duplicate, call write-knowledge with its knowledgeId and, as expectedRevision, the revision from your get-knowledge, list-knowledge or search-knowledge read. To replace an entry with a new one, pass its id as supersedesId and its revision from the same read as supersedesRevision. If it fails with save_conflict, redo your edit on details.current and resend with details.currentRevision. `;

export function intelligenceDistillationInstructions(captureId: string) {
  return (
    `For meeting transcripts and other allowed source text, extract supported decisions, action items and customer feature requests with write-intelligence. ` +
    `First call list-intelligence with captureId=${captureId} to find previous extractions. Update a matching record using its id and expectedRevision instead of creating a duplicate; if hasMore is true, report incomplete coverage rather than assuming the list is complete. ` +
    `Use exact evidence quotes from this capture. When an attributable speaker label is present in the persisted text, include the speaker label and spoken text together as one exact substring in evidence for both intelligence and other knowledge; never invent a speaker or restore one removed by privacy filtering. Use typed people/project/customer entities whose names occur in the quotes. A supplied owner must occur in an evidence quote; ownershipConfidence is explicit only when the quote establishes ownership, otherwise ambiguous. Set dueDate only when its YYYY-MM-DD value appears literally in an evidence quote. Retain relative deadline wording in the body with dueDate unset. ` +
    `Keep unknown owners and dates empty, distinguish planned decisions from completed work, and never verify records automatically. Preserve the source audience and the configured publish tier; restricted evidence cannot become broadly shared context. `
  );
}
