import { resolveNativeAuthCopy } from "@agent-native/core/shared/auth-copy";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";

import { MobileSheet } from "@/components/MobileSheet";
import { SafeAreaView } from "@/components/uniwind-interop";
import { useMobileThemeColors } from "@/lib/mobile-colors";
import {
  authenticateWithPassword,
  signInWithGoogle,
  signInWithMagicLink,
} from "@/lib/native-auth";
import { refreshWorkspaceApps } from "@/lib/workspace-apps";

function GoogleLogo() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" aria-hidden>
      {/* guard:allow-raw-color - Google's official brand mark colors. */}
      <Path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      {/* guard:allow-raw-color - Google's official brand mark colors. */}
      <Path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      {/* guard:allow-raw-color - Google's official brand mark colors. */}
      <Path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      {/* guard:allow-raw-color - Google's official brand mark colors. */}
      <Path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </Svg>
  );
}

export function NativeSignInSheet({
  visible,
  onClose,
  onSignedIn,
}: {
  visible: boolean;
  onClose: () => void;
  onSignedIn: () => void | Promise<void>;
}) {
  const { mutedForeground } = useMobileThemeColors();
  const copy = resolveNativeAuthCopy(
    Intl.DateTimeFormat().resolvedOptions().locale,
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"magic-link" | "password">(
    "magic-link",
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [magicSubmitting, setMagicSubmitting] = useState(false);
  const [magicLinkSentEmail, setMagicLinkSentEmail] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!visible) {
      setError(null);
      setSubmitting(false);
      setGoogleSubmitting(false);
      setMagicSubmitting(false);
      setPassword("");
      setAuthMode("magic-link");
      setMagicLinkSentEmail(null);
    }
  }, [visible]);

  const submit = async () => {
    if (
      submitting ||
      googleSubmitting ||
      magicSubmitting ||
      !email.trim() ||
      (authMode === "password" && !password)
    ) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await authenticateWithPassword({
        mode: "sign-in",
        email: email.trim(),
        password,
      });
      await refreshWorkspaceApps();
      await onSignedIn();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : copy.failedToConnect,
      );
    } finally {
      setSubmitting(false);
    }
  };

  const submitGoogle = async () => {
    if (submitting || googleSubmitting || magicSubmitting) return;
    setGoogleSubmitting(true);
    setError(null);
    try {
      await signInWithGoogle();
      await refreshWorkspaceApps();
      await onSignedIn();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : copy.googleNeverFinished,
      );
    } finally {
      setGoogleSubmitting(false);
    }
  };

  const submitMagicLink = async () => {
    if (submitting || googleSubmitting || magicSubmitting) return;
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setError(copy.invalidEmail);
      return;
    }
    setMagicSubmitting(true);
    setMagicLinkSentEmail(normalizedEmail);
    setError(null);
    try {
      await signInWithMagicLink({ email: normalizedEmail });
      await refreshWorkspaceApps();
      await onSignedIn();
    } catch (nextError) {
      setMagicLinkSentEmail(null);
      setError(
        nextError instanceof Error ? nextError.message : copy.magicLinkFailed,
      );
    } finally {
      setMagicSubmitting(false);
    }
  };

  const busy = submitting || googleSubmitting || magicSubmitting;
  const canSubmit = Boolean(
    email.trim() && (authMode === "magic-link" || password),
  );

  return (
    <MobileSheet
      visible={visible}
      onClose={onClose}
      motion="sheet"
      contentClassName="rounded-t-[26px] border border-border bg-card"
      overlayClassName="bg-black/55"
      accessibilityLabel={copy.close}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <SafeAreaView edges={["bottom"]}>
          <View className="px-5 pt-3">
            <View className="self-center h-1 w-10 rounded-full bg-zinc-600" />
            <View className="items-end py-4">
              <Pressable
                className="px-1 py-1 active:opacity-75"
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={copy.close}
              >
                <Text className="text-text-muted text-[15px] font-medium">
                  {copy.close}
                </Text>
              </Pressable>
            </View>

            {magicLinkSentEmail && magicSubmitting ? (
              <View className="items-center py-8">
                <Text className="text-white text-[18px] font-semibold">
                  {copy.magicLinkSent}
                </Text>
                <Text className="mt-2 text-center text-text-muted text-[13px]">
                  {copy.magicLinkSentCopy} {magicLinkSentEmail}.
                </Text>
                <Pressable
                  className="mt-5 h-9 items-center justify-center active:opacity-75"
                  onPress={() => setMagicLinkSentEmail(null)}
                  accessibilityRole="button"
                  accessibilityLabel={copy.back}
                >
                  <Text className="text-text-muted text-[13px] font-medium underline">
                    {copy.back}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Pressable
                  className="mb-3 h-12 flex-row items-center justify-center gap-3 rounded-xl bg-primary active:opacity-75"
                  onPress={() => void submitGoogle()}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={copy.googleButton}
                >
                  {googleSubmitting ? (
                    <ActivityIndicator color={mutedForeground} />
                  ) : (
                    <>
                      <GoogleLogo />
                      <Text className="text-primary-foreground text-[15px] font-semibold">
                        {copy.googleButton}
                      </Text>
                    </>
                  )}
                </Pressable>

                <View className="mb-3 flex-row items-center gap-3">
                  <View className="h-px flex-1 bg-border-dark" />
                  <Text className="text-text-muted text-[12px]">
                    {copy.dividerOr}
                  </Text>
                  <View className="h-px flex-1 bg-border-dark" />
                </View>

                <TextInput
                  className="mb-3 h-12 rounded-xl border border-border-dark bg-background-dark px-3.5 text-white"
                  value={email}
                  onChangeText={(value) => {
                    setEmail(value);
                    setError(null);
                  }}
                  placeholder={copy.emailPlaceholder}
                  placeholderTextColor={mutedForeground}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  autoComplete="email"
                  accessibilityLabel={copy.email}
                  onSubmitEditing={() =>
                    void (authMode === "password"
                      ? submit()
                      : submitMagicLink())
                  }
                  returnKeyType={authMode === "password" ? "next" : "done"}
                />

                {authMode === "password" ? (
                  <TextInput
                    className="mb-2 h-12 rounded-xl border border-border-dark bg-background-dark px-3.5 text-white"
                    value={password}
                    onChangeText={(value) => {
                      setPassword(value);
                      setError(null);
                    }}
                    placeholder={copy.enterPasswordPlaceholder}
                    placeholderTextColor={mutedForeground}
                    secureTextEntry
                    textContentType="password"
                    autoComplete="password"
                    accessibilityLabel={copy.password}
                    onSubmitEditing={() => void submit()}
                    returnKeyType="go"
                  />
                ) : null}

                {error ? (
                  <Text className="mb-2 text-error-text text-[13px]">
                    {error}
                  </Text>
                ) : null}

                <Pressable
                  className={`mb-2 h-12 items-center justify-center rounded-xl ${canSubmit && !busy ? "bg-primary active:opacity-75" : "bg-zinc-800"}`}
                  onPress={() =>
                    void (authMode === "password"
                      ? submit()
                      : submitMagicLink())
                  }
                  disabled={!canSubmit || busy}
                  accessibilityRole="button"
                  accessibilityLabel={
                    authMode === "password" ? copy.signIn : copy.sendMagicLink
                  }
                >
                  {busy && (authMode === "password" || magicSubmitting) ? (
                    <ActivityIndicator color={mutedForeground} />
                  ) : (
                    <Text
                      className={`text-[15px] font-semibold ${canSubmit && !busy ? "text-primary-foreground" : "text-zinc-500"}`}
                    >
                      {authMode === "password"
                        ? copy.signIn
                        : copy.sendMagicLink}
                    </Text>
                  )}
                </Pressable>

                <Pressable
                  className="mb-3 h-9 items-center justify-center active:opacity-75"
                  onPress={() => {
                    setAuthMode((current) =>
                      current === "magic-link" ? "password" : "magic-link",
                    );
                    setPassword("");
                    setError(null);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={
                    authMode === "password"
                      ? copy.backToMagicLink
                      : copy.usePasswordInstead
                  }
                >
                  <Text className="text-text-muted text-[13px] font-medium underline">
                    {authMode === "password"
                      ? copy.backToMagicLink
                      : copy.usePasswordInstead}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </MobileSheet>
  );
}
