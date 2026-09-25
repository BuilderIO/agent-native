import { useLabState } from "@agent-native/core/client/labs";
import { PLAN_EDITIONS } from "@shared/labs";

/**
 * `resolved` stays false for signed-out readers, who have no labs to read:
 * treating that as "off" would bounce a shared issue link to the home page
 * instead of the sign-in prompt.
 */
export function useEditionsLab(): { enabled: boolean; resolved: boolean } {
  const { enabled, isSuccess } = useLabState(PLAN_EDITIONS.key);
  return { enabled, resolved: isSuccess };
}
