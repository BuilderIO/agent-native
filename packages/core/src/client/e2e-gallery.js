// Deliberately made to fail on its first request by the E2E server in
// route-chunk-recovery.e2e.spec.ts, to reproduce a cold Vite route module
// losing the race against on-demand dependency discovery.
export const GALLERY = true;
