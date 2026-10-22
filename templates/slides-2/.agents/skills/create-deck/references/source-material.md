# Source material: transcripts and Google Docs

When the source is a transcript or meeting notes, extract the audience's
terminology, goals, objections, decisions, owners, dates, metrics, and open
questions before outlining. Preserve exact names, numbers, dates, and requested
quotes; retain speaker/source attribution; distinguish quotation, paraphrase,
inference, and unresolved claim. Do not invent connective claims to make the
story smoother. Keep factual evidence separate from visual references and
record the source/version identifiers in provenance when available.

If the user provides a Google Docs URL as source material, call
`import-google-doc --url <url>` first and build from the returned text. If the
action cannot read a private document, the user can connect Google Docs and
choose the file through the picker, or share the Doc with the configured service
account. Relay the action's exact access instructions instead of generating from
the URL alone.
