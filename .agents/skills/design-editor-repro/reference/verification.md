# Verifying a Design editor fix

1. Reproduce the original issue on the changed build.
2. Confirm the visible editor state and persisted design data.
3. Run the focused regression test and nearby tests for the same interaction.
4. Run the required Design lane when canvas input, selection, or layout changed.
5. Inspect the rendered app for visible changes.
6. Remove temporary copies and close browser pages created for the reproduction.

When a test result cannot be obtained, state which check was unavailable and
why. A source-only review does not confirm runtime behavior.
