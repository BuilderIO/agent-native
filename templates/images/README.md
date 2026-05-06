# Images

Agent-native image libraries for brand-consistent AI image generation.

Use libraries to collect reference images, logos, product shots, diagrams, style
briefs, generated candidates, and saved images. The UI curates the library; the
agent handles generation and iteration through actions and A2A.

Every generated image writes an audit run with user prompt, compiled prompt,
model, source app, references, outputs, status, and refinement lineage. Org
admins can review the log at `/audit` and export CSV for design-team QA.
