---
"@agent-native/core": patch
---

Stop `manage-jobs` create from replacing an existing job file, and record a `job-fields-dropped` audit event when a write to a `jobs/` file removes its frontmatter fields.
