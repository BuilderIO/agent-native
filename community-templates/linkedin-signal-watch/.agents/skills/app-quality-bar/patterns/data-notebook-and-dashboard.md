# Data notebook and dashboard

Use for repeatable analysis, results review, and shareable views.

- Give dashboards and individual outputs stable deep links. Resolve known
  targets directly through the manifest and navigation action. Opening a known
  target should never type a search query into visible UI.
- Keep notebook controls and prior successful results usable during a query.
  Show progress, elapsed time, and cancellation near the running item.
  Identify stale results when a newer run fails and offer retry.
- Present proposed SQL and chart edits in a review bar with structured diffs
  for the query, data fields, and chart encoding. Provide Accept and Reject,
  and surface validation and authorization failures beside the proposal.
  Apply against the reviewed revision and keep the last saved result until
  the change succeeds.

Verify direct opening from a sibling view, a slow query, cancellation, an
invalid proposal, and separate accept/reject outcomes after reload.
