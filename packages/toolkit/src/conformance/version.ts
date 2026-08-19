import { DESIGN_SYSTEM_CONTRACT_VERSION } from "../design-system/types.js";

export const DESIGN_SYSTEM_CONTRACT_EVOLUTION_POLICY = {
  minor: "New components and optional props are backward-compatible.",
  major:
    "Required props, removed components or props, and behavioral contract changes require a new contract major.",
} as const;

export function assertDesignSystemContractVersion(
  adapterContractVersion: number,
): void {
  if (!Number.isInteger(adapterContractVersion) || adapterContractVersion < 1) {
    throw new TypeError(
      "Design system contractVersion must be a positive integer.",
    );
  }
  if (adapterContractVersion !== DESIGN_SYSTEM_CONTRACT_VERSION) {
    throw new RangeError(
      `Design system contract major ${adapterContractVersion} is incompatible with Toolkit contract major ${DESIGN_SYSTEM_CONTRACT_VERSION}.`,
    );
  }
}
