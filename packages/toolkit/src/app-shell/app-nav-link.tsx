import { NavLink, type NavLinkProps } from "react-router";

/**
 * NavLink that prefetches its target route module on hover/focus instead of
 * only on click. Without this, the very first navigation to a route the dev
 * server hasn't bundled yet can lose a race against Vite's on-demand
 * dependency discovery, which React Router treats as fatal (it reloads the
 * whole page - see @agent-native/core/client/route-chunk-recovery). Starting
 * the module load on hover gives that race a head start, so by the time the
 * click lands the module is usually already resolved and cached.
 *
 * Use this for app navigation instead of importing NavLink directly.
 */
export function AppNavLink({ prefetch = "intent", ...props }: NavLinkProps) {
  return <NavLink prefetch={prefetch} {...props} />;
}
