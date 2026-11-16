export const PRIVATE_ACTION_SCOPE_HEADER = "X-Agent-Native-Private-Scope";

export interface PrivateActionScope {
  readonly email: string;
  readonly orgId: string | null;
  readonly authUserId: string;
}
