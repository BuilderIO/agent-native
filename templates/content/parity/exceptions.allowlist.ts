export interface ParityActionAllowlistEntry {
  action: string;
  reason: string;
}

export const parityActionAllowlist: ParityActionAllowlistEntry[] = [
  {
    action: "refresh-list",
    reason:
      "Agent/UI bridge helper that only nudges application-state refresh; not a user-visible Content operation.",
  },
  {
    action: "run",
    reason:
      "Template bootstrap/support action rather than a Content user workflow.",
  },
];
