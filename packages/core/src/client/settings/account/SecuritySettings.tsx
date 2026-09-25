import { ActionButton, TextField } from "@agent-native/toolkit/design-system";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import { IconExternalLink } from "@tabler/icons-react";
import { QRCodeSVG } from "qrcode.react";
import { useState, type ReactNode } from "react";

import { docsUrl } from "../../../shared/docs-url.js";
import { PASSWORD_MIN_LENGTH } from "../../../shared/password-policy.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { useT } from "../../i18n.js";
import { useSession } from "../../use-session.js";
import { SettingsGroup, SettingsRow } from "../SettingsRow.js";
import { SettingsSkeleton } from "../SettingsSkeleton.js";
import {
  usePasswordForm,
  usePrivacyRequest,
  useTwoFactorSettings,
  type PrivacyRequestType,
  type TwoFactorError,
} from "./account-hooks.js";

const key = (name: string) => `agentChat.settingsShell.account.${name}`;

/** Account › Security: sign-in methods and data requests. */
export function SecuritySettings() {
  const t = useT();
  const { session, status } = useSession();
  if (status === "loading" && !session) {
    return <SettingsSkeleton lines={4} />;
  }
  const signedIn = !!session?.email;
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup id="sign-in" title={t(key("signIn"))}>
        <PasswordRow signedIn={signedIn} />
        <TwoFactorRow />
      </SettingsGroup>
      {signedIn ? <YourDataGroup /> : null}
    </div>
  );
}

function StatusText({
  tone,
  children,
}: {
  tone: "ok" | "error";
  children: ReactNode;
}) {
  return tone === "ok" ? (
    <span className="text-primary" role="status">
      {children}
    </span>
  ) : (
    <span className="text-destructive" role="alert">
      {children}
    </span>
  );
}

function RowButton({
  children,
  intent = "neutral",
  disabled,
  pending,
  onPress,
}: {
  children: ReactNode;
  intent?: "neutral" | "danger";
  disabled?: boolean;
  pending?: boolean;
  onPress: () => void;
}) {
  return (
    <ActionButton
      type="button"
      intent={intent}
      emphasis="outline"
      size="compact"
      disabled={disabled}
      pending={pending}
      onPress={onPress}
    >
      {children}
    </ActionButton>
  );
}

function PasswordRow({ signedIn }: { signedIn: boolean }) {
  const t = useT();
  const form = usePasswordForm();
  const [open, setOpen] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const actionLabel = form.hasPassword
    ? t(key("changePassword"))
    : t(key("addPassword"));
  const error =
    form.validationError === "length"
      ? t(key("passwordMinLength"), { count: PASSWORD_MIN_LENGTH })
      : form.validationError === "mismatch"
        ? t(key("passwordMismatch"))
        : form.saveFailed
          ? t(key("passwordSaveError"))
          : undefined;

  const openDialog = (next: boolean) => {
    if (next) {
      form.reset();
      setJustSaved(false);
    }
    setOpen(next);
  };

  return (
    <SettingsRow
      id="password"
      label={t(key("password"))}
      description={
        form.loadFailed ? (
          <StatusText tone="error">{t(key("passwordLoadError"))}</StatusText>
        ) : justSaved ? (
          <StatusText tone="ok">{t(key("passwordSaved"))}</StatusText>
        ) : (
          t(key("passwordDescription"))
        )
      }
      control={
        <Dialog open={open} onOpenChange={openDialog}>
          <RowButton
            disabled={!signedIn || form.isLoading || form.loadFailed}
            onPress={() => openDialog(true)}
          >
            {actionLabel}
          </RowButton>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{actionLabel}</DialogTitle>
            </DialogHeader>
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!form.canSubmit) return;
                form.submit(() => {
                  setJustSaved(true);
                  setOpen(false);
                });
              }}
            >
              {form.hasPassword ? (
                <TextField
                  id="agent-native-current-password"
                  type="password"
                  label={t(key("currentPassword"))}
                  value={form.currentPassword}
                  onChange={form.setCurrentPassword}
                  autoComplete="current-password"
                  autoFocus
                  disabled={form.isPending}
                />
              ) : null}
              <TextField
                id="agent-native-new-password"
                type="password"
                label={t(key("newPassword"))}
                value={form.newPassword}
                onChange={form.setNewPassword}
                autoComplete="new-password"
                autoFocus={!form.hasPassword}
                disabled={form.isPending}
                invalid={!!error}
              />
              <TextField
                id="agent-native-confirm-password"
                type="password"
                label={t(key("confirmPassword"))}
                value={form.confirmPassword}
                onChange={form.setConfirmPassword}
                autoComplete="new-password"
                disabled={form.isPending}
                invalid={!!error}
                errorMessage={error}
              />
              <DialogFooter className="gap-2">
                <ActionButton
                  type="button"
                  intent="neutral"
                  emphasis="outline"
                  size="compact"
                  onPress={() => openDialog(false)}
                >
                  {t("agentChat.common.cancel")}
                </ActionButton>
                <ActionButton
                  type="submit"
                  intent="primary"
                  emphasis="solid"
                  size="compact"
                  pending={form.isPending}
                  disabled={!form.canSubmit}
                >
                  {form.isPending
                    ? t("agentChat.common.saving")
                    : t(key("savePassword"))}
                </ActionButton>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }
    />
  );
}

const TWO_FACTOR_ERROR_KEYS: Record<TwoFactorError["fallback"], string> = {
  load: key("twoFactorLoadError"),
  setup: key("twoFactorSetupError"),
  code: key("twoFactorCodeError"),
  disable: key("twoFactorDisableError"),
};

function TwoFactorRow() {
  const t = useT();
  const twoFactor = useTwoFactorSettings();
  const [open, setOpen] = useState(false);
  const {
    enabled,
    setup,
    hasPassword,
    pending,
    signedIn,
    isLoading,
    error: rawError,
  } = twoFactor;
  // The auth server's message (a wrong password, say) wins for setup and
  // turn-off; the code check and the status read use ours.
  const error = rawError
    ? rawError.fallback === "code" ||
      rawError.fallback === "load" ||
      !rawError.message
      ? t(TWO_FACTOR_ERROR_KEYS[rawError.fallback])
      : rawError.message
    : null;
  const loadFailed = rawError?.fallback === "load";

  const openDialog = (next: boolean) => {
    if (!next) twoFactor.dismissSetup();
    setOpen(next);
  };

  const passwordField = hasPassword ? (
    <TextField
      id="agent-native-two-factor-password"
      type="password"
      label={t(key("currentPassword"))}
      value={twoFactor.password}
      onChange={twoFactor.setPassword}
      autoComplete="current-password"
      autoFocus
      disabled={pending}
    />
  ) : null;

  const cancel = (
    <ActionButton
      type="button"
      intent="neutral"
      emphasis="outline"
      size="compact"
      onPress={() => openDialog(false)}
    >
      {t("agentChat.common.cancel")}
    </ActionButton>
  );
  const needsPassword = hasPassword && !twoFactor.password;
  const errorLine = error ? (
    <p className="text-sm text-destructive" role="alert">
      {error}
    </p>
  ) : null;

  let title: string;
  let body: ReactNode;
  let footer: ReactNode;
  let onSubmit: () => void;
  if (setup && enabled) {
    title = t(key("twoFactor"));
    body = (
      <div className="grid gap-2">
        <p className="text-sm text-muted-foreground">
          {t(key("twoFactorBackupCodes"))}
        </p>
        <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-3 font-mono text-xs">
          {setup.backupCodes.map((backupCode) => (
            <code key={backupCode}>{backupCode}</code>
          ))}
        </div>
      </div>
    );
    onSubmit = () => openDialog(false);
    footer = (
      <ActionButton
        type="submit"
        intent="primary"
        emphasis="solid"
        size="compact"
      >
        {t(key("done"))}
      </ActionButton>
    );
  } else if (setup) {
    title = t(key("twoFactorSetupTitle"));
    body = (
      <div className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          {t(key("twoFactorScan"))}
        </p>
        <QRCodeSVG
          value={setup.totpURI}
          size={176}
          fgColor="hsl(var(--foreground))"
          bgColor="hsl(var(--background))"
          className="rounded-md p-2"
          aria-label={t(key("twoFactorQrLabel"))}
        />
        <code className="block break-all rounded-md bg-muted p-2 text-[11px] text-muted-foreground">
          {setup.totpURI}
        </code>
        <TextField
          id="agent-native-two-factor-code"
          type="text"
          label={t(key("authenticatorCode"))}
          value={twoFactor.code}
          onChange={(value) => twoFactor.setCode(value.replace(/\D/g, ""))}
          placeholder="123456"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          disabled={pending}
        />
        {errorLine}
      </div>
    );
    onSubmit = () => void twoFactor.confirmSetup();
    footer = (
      <>
        {cancel}
        <ActionButton
          type="submit"
          intent="primary"
          emphasis="solid"
          size="compact"
          pending={pending}
          disabled={pending || !twoFactor.code}
        >
          {t(key("verifyAndEnable"))}
        </ActionButton>
      </>
    );
  } else if (enabled) {
    title = t(key("twoFactor"));
    body = (
      <div className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          {t(key("twoFactorEnabled"))}
        </p>
        {passwordField}
        {errorLine}
      </div>
    );
    onSubmit = () =>
      void twoFactor.turnOff().then((done) => {
        if (done) openDialog(false);
      });
    footer = (
      <>
        {cancel}
        <ActionButton
          type="submit"
          intent="danger"
          emphasis="solid"
          size="compact"
          pending={pending}
          disabled={pending || needsPassword}
        >
          {t(key("turnOffTwoFactor"))}
        </ActionButton>
      </>
    );
  } else {
    title = t(key("twoFactorSetupTitle"));
    body = (
      <div className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          {t(key("twoFactorDescription"))}
        </p>
        {passwordField}
        {errorLine}
      </div>
    );
    onSubmit = () => void twoFactor.startSetup();
    footer = (
      <>
        {cancel}
        <ActionButton
          type="submit"
          intent="primary"
          emphasis="solid"
          size="compact"
          pending={pending}
          disabled={pending || needsPassword}
        >
          {t("agentChat.common.continue")}
        </ActionButton>
      </>
    );
  }

  const description = loadFailed ? (
    <StatusText tone="error">{error}</StatusText>
  ) : twoFactor.saved && !open ? (
    <StatusText tone="ok">{t(key("twoFactorSaved"))}</StatusText>
  ) : enabled ? (
    t(key("twoFactorEnabled"))
  ) : (
    t(key("twoFactorDescription"))
  );

  return (
    <SettingsRow
      id="two-factor"
      label={t(key("twoFactor"))}
      description={description}
      control={
        <Dialog open={open} onOpenChange={openDialog}>
          <RowButton
            disabled={!signedIn || isLoading || loadFailed}
            onPress={() => openDialog(true)}
          >
            {enabled ? t(key("manage")) : t(key("setUpTwoFactor"))}
          </RowButton>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              {/* Radix wants a description; the body carries the copy. */}
              <DialogDescription className="sr-only">{title}</DialogDescription>
            </DialogHeader>
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                onSubmit();
              }}
            >
              {body}
              <DialogFooter className="gap-2">{footer}</DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }
    />
  );
}

function YourDataGroup() {
  const t = useT();
  const privacy = usePrivacyRequest();
  const [deletionOpen, setDeletionOpen] = useState(false);

  const describe = (type: PrivacyRequestType, fallback: string) =>
    privacy.failedType === type ? (
      <StatusText tone="error">{t("settings.privacyRequestError")}</StatusText>
    ) : privacy.recorded[type] ? (
      <StatusText tone="ok">{t("settings.privacyRequestRecorded")}</StatusText>
    ) : (
      fallback
    );

  return (
    <div className="flex flex-col gap-3">
      <SettingsGroup id="your-data" title={t(key("yourData"))}>
        <SettingsRow
          id="data-copy"
          label={t(key("requestCopyLabel"))}
          description={describe("access", t(key("requestCopyDescription")))}
          control={
            <RowButton
              pending={privacy.pendingType === "access"}
              disabled={privacy.isPending}
              onPress={() => privacy.submit("access")}
            >
              {t("settings.privacyRequestCopy")}
            </RowButton>
          }
        />
        <SettingsRow
          id="data-deletion"
          label={t(key("requestDeletionLabel"))}
          description={describe(
            "deletion",
            t(key("requestDeletionDescription")),
          )}
          control={
            <AlertDialog open={deletionOpen} onOpenChange={setDeletionOpen}>
              <RowButton
                intent="danger"
                disabled={privacy.isPending}
                onPress={() => setDeletionOpen(true)}
              >
                {t("settings.privacyRequestDeletion")}
              </RowButton>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("settings.privacyDeletionTitle")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t(key("deletionDialogDescription"))}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                {privacy.failedType === "deletion" ? (
                  <p className="text-sm text-destructive" role="alert">
                    {t("settings.privacyRequestError")}
                  </p>
                ) : null}
                <AlertDialogFooter>
                  <AlertDialogCancel>
                    {t("agentChat.common.cancel")}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    disabled={privacy.isPending}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={(event) => {
                      event.preventDefault();
                      privacy.submit("deletion", () => setDeletionOpen(false));
                    }}
                  >
                    {privacy.pendingType === "deletion"
                      ? t("settings.privacyRequesting")
                      : t("settings.privacyRequestDeletion")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          }
        />
      </SettingsGroup>
      <a
        href={docsUrl("privacy-and-data-rights")}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 self-start px-1 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {t("settings.privacyDocsLink")}
        <IconExternalLink className="size-3" />
      </a>
    </div>
  );
}
