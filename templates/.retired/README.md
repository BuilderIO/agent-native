# Retired Netlify Site Shims

These workspace packages are not app templates. They exist so old Netlify
projects with dashboard commands like `pnpm --filter issues build` can still
produce the configured `templates/issues/dist` publish directory after the
real templates were pruned.

Remove a shim only after the corresponding Netlify site is deleted or its build
settings are updated.
