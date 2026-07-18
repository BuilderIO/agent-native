import {
  IconDeviceLaptop,
  IconChevronDown,
  IconKey,
  IconLoader2,
  IconShieldLock,
} from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type VaultResult =
  | { ok: true; vaultId: string }
  | { ok: true; vaults: Array<{ vaultId: string }> }
  | { ok: false; error: string };

interface PrivateVaultDesktopBridge {
  createGenesis(): Promise<VaultResult>;
  resumeGenesis(): Promise<VaultResult>;
  recover(): Promise<VaultResult>;
}

type VaultOperation = "create" | "resume" | "recover";

function bridge(): PrivateVaultDesktopBridge | null {
  return (
    (
      window as typeof window & {
        agentNativeDesktop?: { privateVault?: PrivateVaultDesktopBridge };
      }
    ).agentNativeDesktop?.privateVault ?? null
  );
}

export function PrivateVaultSettingsCard() {
  const desktop = bridge();
  const [operation, setOperation] = useState<VaultOperation | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (next: VaultOperation) => {
    if (!desktop) return;
    setOperation(next);
    setMessage(null);
    try {
      const result = await (next === "create"
        ? desktop.createGenesis()
        : next === "resume"
          ? desktop.resumeGenesis()
          : desktop.recover());
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      const count = "vaults" in result ? result.vaults.length : 1;
      setMessage(
        next === "recover"
          ? "This Mac is now a trusted endpoint for your encrypted vault."
          : count === 0
            ? "There are no pending vault ceremonies."
            : "Your encrypted vault ceremony is complete.",
      );
    } catch {
      setMessage("Private Vault is unavailable in this Content surface.");
    } finally {
      setOperation(null);
    }
  };

  return (
    <section
      id="private-vault"
      className="scroll-mt-16 rounded-lg border border-border bg-card p-5"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-muted p-2 text-foreground">
          <IconShieldLock size={20} aria-hidden="true" />
        </div>
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-semibold">Private vault</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            End-to-end encryption keeps document contents readable only on
            trusted endpoints. Recovery words are collected by the native Mac
            app and never enter Content, the browser, or an agent prompt.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={!desktop || operation !== null}
          onClick={() => void run("create")}
        >
          {operation === "create" ? (
            <IconLoader2 className="animate-spin" />
          ) : (
            <IconShieldLock />
          )}
          {desktop ? "Create encrypted vault" : "Open desktop app to set up"}
        </Button>
        {desktop ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                disabled={operation !== null}
              >
                {operation && operation !== "create" ? (
                  <IconLoader2 className="animate-spin" />
                ) : (
                  <IconDeviceLaptop />
                )}
                Already have a vault
                <IconChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => void run("resume")}>
                  <IconDeviceLaptop />
                  Finish setup on this Mac
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void run("recover")}>
                  <IconKey />
                  Recover with recovery words
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {message ? (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
