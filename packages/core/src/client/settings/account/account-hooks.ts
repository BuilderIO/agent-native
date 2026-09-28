import { useCallback, useEffect, useState } from "react";

import { PASSWORD_MIN_LENGTH } from "../../../shared/password-policy.js";
import { requestEmailChange } from "../../auth/change-email.js";
import {
  disableTwoFactor,
  enableTwoFactor,
  getTwoFactorStatus,
  verifyTwoFactor,
  type TwoFactorSetup,
} from "../../auth/two-factor.js";
import { useActionMutation, useActionQuery } from "../../use-action.js";
import { uploadAvatar, useAvatarUrl } from "../../use-avatar.js";
import { useSession } from "../../use-session.js";

// State for the account rows, shared by today's Account card and the
// Profile and Security pages so both surfaces run the same requests.

interface AuthMethods {
  hasPassword: boolean;
}

interface PasswordMutationResult {
  status: boolean;
}

export type PrivacyRequestType = "access" | "deletion";

interface PrivacyRequestResult {
  requestType: PrivacyRequestType;
  status: "pending";
  requestedAt: number;
}

export function useAuthMethods() {
  const { session } = useSession();
  return useActionQuery<AuthMethods>("get-auth-methods", undefined, {
    enabled: !!session?.email,
  });
}

export type AvatarUploadStatus = "idle" | "saved" | "error";

export function useAvatarUpload(email: string | undefined) {
  const avatarUrl = useAvatarUrl(email);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<AvatarUploadStatus>("idle");

  const upload = useCallback(
    async (file: File) => {
      if (!email) return;
      setUploading(true);
      setStatus("idle");
      try {
        await uploadAvatar(file, email);
        setStatus("saved");
      } catch {
        setStatus("error");
      } finally {
        setUploading(false);
      }
    },
    [email],
  );

  return { avatarUrl, uploading, status, upload };
}

export type EmailChangeStatus = "idle" | "sent" | "error";

export function useEmailChange() {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<EmailChangeStatus>("idle");

  /** Resolves true once the auth server has sent the confirmation. */
  const submit = useCallback(async (newEmail: string): Promise<boolean> => {
    setPending(true);
    setStatus("idle");
    try {
      await requestEmailChange(newEmail);
      setStatus("sent");
      return true;
    } catch {
      setStatus("error");
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  return { pending, status, setStatus, submit };
}

export type PasswordValidationError = "length" | "mismatch";

export function usePasswordForm() {
  const authMethods = useAuthMethods();
  const setPasswordMutation = useActionMutation<
    PasswordMutationResult,
    { newPassword: string }
  >("set-password");
  const changePasswordMutation = useActionMutation<
    PasswordMutationResult,
    { currentPassword: string; newPassword: string }
  >("change-password");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [validationError, setValidationError] =
    useState<PasswordValidationError | null>(null);
  const [saved, setSaved] = useState(false);

  const hasPassword = authMethods.data?.hasPassword ?? false;
  const mutation = hasPassword ? changePasswordMutation : setPasswordMutation;
  const isPending =
    setPasswordMutation.isPending || changePasswordMutation.isPending;

  const clearStatus = () => {
    setSaved(false);
    setValidationError(null);
    setPasswordMutation.reset();
    changePasswordMutation.reset();
  };

  const reset = () => {
    clearStatus();
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const submit = (onSaved?: () => void) => {
    setSaved(false);
    setValidationError(null);
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setValidationError("length");
      return;
    }
    if (newPassword !== confirmPassword) {
      setValidationError("mismatch");
      return;
    }
    const onSuccess = () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSaved(true);
      void authMethods.refetch();
      onSaved?.();
    };
    if (hasPassword) {
      changePasswordMutation.mutate(
        { currentPassword, newPassword },
        { onSuccess },
      );
    } else {
      setPasswordMutation.mutate({ newPassword }, { onSuccess });
    }
  };

  return {
    hasPassword,
    isLoading: authMethods.isLoading,
    loadFailed: !!authMethods.error,
    currentPassword,
    newPassword,
    confirmPassword,
    setCurrentPassword: (value: string) => {
      clearStatus();
      setCurrentPassword(value);
    },
    setNewPassword: (value: string) => {
      clearStatus();
      setNewPassword(value);
    },
    setConfirmPassword: (value: string) => {
      clearStatus();
      setConfirmPassword(value);
    },
    validationError,
    saveFailed: !!mutation.error,
    saved,
    isPending,
    canSubmit:
      !isPending &&
      !!newPassword &&
      !!confirmPassword &&
      (!hasPassword || !!currentPassword),
    submit,
    reset,
  };
}

export type TwoFactorErrorFallback = "load" | "setup" | "code" | "disable";

export interface TwoFactorError {
  /** The auth server's message, when it sent one. */
  message: string | null;
  fallback: TwoFactorErrorFallback;
}

function twoFactorError(
  reason: unknown,
  fallback: TwoFactorErrorFallback,
): TwoFactorError {
  return {
    message: reason instanceof Error ? reason.message : null,
    fallback,
  };
}

export function useTwoFactorSettings() {
  const { session } = useSession();
  const authMethods = useAuthMethods();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TwoFactorError | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!session?.email) return;
    let active = true;
    void getTwoFactorStatus()
      .then((status) => {
        if (active) setEnabled(status.enabled);
      })
      .catch((reason: unknown) => {
        if (active) setError(twoFactorError(reason, "load"));
      });
    return () => {
      active = false;
    };
  }, [session?.email]);

  const hasPassword = authMethods.data?.hasPassword ?? false;

  const resetForm = () => {
    setError(null);
    setSaved(false);
    setPassword("");
    setCode("");
  };

  const startSetup = async () => {
    const currentPassword = password;
    setPending(true);
    resetForm();
    try {
      setSetup(
        await enableTwoFactor(hasPassword ? currentPassword : undefined),
      );
    } catch (reason) {
      setError(twoFactorError(reason, "setup"));
    } finally {
      setPending(false);
    }
  };

  const confirmSetup = async () => {
    if (!/^\d{6,8}$/.test(code.trim())) {
      setError({ message: null, fallback: "code" });
      return;
    }
    setPending(true);
    setError(null);
    try {
      await verifyTwoFactor(code.trim());
      setEnabled(true);
      setSaved(true);
    } catch (reason) {
      setError(twoFactorError(reason, "setup"));
    } finally {
      setPending(false);
    }
  };

  const turnOff = async (): Promise<boolean> => {
    setPending(true);
    setError(null);
    try {
      await disableTwoFactor(hasPassword ? password : undefined);
      setEnabled(false);
      setSetup(null);
      setSaved(false);
      setPassword("");
      return true;
    } catch (reason) {
      setError(twoFactorError(reason, "disable"));
      return false;
    } finally {
      setPending(false);
    }
  };

  /**
   * Drops an unfinished or finished setup, e.g. when its dialog closes. A
   * finished one keeps `saved` so the row can still say it is on.
   */
  const dismissSetup = () => {
    setSetup(null);
    setError(null);
    setPassword("");
    setCode("");
  };

  return {
    signedIn: !!session?.email,
    enabled,
    setup,
    code,
    setCode,
    password,
    setPassword: (value: string) => {
      setError(null);
      setPassword(value);
    },
    pending,
    error,
    saved,
    hasPassword,
    isLoading: enabled === null || authMethods.isLoading,
    startSetup,
    confirmSetup,
    turnOff,
    dismissSetup,
  };
}

export function usePrivacyRequest() {
  const mutation = useActionMutation<
    PrivacyRequestResult,
    { requestType: PrivacyRequestType }
  >("request-privacy-right");
  const [pendingType, setPendingType] = useState<PrivacyRequestType | null>(
    null,
  );
  const [submittedType, setSubmittedType] = useState<PrivacyRequestType | null>(
    null,
  );
  const [recorded, setRecorded] = useState<
    Partial<Record<PrivacyRequestType, true>>
  >({});
  const [failedType, setFailedType] = useState<PrivacyRequestType | null>(null);

  const submit = (
    requestType: PrivacyRequestType,
    onRecorded?: (result: PrivacyRequestResult) => void,
  ) => {
    mutation.reset();
    setFailedType(null);
    setPendingType(requestType);
    mutation.mutate(
      { requestType },
      {
        onSuccess: (result) => {
          setSubmittedType(result.requestType);
          setRecorded((current) => ({
            ...current,
            [result.requestType]: true,
          }));
          onRecorded?.(result);
        },
        onError: () => setFailedType(requestType),
        onSettled: () => setPendingType(null),
      },
    );
  };

  return {
    submit,
    pendingType,
    /** The most recent request recorded in this session. */
    submittedType,
    /** Every request type recorded in this session. */
    recorded,
    failedType,
    isPending: mutation.isPending,
    failed: !!mutation.error,
  };
}
