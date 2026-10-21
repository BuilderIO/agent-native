---
"@agent-native/core": minor
---

Add `registerJobRunner(id, fn)` to `@agent-native/core/server` so an app can run a recurring job's tick in its own code instead of the agent loop. A job opts in with `runner: <id>` in its frontmatter; the scheduler hands each scheduled or manual run to the registered function with the run's context and abort signal, and settles the run history and failure streak itself. An unregistered runner id, a runner combined with an execution host, or an event or webhook trigger on a runner job fails with a typed error instead of running as a prompt. History retention now evicts skipped runs before successful or failed ones.
