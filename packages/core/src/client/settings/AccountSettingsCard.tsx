import {
  ActionButton,
  Avatar,
  IconButton,
  TextField,
} from "@agent-native/toolkit/design-system";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@agent-native/toolkit/ui/alert-dialog";
import {
  IconCamera,
  IconCheck,
  IconDownload,
  IconExternalLink,
  IconLock,
  IconShieldLock,
  IconPencil,
  IconShieldCheck,
  IconTrash,
} from "@tabler/icons-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { docsUrl } from "../../shared/docs-url.js";
import type { UserProfile } from "../../user-profile/shared.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useT } from "../i18n.js";
import { useActionMutation, useActionQuery } from "../use-action.js";
import { useSession } from "../use-session.js";
import { cn } from "../utils.js";
import {
  passwordErrorText,
  profileInitials,
  twoFactorErrorText,
} from "./account/account-copy.js";
import {
  useAvatarUpload,
  useEmailChange,
  usePasswordForm,
  usePrivacyRequest,
  useTwoFactorSettings,
  type PrivacyRequestType,
} from "./account/account-hooks.js";
import { SchedulingTimezoneField } from "./SchedulingTimezoneField.js";
import { SettingsGroup, SettingsRow } from "./SettingsRow.js";
import { SettingsSkeleton } from "./SettingsSkeleton.js";

function TwoFactorSettings() {
  const t = useT();
  const {
    signedIn,
    enabled,
    setup,
    code,
    setCode,
    password,
    setPassword,
    pending,
    error: twoFactorError,
    saved,
    hasPassword,
    isLoading,
    startSetup,
    confirmSetup,
    turnOff,
  } = useTwoFactorSettings();

  if (!signedIn) return null;

  const error = twoFactorError ? twoFactorErrorText(t, twoFactorError) : null;

  const passwordField = hasPassword ? (
    <TextField
      id="agent-native-two-factor-password"
      type="password"
      label={t("settings.passwordCurrentLabel")}
      value={password}
      onChange={setPassword}
      placeholder={t("settings.passwordPlaceholder")}
      autoComplete="current-password"
      disabled={pending}
    />
  ) : null;

  const panel = isLoading ? (
    <SettingsSkeleton lines={2} />
  ) : setup ? (
    <div className="space-y-3">
      <p className="text-sm text-foreground">
        {t("settings.twoFactorSetupTitle")}
      </p>
      <QRCodeSVG
        value={setup.totpURI}
        size={176}
        fgColor="hsl(var(--foreground))"
        bgColor="hsl(var(--background))"
        className="rounded-md p-2"
        aria-label={t("settings.twoFactorQrLabel")}
      />
      <code className="block break-all rounded-md bg-muted p-2 text-[11px] text-muted-foreground">
        {setup.totpURI}
      </code>
      {!enabled && (
        <>
          <TextField
            id="agent-native-two-factor-code"
            type="text"
            label={t("settings.twoFactorCodeLabel")}
            value={code}
            onChange={(value) => setCode(value.replace(/\D/g, ""))}
            placeholder="000000"
            inputMode="numeric"
            autoComplete="one-time-code"
            disabled={pending}
          />
          <ActionButton
            type="button"
            intent="primary"
            emphasis="solid"
            size="compact"
            pending={pending}
            disabled={pending || !code}
            onPress={() => void confirmSetup()}
          >
            {t("settings.twoFactorVerify")}
          </ActionButton>
        </>
      )}
      {enabled && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {t("settings.twoFactorBackupCodes")}
          </p>
          <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-2 font-mono text-xs">
            {setup.backupCodes.map((backupCode) => (
              <code key={backupCode}>{backupCode}</code>
            ))}
          </div>
        </div>
      )}
    </div>
  ) : enabled ? (
    <div className="space-y-3">
      {passwordField}
      <ActionButton
        type="button"
        intent="danger"
        emphasis="outline"
        size="compact"
        pending={pending}
        disabled={pending || (hasPassword && !password)}
        onPress={() => void turnOff()}
      >
        {t("settings.twoFactorDisable")}
      </ActionButton>
    </div>
  ) : (
    <div className="space-y-3">
      {passwordField}
      <ActionButton
        type="button"
        intent="primary"
        emphasis="solid"
        size="compact"
        pending={pending}
        disabled={pending || (hasPassword && !password)}
        onPress={() => void startSetup()}
      >
        {t("settings.twoFactorEnable")}
      </ActionButton>
    </div>
  );

  return (
    <SettingsRow
      id="two-factor"
      label={
        <span className="flex items-center gap-2">
          <IconShieldLock className="size-4 text-muted-foreground" />
          {t("settings.twoFactorTitle")}
        </span>
      }
      description={
        error ? (
          <span className="text-destructive" role="alert">
            {error}
          </span>
        ) : saved ? (
          <span className="flex items-center gap-1 text-primary" role="status">
            <IconCheck className="size-3" />
            {t("settings.twoFactorSaved")}
          </span>
        ) : enabled ? (
          t("settings.twoFactorEnabled")
        ) : (
          t("settings.twoFactorDescription")
        )
      }
      control={
        <Popover>
          <PopoverTrigger asChild>
            <ActionButton
              type="button"
              intent="neutral"
              emphasis="outline"
              size="compact"
            >
              {t("settings.twoFactorManage")}
            </ActionButton>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={6}
            className="w-[min(460px,calc(100vw-2rem))] p-4"
          >
            {panel}
          </PopoverContent>
        </Popover>
      }
    />
  );
}

function PasswordSettings() {
  const t = useT();
  const { session } = useSession();
  const form = usePasswordForm();
  const {
    hasPassword,
    isLoading,
    currentPassword,
    newPassword,
    confirmPassword,
    saved,
    isPending,
  } = form;
  const error = passwordErrorText(t, form);

  if (!session?.email) return null;

  const passwordForm = isLoading ? (
    <SettingsSkeleton lines={2} />
  ) : form.loadFailed ? (
    <p className="text-xs text-destructive">
      {t("settings.passwordSaveError")}
    </p>
  ) : (
    <div className="space-y-3">
      {hasPassword && (
        <TextField
          id="agent-native-current-password"
          type="password"
          label={t("settings.passwordCurrentLabel")}
          value={currentPassword}
          onChange={form.setCurrentPassword}
          placeholder={t("settings.passwordPlaceholder")}
          autoComplete="current-password"
          disabled={isPending}
        />
      )}
      <TextField
        id="agent-native-new-password"
        type="password"
        label={t("settings.passwordNewLabel")}
        value={newPassword}
        onChange={form.setNewPassword}
        placeholder={t("settings.passwordPlaceholder")}
        autoComplete="new-password"
        disabled={isPending}
        invalid={!!error}
      />
      <TextField
        id="agent-native-confirm-password"
        type="password"
        label={t("settings.passwordConfirmLabel")}
        value={confirmPassword}
        onChange={form.setConfirmPassword}
        placeholder={t("settings.passwordPlaceholder")}
        autoComplete="new-password"
        disabled={isPending}
        invalid={!!error}
        errorMessage={error}
      />
      <div className="flex items-center justify-between gap-3">
        <div className="min-h-4 text-xs">
          {saved && (
            <p className="flex items-center gap-1 text-primary">
              <IconCheck className="size-3" />
              {t("settings.passwordSaved")}
            </p>
          )}
        </div>
        <ActionButton
          type="button"
          intent="primary"
          emphasis="solid"
          size="compact"
          pending={isPending}
          disabled={!form.canSubmit}
          onPress={() => form.submit()}
        >
          {isPending
            ? t("settings.passwordSaving")
            : hasPassword
              ? t("settings.passwordChange")
              : t("settings.passwordAdd")}
        </ActionButton>
      </div>
    </div>
  );

  return (
    <SettingsRow
      id="password"
      label={
        <span className="flex items-center gap-2">
          <IconLock className="size-4 text-muted-foreground" />
          {hasPassword
            ? t("settings.passwordChange")
            : t("settings.passwordTitle")}
        </span>
      }
      description={t("settings.passwordDescription")}
      control={
        <Popover>
          <PopoverTrigger asChild>
            <ActionButton
              type="button"
              intent="neutral"
              emphasis="outline"
              size="compact"
            >
              Manage
            </ActionButton>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={6}
            className="w-[min(420px,calc(100vw-2rem))] p-4"
          >
            {passwordForm}
          </PopoverContent>
        </Popover>
      }
    />
  );
}

function EmailSettings({ email }: { email: string }) {
  const t = useT();
  const [newEmail, setNewEmail] = useState(email);
  const {
    pending,
    status,
    setStatus,
    submit: requestChange,
  } = useEmailChange();

  useEffect(() => {
    setNewEmail(email);
    setStatus("idle");
  }, [email, setStatus]);

  const submit = async () => {
    const nextEmail = newEmail.trim();
    if (!nextEmail || nextEmail.toLowerCase() === email.toLowerCase()) return;
    await requestChange(nextEmail);
  };

  return (
    <SettingsRow
      id="email"
      label={t("settings.emailTitle")}
      description={
        status === "sent" ? (
          <span className="text-primary" role="status">
            {t("settings.emailChangeSent")}
          </span>
        ) : status === "error" ? (
          <span className="text-destructive" role="alert">
            {t("settings.emailChangeError")}
          </span>
        ) : (
          email
        )
      }
      control={
        <Popover>
          <PopoverTrigger asChild>
            <ActionButton
              type="button"
              intent="neutral"
              emphasis="outline"
              size="compact"
            >
              {t("settings.emailChange")}
            </ActionButton>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={6}
            className="w-[min(420px,calc(100vw-2rem))] p-4"
          >
            <div className="space-y-3">
              <TextField
                id="agent-native-new-email"
                type="email"
                label={t("settings.emailNewLabel")}
                value={newEmail}
                onChange={(value) => {
                  setStatus("idle");
                  setNewEmail(value);
                }}
                placeholder={t("settings.emailNewPlaceholder")}
                autoComplete="email"
                disabled={pending}
              />
              <div className="flex justify-end">
                <ActionButton
                  type="button"
                  intent="primary"
                  emphasis="solid"
                  size="compact"
                  pending={pending}
                  disabled={
                    pending ||
                    !newEmail.trim() ||
                    newEmail.trim().toLowerCase() === email.toLowerCase()
                  }
                  onPress={() => void submit()}
                >
                  {pending
                    ? t("settings.emailChanging")
                    : t("settings.emailChange")}
                </ActionButton>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      }
    />
  );
}

function PrivacySettings() {
  const t = useT();
  const privacy = usePrivacyRequest();
  const { pendingType, submittedType } = privacy;
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const submitRequest = (requestType: PrivacyRequestType) => {
    privacy.submit(requestType, (result) => {
      if (result.requestType === "deletion") setDeleteDialogOpen(false);
    });
  };

  return (
    <SettingsRow
      id="privacy-data"
      label={t("settings.privacyTitle")}
      icon={<IconShieldCheck className="size-4" />}
      description={
        submittedType ? (
          <span className="text-primary" role="status">
            {t("settings.privacyRequestRecorded")}
          </span>
        ) : (
          t("settings.privacyDescription")
        )
      }
      control={
        <Popover>
          <PopoverTrigger asChild>
            <ActionButton
              type="button"
              intent="neutral"
              emphasis="outline"
              size="compact"
            >
              {t("settings.privacyManage")}
            </ActionButton>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={6}
            className="w-[min(440px,calc(100vw-2rem))] p-4"
          >
            <div className="space-y-4">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {t("settings.privacyRightsTitle")}
                </p>
                <p className="text-sm leading-6 text-muted-foreground">
                  {t("settings.privacyRightsDescription")}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <ActionButton
                  type="button"
                  intent="neutral"
                  emphasis="outline"
                  size="compact"
                  leadingIcon={<IconDownload className="size-3.5" />}
                  pending={pendingType === "access"}
                  disabled={privacy.isPending}
                  onPress={() => submitRequest("access")}
                >
                  {submittedType === "access"
                    ? t("settings.privacyRequestRecordedShort")
                    : t("settings.privacyRequestCopy")}
                </ActionButton>
                <AlertDialog
                  open={deleteDialogOpen}
                  onOpenChange={setDeleteDialogOpen}
                >
                  <AlertDialogTrigger asChild>
                    <ActionButton
                      type="button"
                      intent="danger"
                      emphasis="outline"
                      size="compact"
                      leadingIcon={<IconTrash className="size-3.5" />}
                      disabled={privacy.isPending}
                    >
                      {t("settings.privacyRequestDeletion")}
                    </ActionButton>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t("settings.privacyDeletionTitle")}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("settings.privacyDeletionDescription")}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>
                        {t("common.cancel")}
                      </AlertDialogCancel>
                      <AlertDialogAction
                        disabled={privacy.isPending}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={(event) => {
                          event.preventDefault();
                          submitRequest("deletion");
                        }}
                      >
                        {pendingType === "deletion"
                          ? t("settings.privacyRequesting")
                          : t("settings.privacyRequestDeletion")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
              {privacy.failed && (
                <p className="text-xs text-destructive" role="alert">
                  {t("settings.privacyRequestError")}
                </p>
              )}
              <a
                href={docsUrl("privacy-and-data-rights")}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                {t("settings.privacyDocsLink")}
                <IconExternalLink className="size-3" />
              </a>
            </div>
          </PopoverContent>
        </Popover>
      }
    />
  );
}

export interface AccountSettingsFormProps {
  compact?: boolean;
}

export function AccountSettingsForm({
  compact = false,
}: AccountSettingsFormProps) {
  const t = useT();
  const { session } = useSession();
  const email = session?.email;
  const profileQuery = useActionQuery<UserProfile>(
    "get-user-profile",
    undefined,
    { enabled: !!email },
  );
  const updateProfile = useActionMutation<UserProfile, { name: string }>(
    "update-user-profile",
  );
  const {
    avatarUrl,
    uploading,
    status: photoStatus,
    upload,
  } = useAvatarUpload(email);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [savedName, setSavedName] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);
  const nameFieldEditedRef = useRef(false);

  const profileName = profileQuery.data?.name || session?.name || "";
  const displayName =
    name || profileName || email || t("settings.profileSignedOut");

  useEffect(() => {
    nameFieldEditedRef.current = false;
    setIsEditingName(false);
    setName("");
    setSavedName("");
  }, [email]);

  useEffect(() => {
    if (nameFieldEditedRef.current) return;
    setName(profileName);
    setSavedName(profileName);
  }, [email, profileName]);

  const handleAvatarChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void upload(file);
  };

  const handleProfileSave = () => {
    const nextName = name.trim();
    if (!nextName || !email || nextName === savedName.trim()) return;
    updateProfile.mutate(
      { name: nextName },
      {
        onSuccess: (profile) => {
          setName(profile.name);
          setSavedName(profile.name);
          nameFieldEditedRef.current = false;
          setIsEditingName(false);
        },
      },
    );
  };

  const handleProfileEdit = () => {
    updateProfile.reset();
    nameFieldEditedRef.current = false;
    setName(savedName);
    setIsEditingName(true);
  };

  const handleProfileCancel = () => {
    updateProfile.reset();
    nameFieldEditedRef.current = false;
    setName(savedName);
    setIsEditingName(false);
  };

  const canSaveName =
    !!email &&
    !updateProfile.isPending &&
    !!name.trim() &&
    name.trim() !== savedName.trim();

  const profileStatus =
    photoStatus === "saved" ? (
      <span className="text-primary">{t("settings.profilePhotoUpdated")}</span>
    ) : photoStatus === "error" ? (
      <span className="text-destructive">
        {t("settings.profilePhotoError")}
      </span>
    ) : email ? (
      email
    ) : undefined;

  return (
    <SettingsGroup
      id="account"
      title={t("settings.profileTitle")}
      description={t("settings.profileDescription")}
      className={cn(compact && "[&>div:last-child>div>div]:py-3")}
    >
      <SettingsRow
        id="profile"
        label={t("settings.profileTitle")}
        description={profileStatus}
        control={
          <div className="flex items-center gap-3">
            <Avatar
              name={displayName}
              src={avatarUrl}
              fallback={profileInitials(displayName)}
              size="default"
              className="size-10 shrink-0 rounded-full border border-border bg-accent font-semibold text-muted-foreground"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
            <ActionButton
              type="button"
              intent="neutral"
              emphasis="outline"
              size="compact"
              disabled={!email || uploading}
              leadingIcon={<IconCamera className="size-3.5" />}
              onPress={() => fileInputRef.current?.click()}
            >
              {uploading
                ? t("settings.profileUploading")
                : t("settings.profileChangePhoto")}
            </ActionButton>
          </div>
        }
      />
      {email && <EmailSettings email={email} />}
      <SettingsRow
        id="profile-name"
        label={t("settings.profileNameLabel")}
        description={
          updateProfile.isSuccess ? (
            <span className="text-primary">{t("settings.profileSaved")}</span>
          ) : updateProfile.error ? (
            <span className="text-destructive">
              {t("settings.profileSaveError")}
            </span>
          ) : (
            t("settings.profileNameDescription")
          )
        }
        control={
          isEditingName ? (
            <div className="flex w-full items-center gap-2 sm:w-80">
              <TextField
                id="agent-native-profile-name"
                value={name}
                onChange={(value) => {
                  nameFieldEditedRef.current = true;
                  updateProfile.reset();
                  setName(value);
                }}
                placeholder={t("settings.profileNamePlaceholder")}
                disabled={!email || updateProfile.isPending}
                autoFocus
                aria-label={t("settings.profileNameLabel")}
                className="min-w-0 flex-1"
                onKeyDown={(event) => {
                  if (event.key === "Escape") handleProfileCancel();
                }}
              />
              <ActionButton
                type="button"
                intent="primary"
                emphasis="solid"
                size="compact"
                pending={updateProfile.isPending}
                disabled={!canSaveName}
                onPress={handleProfileSave}
              >
                {updateProfile.isPending
                  ? t("settings.profileSaving")
                  : t("settings.profileSave")}
              </ActionButton>
            </div>
          ) : (
            <div className="flex w-full items-center justify-end gap-2 sm:w-80">
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {displayName}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <IconButton
                    type="button"
                    intent="neutral"
                    emphasis="ghost"
                    size="compact"
                    icon={<IconPencil size={14} />}
                    label={t("settings.profileNameEdit")}
                    title={t("settings.profileNameEdit")}
                    disabled={!email}
                    onPress={handleProfileEdit}
                  />
                </TooltipTrigger>
                <TooltipContent>{t("settings.profileNameEdit")}</TooltipContent>
              </Tooltip>
            </div>
          )
        }
      />
      <SettingsRow
        id="timezone"
        label={t("settings.timezoneLabel", { defaultValue: "Timezone" })}
        description={t("settings.timezoneHint", {
          defaultValue: "Used for timestamps and scheduled automations.",
        })}
        control={<SchedulingTimezoneField compact />}
      />
      <TwoFactorSettings />
      <PasswordSettings />
      {email && <PrivacySettings />}
    </SettingsGroup>
  );
}

export interface AccountSettingsCardProps {
  className?: string;
}

export function AccountSettingsCard({ className }: AccountSettingsCardProps) {
  return (
    <div className={cn("w-full", className)}>
      <AccountSettingsForm />
    </div>
  );
}
