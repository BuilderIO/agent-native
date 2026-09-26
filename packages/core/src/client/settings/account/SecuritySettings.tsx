import { Alert, AlertDescription } from "@agent-native/toolkit/ui/alert";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import { Button } from "@agent-native/toolkit/ui/button";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { IconExternalLink } from "@tabler/icons-react";
import { QRCodeSVG } from "qrcode.react";
import { useState, type ComponentProps, type ReactNode } from "react";

import { docsUrl } from "../../../shared/docs-url.js";
import { PASSWORD_MIN_LENGTH } from "../../../shared/password-policy.js";
import {
  Dialog,
  DialogContent,
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

const TWO_FACTOR_CODE = /^\d{6,8}$/;

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

/** A dialog field: label, control, and one line for its hint or error. */
function Field({
  id,
  label,
  message,
  invalid,
  ...inputProps
}: Omit<ComponentProps<typeof Input>, "id" | "size"> & {
  id: string;
  label: string;
  /** The hint, or the error while `invalid`. */
  message?: string;
  invalid?: boolean;
}) {
  const messageId = message ? `${id}-message` : undefined;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={invalid || undefined}
        aria-describedby={messageId}
        {...inputProps}
      />
      {message ? (
        <p
          id={messageId}
          className={
            invalid
              ? "text-sm text-destructive"
              : "text-sm text-muted-foreground"
          }
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

function ErrorAlert({ children }: { children: ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

/** The dialog's primary action: a spinner and the pending label while it runs. */
function SubmitButton({
  pending,
  pendingLabel,
  disabled,
  variant = "default",
  children,
}: {
  pending?: boolean;
  pendingLabel?: string;
  disabled?: boolean;
  variant?: "default" | "destructive";
  children: ReactNode;
}) {
  return (
    <Button type="submit" variant={variant} disabled={disabled || pending}>
      {pending ? <Spinner aria-hidden="true" /> : null}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
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
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!signedIn || form.isLoading || form.loadFailed}
            onClick={() => openDialog(true)}
          >
            {actionLabel}
          </Button>
          <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
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
                <Field
                  id="agent-native-current-password"
                  type="password"
                  label={t(key("currentPassword"))}
                  value={form.currentPassword}
                  onChange={(event) =>
                    form.setCurrentPassword(event.currentTarget.value)
                  }
                  autoComplete="current-password"
                  autoFocus
                  required
                  readOnly={form.isPending}
                />
              ) : null}
              <Field
                id="agent-native-new-password"
                type="password"
                label={t(key("newPassword"))}
                value={form.newPassword}
                onChange={(event) =>
                  form.setNewPassword(event.currentTarget.value)
                }
                autoComplete="new-password"
                autoFocus={!form.hasPassword}
                required
                readOnly={form.isPending}
                message={t(key("passwordMinLength"), {
                  count: PASSWORD_MIN_LENGTH,
                })}
                invalid={form.validationError === "length"}
              />
              <Field
                id="agent-native-confirm-password"
                type="password"
                label={t(key("confirmPassword"))}
                value={form.confirmPassword}
                onChange={(event) =>
                  form.setConfirmPassword(event.currentTarget.value)
                }
                autoComplete="new-password"
                required
                readOnly={form.isPending}
                message={
                  form.validationError === "mismatch"
                    ? t(key("passwordMismatch"))
                    : undefined
                }
                invalid={form.validationError === "mismatch"}
              />
              {form.saveFailed ? (
                <ErrorAlert>{t(key("passwordSaveError"))}</ErrorAlert>
              ) : null}
              <DialogFooter className="gap-2 sm:space-x-0">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => openDialog(false)}
                >
                  {t("agentChat.common.cancel")}
                </Button>
                <SubmitButton
                  pending={form.isPending}
                  pendingLabel={t("agentChat.common.saving")}
                  disabled={!form.canSubmit}
                >
                  {t(key("savePassword"))}
                </SubmitButton>
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
    <Field
      id="agent-native-two-factor-password"
      type="password"
      label={t(key("currentPassword"))}
      value={twoFactor.password}
      onChange={(event) => twoFactor.setPassword(event.currentTarget.value)}
      autoComplete="current-password"
      autoFocus
      required
      readOnly={pending}
    />
  ) : null;

  const cancel = (
    <Button type="button" variant="secondary" onClick={() => openDialog(false)}>
      {t("agentChat.common.cancel")}
    </Button>
  );
  const needsPassword = hasPassword && !twoFactor.password;
  const errorAlert =
    error && !loadFailed ? <ErrorAlert>{error}</ErrorAlert> : null;

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
    footer = <SubmitButton>{t(key("done"))}</SubmitButton>;
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
        <code className="block break-all rounded-md bg-muted p-2 font-mono text-xs text-muted-foreground">
          {setup.totpURI}
        </code>
        <Field
          id="agent-native-two-factor-code"
          type="text"
          label={t(key("authenticatorCode"))}
          value={twoFactor.code}
          onChange={(event) =>
            twoFactor.setCode(event.currentTarget.value.replace(/\D/g, ""))
          }
          inputMode="numeric"
          maxLength={8}
          autoComplete="one-time-code"
          autoFocus
          required
          readOnly={pending}
          message={error ?? t(key("twoFactorCodeError"))}
          invalid={!!error}
        />
      </div>
    );
    onSubmit = () => void twoFactor.confirmSetup();
    footer = (
      <>
        {cancel}
        <SubmitButton
          pending={pending}
          pendingLabel={t(key("verifying"))}
          disabled={!TWO_FACTOR_CODE.test(twoFactor.code)}
        >
          {t(key("verifyAndEnable"))}
        </SubmitButton>
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
        {errorAlert}
      </div>
    );
    onSubmit = () =>
      void twoFactor.turnOff().then((done) => {
        if (done) openDialog(false);
      });
    footer = (
      <>
        {cancel}
        <SubmitButton
          variant="destructive"
          pending={pending}
          pendingLabel={t(key("turningOff"))}
          disabled={needsPassword}
        >
          {t(key("turnOffTwoFactor"))}
        </SubmitButton>
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
        {errorAlert}
      </div>
    );
    onSubmit = () => void twoFactor.startSetup();
    footer = (
      <>
        {cancel}
        <SubmitButton
          pending={pending}
          pendingLabel={t(key("settingUp"))}
          disabled={needsPassword}
        >
          {t("agentChat.common.continue")}
        </SubmitButton>
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
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!signedIn || isLoading || loadFailed}
            onClick={() => openDialog(true)}
          >
            {enabled ? t(key("manage")) : t(key("setUpTwoFactor"))}
          </Button>
          <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
            </DialogHeader>
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!pending) onSubmit();
              }}
            >
              {body}
              <DialogFooter className="gap-2 sm:space-x-0">
                {footer}
              </DialogFooter>
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
  const deletionPending = privacy.pendingType === "deletion";
  const accessPending = privacy.pendingType === "access";

  const describe = (type: PrivacyRequestType, fallback: string) =>
    privacy.failedType === type ? (
      <StatusText tone="error">{t("settings.privacyRequestError")}</StatusText>
    ) : privacy.recorded[type] ? (
      <StatusText tone="ok">{t("settings.privacyRequestRecorded")}</StatusText>
    ) : (
      fallback
    );

  return (
    <div className="flex flex-col gap-2.5">
      <SettingsGroup id="your-data" title={t(key("yourData"))}>
        <SettingsRow
          id="data-copy"
          label={t(key("requestCopyLabel"))}
          description={describe("access", t(key("requestCopyDescription")))}
          control={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={privacy.isPending}
              onClick={() => privacy.submit("access")}
            >
              {accessPending ? <Spinner aria-hidden="true" /> : null}
              {accessPending
                ? t("settings.privacyRequesting")
                : t("settings.privacyRequestCopy")}
            </Button>
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
            <AlertDialog
              open={deletionOpen}
              onOpenChange={(next) => {
                if (!deletionPending) setDeletionOpen(next);
              }}
            >
              <Button
                type="button"
                variant="secondary-destructive"
                size="sm"
                disabled={privacy.isPending}
                onClick={() => setDeletionOpen(true)}
              >
                {t("settings.privacyRequestDeletion")}
              </Button>
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
                  <ErrorAlert>{t("settings.privacyRequestError")}</ErrorAlert>
                ) : null}
                <AlertDialogFooter className="gap-2 sm:space-x-0">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={deletionPending}
                    onClick={() => setDeletionOpen(false)}
                  >
                    {t("agentChat.common.cancel")}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={privacy.isPending}
                    onClick={() =>
                      privacy.submit("deletion", () => setDeletionOpen(false))
                    }
                  >
                    {deletionPending ? <Spinner aria-hidden="true" /> : null}
                    {deletionPending
                      ? t("settings.privacyRequesting")
                      : t("settings.privacyRequestDeletion")}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          }
        />
      </SettingsGroup>
      <Button asChild variant="link" size="xs" className="self-start">
        <a
          href={docsUrl("privacy-and-data-rights")}
          target="_blank"
          rel="noreferrer"
        >
          {t("settings.privacyDocsLink")}
          <IconExternalLink aria-hidden="true" />
        </a>
      </Button>
    </div>
  );
}
