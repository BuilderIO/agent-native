import { useT } from "@agent-native/core/client";
import {
  IconCheck,
  IconCopy,
  IconDeviceLaptop,
  IconChevronDown,
  IconKey,
  IconLoader2,
  IconShieldLock,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  getPrivateVaultBrowserStatus,
  type PrivateVaultBrowserStatus,
} from "@/lib/private-vault-runtime-client";

type VaultResult =
  | { ok: true; vaultId: string }
  | { ok: true; vaults: Array<{ vaultId: string }> }
  | { ok: false; error: string };

interface PrivateVaultDesktopBridge {
  createGenesis(): Promise<VaultResult>;
  resumeGenesis(): Promise<VaultResult>;
  recover(): Promise<VaultResult>;
  beginBrokerEnrollment?(input: { vaultId: string }): Promise<
    | {
        ok: true;
        state: "awaiting-authorizer";
        invitation: string;
      }
    | { ok: false; error: string }
  >;
  advanceBrokerCandidate?(input: { invitation: string }): Promise<
    | {
        ok: true;
        state: "awaiting-authorizer";
        invitation: string;
      }
    | { ok: true; state: "awaiting-authorization" | "active" }
    | { ok: false; error: string }
  >;
  advanceBrokerAuthorizer?(input: {
    invitation: string;
  }): Promise<
    | { ok: true; state: "awaiting-candidate" | "committed" }
    | { ok: false; error: string }
  >;
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
  const t = useT();
  const desktop = bridge();
  const [operation, setOperation] = useState<VaultOperation | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<PrivateVaultBrowserStatus | null>(null);
  const [enrollmentDialog, setEnrollmentDialog] = useState<
    "candidate" | "authorizer" | null
  >(null);
  const [invitation, setInvitation] = useState("");
  const [enrollmentBusy, setEnrollmentBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void getPrivateVaultBrowserStatus({ signal: controller.signal })
      .then(setStatus)
      .catch(() => setStatus(null));
    return () => controller.abort();
  }, []);

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
          ? t("settings.privateVault.trustedEndpointReady")
          : count === 0
            ? t("settings.privateVault.noPending")
            : t("settings.privateVault.ceremonyComplete"),
      );
      const vaultId =
        "vaultId" in result ? result.vaultId : result.vaults[0]?.vaultId;
      if (vaultId) setStatus({ state: "active", vaultId, sequence: 0 });
    } catch {
      setMessage(t("settings.privateVault.enrollmentUnavailable"));
    } finally {
      setOperation(null);
    }
  };

  const beginBrokerEnrollment = async () => {
    if (!desktop?.beginBrokerEnrollment || status?.state !== "active") return;
    setEnrollmentBusy(true);
    setMessage(null);
    try {
      const result = await desktop.beginBrokerEnrollment({
        vaultId: status.vaultId,
      });
      if (!result.ok) throw new Error();
      setInvitation(result.invitation);
      setEnrollmentDialog("candidate");
    } catch {
      setMessage(t("settings.privateVault.enrollmentUnavailable"));
    } finally {
      setEnrollmentBusy(false);
    }
  };

  const advanceCandidate = async () => {
    if (!desktop?.advanceBrokerCandidate || !invitation) return;
    setEnrollmentBusy(true);
    try {
      const result = await desktop.advanceBrokerCandidate({ invitation });
      if (!result.ok) throw new Error();
      if (result.state === "awaiting-authorizer") {
        setInvitation(result.invitation);
        setMessage(t("settings.privateVault.awaitingAuthorizer"));
      } else if (result.state === "awaiting-authorization") {
        setMessage(t("settings.privateVault.awaitingAuthorization"));
      } else {
        setMessage(t("settings.privateVault.brokerActive"));
        setEnrollmentDialog(null);
      }
    } catch {
      setMessage(t("settings.privateVault.enrollmentUnavailable"));
    } finally {
      setEnrollmentBusy(false);
    }
  };

  const advanceAuthorizer = async () => {
    if (!desktop?.advanceBrokerAuthorizer || !invitation.trim()) return;
    setEnrollmentBusy(true);
    try {
      const result = await desktop.advanceBrokerAuthorizer({
        invitation: invitation.trim(),
      });
      if (!result.ok) throw new Error();
      setMessage(
        result.state === "awaiting-candidate"
          ? t("settings.privateVault.awaitingCandidate")
          : t("settings.privateVault.authorizationCommitted"),
      );
      if (result.state === "committed") setEnrollmentDialog(null);
    } catch {
      setMessage(t("settings.privateVault.enrollmentUnavailable"));
    } finally {
      setEnrollmentBusy(false);
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
          <h2 className="text-base font-semibold">
            {t("settings.privateVault.title")}
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {t("settings.privateVault.description")}
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
          {desktop
            ? t("settings.privateVault.create")
            : t("settings.privateVault.openDesktop")}
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
                {t("settings.privateVault.existing")}
                <IconChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => void run("resume")}>
                  <IconDeviceLaptop />
                  {t("settings.privateVault.finishSetup")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void run("recover")}>
                  <IconKey />
                  {t("settings.privateVault.recover")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={
                    status?.state !== "active" || !desktop.beginBrokerEnrollment
                  }
                  onSelect={() => void beginBrokerEnrollment()}
                >
                  <IconDeviceLaptop />
                  {t("settings.privateVault.addThisMac")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!desktop.advanceBrokerAuthorizer}
                  onSelect={() => {
                    setInvitation("");
                    setEnrollmentDialog("authorizer");
                  }}
                >
                  <IconCheck />
                  {t("settings.privateVault.approveAnotherMac")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {status?.state === "active" ? (
        <div className="mt-4 rounded-md border border-border bg-muted/40 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <IconShieldLock size={16} aria-hidden="true" />
            {t("settings.privateVault.readyTitle")}
          </div>
          <p className="mt-1 leading-6 text-muted-foreground">
            {t("settings.privateVault.readyDescription")}
          </p>
        </div>
      ) : null}

      {message ? (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}

      <Dialog
        open={enrollmentDialog !== null}
        onOpenChange={(open) => {
          if (!open && !enrollmentBusy) setEnrollmentDialog(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {enrollmentDialog === "candidate"
                ? t("settings.privateVault.candidateTitle")
                : t("settings.privateVault.authorizerTitle")}
            </DialogTitle>
            <DialogDescription>
              {enrollmentDialog === "candidate"
                ? t("settings.privateVault.candidateDescription")
                : t("settings.privateVault.authorizerDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="private-vault-enrollment-invitation">
              {t("settings.privateVault.invitationLabel")}
            </Label>
            <Textarea
              id="private-vault-enrollment-invitation"
              value={invitation}
              readOnly={enrollmentDialog === "candidate"}
              placeholder={
                enrollmentDialog === "authorizer"
                  ? t("settings.privateVault.invitationPlaceholder")
                  : undefined
              }
              spellCheck={false}
              className="min-h-28 resize-none font-mono text-xs"
              onChange={(event) => setInvitation(event.target.value)}
            />
          </div>
          <DialogFooter>
            {enrollmentDialog === "candidate" ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!invitation || enrollmentBusy}
                  onClick={() => {
                    void navigator.clipboard.writeText(invitation).then(
                      () => setMessage(t("settings.privateVault.copied")),
                      () =>
                        setMessage(
                          t("settings.privateVault.enrollmentUnavailable"),
                        ),
                    );
                  }}
                >
                  <IconCopy />
                  {t("settings.privateVault.copyInvitation")}
                </Button>
                <Button
                  type="button"
                  disabled={!invitation || enrollmentBusy}
                  onClick={() => void advanceCandidate()}
                >
                  {enrollmentBusy ? (
                    <IconLoader2 className="animate-spin" />
                  ) : (
                    <IconDeviceLaptop />
                  )}
                  {t("settings.privateVault.checkProgress")}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                disabled={!invitation.trim() || enrollmentBusy}
                onClick={() => void advanceAuthorizer()}
              >
                {enrollmentBusy ? (
                  <IconLoader2 className="animate-spin" />
                ) : (
                  <IconCheck />
                )}
                {t("settings.privateVault.continueEnrollment")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
