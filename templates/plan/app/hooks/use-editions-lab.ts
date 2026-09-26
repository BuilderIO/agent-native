import { useLab } from "@agent-native/core/client/labs";
import { PLAN_EDITIONS } from "@shared/labs";

/**
 * False only once Labs has answered. A signed-out reader and Plan's no-login
 * local mode never load labs at all, and treating that as "off" would hide the
 * reader from the one setup that has no way to turn the lab on.
 */
export function useEditionsLab(): boolean {
  return useLab(PLAN_EDITIONS.key);
}
