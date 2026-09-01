/**
 * First-run onboarding page for agent-native apps.
 *
 * Shown when Better Auth is active and the user isn't signed in.
 * Provides a path to create or sign into an account from day one.
 *
 * After first account exists, this page acts as a normal login page.
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { getAppConfig, resolveAppHomePath } from "../app-config/index.js";
import {
  AuthPage,
  type AuthPageProps,
  type AuthView,
} from "../client/auth/AuthPage.js";
import { ResetPasswordPage } from "../client/auth/ResetPasswordPage.js";
import { getLocaleInitScript } from "../localization/server.js";
import {
  DEFAULT_LOCALE,
  LOCALE_METADATA,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  localeDisplayName,
  type LocaleCode,
} from "../localization/shared.js";
import { NATIVE_AUTH_COPY } from "../shared/auth-copy.js";
import { docsUrl } from "../shared/docs-url.js";
import {
  BETA_FORCE_QUERY_PARAM,
  BETA_FORCE_SESSION_STORAGE_KEY,
  BETA_OPT_OUT_DURATION_MS,
  BETA_OPT_OUT_QUERY_PARAM,
  BETA_OPT_OUT_STORAGE_KEY,
  ENVIRONMENT_BETA_HOSTS,
} from "../shared/environment-lanes.js";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "../shared/password-policy.js";
import {
  AGENT_NATIVE_SOCIAL_IMAGE_ALT,
  AGENT_NATIVE_SOCIAL_IMAGE_HEIGHT,
  AGENT_NATIVE_SOCIAL_IMAGE_PATH,
  AGENT_NATIVE_SOCIAL_IMAGE_TYPE,
  AGENT_NATIVE_SOCIAL_IMAGE_WIDTH,
  withAgentNativeSocialImageCacheBuster,
} from "../shared/social-meta.js";
import {
  getAppBasePathFromViteEnv,
  normalizeAppBasePath,
} from "./app-base-path.js";
import {
  AUTH_MARKETING_LOCALE_COPY,
  type AuthMarketingLocaleCopy,
} from "./auth-marketing-locales.js";
import {
  BUILT_IN_AUTH_MARKETING,
  resolveBuiltInAuthMarketing,
  resolveBuiltInAuthMarketingSlug,
  type AuthMarketingContent,
} from "./auth-marketing.js";
import {
  resolveGoogleAuthMode,
  type GoogleAuthMode,
} from "./google-auth-mode.js";
import { hasGoogleSignInCredentials } from "./google-oauth-credentials.js";
import { identitySsoLoginButtonHtml } from "./identity-sso-store.js";
import { getPublicOAuthOrigin } from "./oauth-public-origin.js";
import { getWorkspaceGatewayReturnOrigin } from "./oauth-return-url.js";

declare const __AGENT_NATIVE_BUILD_ID__: string | undefined;
function hasGoogleOAuth(): boolean {
  return hasGoogleSignInCredentials();
}

function getConnectionLabel(): string {
  const url = process.env.DATABASE_URL || "";
  if (!url) return "SQLite (local file)";
  if (url.startsWith("pglite:")) return "PGlite (local Postgres)";
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    if (url.includes("neon.tech")) return "Neon Postgres";
    if (url.includes("supabase")) return "Supabase Postgres";
    return "Postgres";
  }
  if (url.startsWith("file:")) return "SQLite (local file)";
  if (url.startsWith("libsql://") || url.includes("turso.io")) return "Turso";
  return "SQL database";
}

function isWorkspaceRuntime(): boolean {
  const workspace = getAppConfig().workspace;
  return (
    workspace.isWorkspace === true || typeof workspace.appsJson === "string"
  );
}

function workspaceBasePathFromRequest(requestPath: string | undefined): string {
  if (!isWorkspaceRuntime() || !requestPath) return "";
  const pathname = requestPath.split(/[?#]/, 1)[0] || "/";
  const firstSegment = pathname.split("/").find(Boolean);
  if (
    !firstSegment ||
    firstSegment === "_agent-native" ||
    firstSegment === "api" ||
    firstSegment === "sign-in" ||
    firstSegment === "login" ||
    firstSegment === "signup"
  ) {
    return "";
  }
  return normalizeAppBasePath(`/${firstSegment}`);
}

function withAppBasePath(path: string, explicitBasePath?: string): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const basePath = explicitBasePath ?? getAppBasePathFromViteEnv();
  return `${basePath}${cleanPath}`;
}

const AGENT_NATIVE_TERMS_URL = "https://www.agent-native.com/terms";
const AGENT_NATIVE_PRIVACY_URL = "https://www.agent-native.com/privacy";
const BUILDER_PREVIEW_LOCAL_DEV_ENV =
  "AGENT_NATIVE_ALLOW_BUILDER_PREVIEW_LOCAL_DEV";

function isBuilderPreviewLocalDevEnabled(): boolean {
  if (
    process.env.NODE_ENV !== "development" &&
    process.env.NODE_ENV !== "test"
  ) {
    return false;
  }
  const value = process.env[BUILDER_PREVIEW_LOCAL_DEV_ENV]
    ?.trim()
    .toLowerCase();
  return value === "1" || value === "true";
}

const EN_AUTH_COPY = {
  ...NATIVE_AUTH_COPY["en-US"],
  languageLabel: "Language",
  systemLanguage: "System",
  pageTitleSignIn: "Sign in",
  pageTitleWelcome: "Welcome",
  welcomeTitle: "Welcome",
  signInTitle: "Sign in",
  welcomeBackTitle: "Welcome back",
  checkEmailTitle: "Check your email",
  resetPasswordTitle: "Reset password",
  createAccountSubtitle: "Create an account to get started",
  googleOnlySubtitle: "Use your workspace Google account to continue",
  signInSubtitle: "Sign in to your account",
  finishAccountSubtitle: "Finish creating your account",
  resetPasswordSubtitle: "Reset your password",
  upgradeCopy:
    "Continue signing in to attach this app to your account and migrate local data.",
  createAccount: "Create account",
  passwordMinPlaceholder: `At least ${PASSWORD_MIN_LENGTH} characters`,
  confirmPasswordPlaceholder: "Confirm password",
  magicLinkTitle: NATIVE_AUTH_COPY["en-US"].welcomeTitle,
  magicLinkSubtitle: NATIVE_AUTH_COPY["en-US"].welcomeSubtitle,
  signupProgress: "Signup progress",
  progressAccount: "Account",
  progressVerify: "Verify",
  progressStart: "Start",
  verificationSent: "Verification email sent",
  verifyCopyPrefix: "We sent a secure link to",
  verifyCopySuffix:
    ". Click it, return here, and this app will finish signing you in automatically.",
  verificationNote:
    "You can keep this tab open. If it has not refreshed after you come back, use Continue.",
  continue: "Continue",
  resendEmail: "Resend email",
  sendResetLink: "Send reset link",
  backToSignIn: "Back to sign in",
  localNotePrefix: "Your account is stored in this app's own DB",
  localNoteSuffix: ", not a third-party service.",
  localDevButton: "Continue as local dev",
  localDevDescription: "Only works in local development on this computer.",
  localDevHelp: "Learn about local development sign-in",
  localDevSigningIn: "Signing in locally…",
  localDevFailed: "Local development sign-in is unavailable.",
  localDevFullOptions: "Show full sign in options",
  openSource: "100% free and open source",
  useOwnGoogleClient: "Use your own Google OAuth client:",
  copyCommand: "Copy command",
  copied: "Copied",
  closeGoogleChoices: "Close Google sign-in choices",
  signInToContinue: "Sign in to continue.",
  finishSignInFailed:
    "We couldn't finish signing you in. Please sign in manually.",
  enterPasswordAfterVerification:
    "Enter your password after verifying your email.",
  finishSignInManually:
    "We couldn't finish signing you in automatically. Sign in to continue.",
  stillWaitingVerification:
    "Still waiting on verification. Click the link in your email, then try Continue again.",
  checkVerificationFailed:
    "We couldn't check your verification status. Please try again.",
  verificationLinkInvalid:
    "This verification link is invalid or expired. Request a new one.",
  checkingVerification: "Checking your verification...",
  sent: "Sent",
  sentVerification: "Sent a fresh verification link.",
  resendVerificationFailed:
    "We couldn't resend the verification email. Please try again.",
  networkErrorRetry:
    "We couldn't reach the server. Check your connection and try again.",
  networkErrorDashRetry:
    "We couldn't reach the server. Check your connection and try again.",
  passwordsMismatch: "Passwords do not match.",
  creatingAccount: "Creating account…",
  registrationFailed: "We couldn't create your account. Please try again.",
  accountCreatedSigningIn: "Account created — signing you in…",
  emailVerifiedFinishing: "Email verified. Finishing sign-in...",
  emailVerifiedSignIn: "Email verified. Sign in to continue.",
  resetEmailSent: "If that email exists, a reset link is on its way.",
  resetEmailFailed:
    "We couldn't send a password reset email. Check your email and try again.",
  googleNotConfigured: "Google sign-in is not available right now.",
  migrateLocalFallback: "Continue signing in to migrate local data.",
  googlePopupHelp: "Allow popups for this site and try again",
};

const AUTH_LOCALE_COPY: Record<LocaleCode, typeof EN_AUTH_COPY> = {
  "en-US": EN_AUTH_COPY,
  "zh-CN": {
    ...NATIVE_AUTH_COPY["zh-CN"],
    languageLabel: "语言",
    systemLanguage: "系统",
    pageTitleSignIn: "登录",
    pageTitleWelcome: "欢迎",
    welcomeTitle: "欢迎",
    signInTitle: "登录",
    welcomeBackTitle: "欢迎回来",
    checkEmailTitle: "检查你的邮箱",
    resetPasswordTitle: "重置密码",
    createAccountSubtitle: "创建账户即可开始",
    googleOnlySubtitle: "使用你的工作区 Google 账户继续",
    signInSubtitle: "登录你的账户",
    finishAccountSubtitle: "完成账户创建",
    resetPasswordSubtitle: "重置你的密码",
    upgradeCopy: "继续登录，将此应用关联到你的账户并迁移本地数据。",
    createAccount: "创建账户",
    passwordMinPlaceholder: `至少 ${PASSWORD_MIN_LENGTH} 个字符`,
    confirmPasswordPlaceholder: "确认密码",
    magicLinkTitle: NATIVE_AUTH_COPY["zh-CN"].welcomeTitle,
    magicLinkSubtitle: NATIVE_AUTH_COPY["zh-CN"].welcomeSubtitle,
    signupProgress: "注册进度",
    progressAccount: "账户",
    progressVerify: "验证",
    progressStart: "开始",
    verificationSent: "验证邮件已发送",
    verifyCopyPrefix: "我们已向",
    verifyCopySuffix: "发送安全链接。点击链接后回到这里，应用会自动完成登录。",
    verificationNote:
      "你可以保持此标签页打开。如果回来后没有自动刷新，请点击继续。",
    continue: "继续",
    resendEmail: "重新发送邮件",
    sendResetLink: "发送重置链接",
    backToSignIn: "返回登录",
    localNotePrefix: "你的账户存储在此应用自己的数据库中",
    localNoteSuffix: "，而不是第三方服务。",
    localDevButton: "以本地开发身份继续",
    localDevDescription: "仅在此计算机的本地开发环境中有效。",
    localDevHelp: "了解本地开发登录",
    localDevSigningIn: "正在本地登录…",
    localDevFailed: "本地开发登录不可用。",
    localDevFullOptions: "显示完整登录选项",
    openSource: "100% 免费且开源",
    useOwnGoogleClient: "使用你自己的 Google OAuth 客户端：",
    copyCommand: "复制命令",
    copied: "已复制",
    closeGoogleChoices: "关闭 Google 登录选项",
    signInToContinue: "登录以继续。",
    finishSignInFailed: "无法自动完成登录。",
    enterPasswordAfterVerification: "验证邮箱后请输入密码。",
    finishSignInManually: "无法自动完成登录。请登录以继续。",
    stillWaitingVerification:
      "仍在等待验证。请点击邮件中的链接，然后再次点击继续。",
    checkVerificationFailed: "无法检查验证状态。请重试。",
    verificationLinkInvalid: "此验证链接无效或已过期。请重新请求一个。",
    checkingVerification: "正在检查验证状态...",
    sent: "已发送",
    sentVerification: "新的验证链接已发送。",
    resendVerificationFailed: "无法重新发送验证邮件。",
    networkErrorRetry: "网络错误。请重试。",
    networkErrorDashRetry: "网络错误 — 请重试",
    passwordsMismatch: "两次输入的密码不一致",
    creatingAccount: "正在创建账户…",
    registrationFailed: "注册失败",
    accountCreatedSigningIn: "账户已创建 — 正在登录…",
    emailVerifiedFinishing: "邮箱已验证。正在完成登录...",
    emailVerifiedSignIn: "邮箱已验证。请登录以继续。",
    resetEmailSent: "如果该邮箱存在，重置链接已在发送途中。",
    resetEmailFailed: "无法发送重置邮件。",
    googleNotConfigured: "Google OAuth 未配置。",
    migrateLocalFallback: "继续登录以迁移本地数据。",
    googlePopupHelp: "请允许此网站弹出窗口后重试",
  },
  "zh-TW": {
    ...NATIVE_AUTH_COPY["zh-TW"],
    languageLabel: "語言",
    systemLanguage: "系統",
    pageTitleSignIn: "登入",
    pageTitleWelcome: "歡迎",
    welcomeTitle: "歡迎",
    signInTitle: "登入",
    welcomeBackTitle: "歡迎回來",
    checkEmailTitle: "檢查你的電子郵件",
    resetPasswordTitle: "重設密碼",
    createAccountSubtitle: "建立帳號即可開始",
    googleOnlySubtitle: "使用你的工作區 Google 帳號繼續",
    signInSubtitle: "登入你的帳號",
    finishAccountSubtitle: "完成帳號建立",
    resetPasswordSubtitle: "重設你的密碼",
    upgradeCopy: "繼續登入，將此應用程式連結到你的帳號並遷移本機資料。",
    createAccount: "建立帳號",
    passwordMinPlaceholder: `至少 ${PASSWORD_MIN_LENGTH} 個字元`,
    confirmPasswordPlaceholder: "確認密碼",
    magicLinkTitle: NATIVE_AUTH_COPY["zh-TW"].welcomeTitle,
    magicLinkSubtitle: NATIVE_AUTH_COPY["zh-TW"].welcomeSubtitle,
    signupProgress: "註冊進度",
    progressAccount: "帳號",
    progressVerify: "驗證",
    progressStart: "開始",
    verificationSent: "驗證郵件已送出",
    verifyCopyPrefix: "我們已將安全連結寄到",
    verifyCopySuffix: "。點擊連結後回到這裡，應用程式會自動完成登入。",
    verificationNote:
      "你可以保持此分頁開啟。如果回來後沒有自動重新整理，請點擊繼續。",
    continue: "繼續",
    resendEmail: "重新寄送郵件",
    sendResetLink: "寄送重設連結",
    backToSignIn: "返回登入",
    localNotePrefix: "你的帳號儲存在此應用程式自己的資料庫中",
    localNoteSuffix: "，而不是第三方服務。",
    localDevButton: "以本機開發身分繼續",
    localDevDescription: "僅在這台電腦的本機開發環境中有效。",
    localDevHelp: "了解本機開發登入",
    localDevSigningIn: "正在本機登入…",
    localDevFailed: "本機開發登入無法使用。",
    localDevFullOptions: "顯示完整登入選項",
    openSource: "100% 免費且開源",
    useOwnGoogleClient: "使用你自己的 Google OAuth 用戶端：",
    copyCommand: "複製指令",
    copied: "已複製",
    closeGoogleChoices: "關閉 Google 登入選項",
    signInToContinue: "登入以繼續。",
    finishSignInFailed: "無法自動完成登入。",
    enterPasswordAfterVerification: "驗證電子郵件後請輸入密碼。",
    finishSignInManually: "無法自動完成登入。請登入以繼續。",
    stillWaitingVerification:
      "仍在等待驗證。請點擊郵件中的連結，然後再次點擊繼續。",
    checkVerificationFailed: "無法檢查驗證狀態。請重試。",
    verificationLinkInvalid: "此驗證連結無效或已過期。請重新索取。",
    checkingVerification: "正在檢查驗證狀態...",
    sent: "已送出",
    sentVerification: "新的驗證連結已送出。",
    resendVerificationFailed: "無法重新寄送驗證郵件。",
    networkErrorRetry: "網路錯誤。請重試。",
    networkErrorDashRetry: "網路錯誤 - 請重試",
    passwordsMismatch: "兩次輸入的密碼不一致",
    creatingAccount: "正在建立帳號...",
    registrationFailed: "註冊失敗",
    accountCreatedSigningIn: "帳號已建立，正在登入...",
    emailVerifiedFinishing: "電子郵件已驗證。正在完成登入...",
    emailVerifiedSignIn: "電子郵件已驗證。請登入以繼續。",
    resetEmailSent: "如果該電子郵件存在，重設連結已在寄送途中。",
    resetEmailFailed: "無法寄送重設郵件。",
    googleNotConfigured: "Google OAuth 尚未設定。",
    migrateLocalFallback: "繼續登入以遷移本機資料。",
    googlePopupHelp: "請允許此網站開啟彈出式視窗後重試",
  },
  "es-ES": {
    ...NATIVE_AUTH_COPY["es-ES"],
    languageLabel: "Idioma",
    systemLanguage: "Sistema",
    pageTitleSignIn: "Iniciar sesión",
    pageTitleWelcome: "Bienvenido",
    welcomeTitle: "Bienvenido",
    signInTitle: "Iniciar sesión",
    welcomeBackTitle: "Bienvenido de nuevo",
    checkEmailTitle: "Revisa tu email",
    resetPasswordTitle: "Restablecer contraseña",
    createAccountSubtitle: "Crea una cuenta para empezar",
    googleOnlySubtitle: "Usa tu cuenta de Google del espacio de trabajo",
    signInSubtitle: "Inicia sesión en tu cuenta",
    finishAccountSubtitle: "Termina de crear tu cuenta",
    resetPasswordSubtitle: "Restablece tu contraseña",
    upgradeCopy:
      "Sigue iniciando sesión para conectar esta app a tu cuenta y migrar datos locales.",
    createAccount: "Crear cuenta",
    passwordMinPlaceholder: `Al menos ${PASSWORD_MIN_LENGTH} caracteres`,
    confirmPasswordPlaceholder: "Confirmar contraseña",
    magicLinkTitle: NATIVE_AUTH_COPY["es-ES"].welcomeTitle,
    magicLinkSubtitle: NATIVE_AUTH_COPY["es-ES"].welcomeSubtitle,
    signupProgress: "Progreso de registro",
    progressAccount: "Cuenta",
    progressVerify: "Verificar",
    progressStart: "Empezar",
    verificationSent: "Email de verificación enviado",
    verifyCopyPrefix: "Enviamos un enlace seguro a",
    verifyCopySuffix:
      ". Haz clic en él, vuelve aquí y esta app terminará de iniciar sesión automáticamente.",
    verificationNote:
      "Puedes dejar esta pestaña abierta. Si no se actualiza al volver, usa Continuar.",
    continue: "Continuar",
    resendEmail: "Reenviar email",
    sendResetLink: "Enviar enlace de restablecimiento",
    backToSignIn: "Volver a iniciar sesión",
    localNotePrefix:
      "Tu cuenta se almacena en la propia base de datos de esta app",
    localNoteSuffix: ", no en un servicio de terceros.",
    localDevButton: "Continuar como desarrollador local",
    localDevDescription: "Solo funciona en el desarrollo local de este equipo.",
    localDevHelp: "Más información sobre el inicio de sesión local",
    localDevSigningIn: "Iniciando sesión localmente…",
    localDevFailed:
      "El inicio de sesión de desarrollo local no está disponible.",
    localDevFullOptions: "Mostrar todas las opciones de inicio de sesión",
    openSource: "100% gratis y de código abierto",
    useOwnGoogleClient: "Usa tu propio cliente de Google OAuth:",
    copyCommand: "Copiar comando",
    copied: "Copiado",
    closeGoogleChoices: "Cerrar opciones de inicio con Google",
    signInToContinue: "Inicia sesión para continuar.",
    finishSignInFailed: "No se pudo completar el inicio automáticamente.",
    enterPasswordAfterVerification:
      "Introduce tu contraseña después de verificar tu email.",
    finishSignInManually:
      "No se pudo completar el inicio automáticamente. Inicia sesión para continuar.",
    stillWaitingVerification:
      "Aún esperamos la verificación. Haz clic en el enlace del email y luego prueba Continuar de nuevo.",
    checkVerificationFailed:
      "No se pudo comprobar la verificación. Inténtalo de nuevo.",
    verificationLinkInvalid:
      "Este enlace de verificación no es válido o ha caducado. Solicita uno nuevo.",
    checkingVerification: "Comprobando tu verificación...",
    sent: "Enviado",
    sentVerification: "Se envió un nuevo enlace de verificación.",
    resendVerificationFailed: "No se pudo reenviar el email de verificación.",
    networkErrorRetry: "Error de red. Inténtalo de nuevo.",
    networkErrorDashRetry: "Error de red — inténtalo de nuevo",
    passwordsMismatch: "Las contraseñas no coinciden",
    creatingAccount: "Creando cuenta…",
    registrationFailed: "Error al registrarse",
    accountCreatedSigningIn: "Cuenta creada — iniciando sesión…",
    emailVerifiedFinishing: "Email verificado. Terminando inicio de sesión...",
    emailVerifiedSignIn: "Email verificado. Inicia sesión para continuar.",
    resetEmailSent:
      "Si ese email existe, el enlace de restablecimiento está en camino.",
    resetEmailFailed: "No se pudo enviar el email de restablecimiento.",
    googleNotConfigured: "Google OAuth no está configurado.",
    migrateLocalFallback: "Sigue iniciando sesión para migrar datos locales.",
    googlePopupHelp:
      "Permite ventanas emergentes para este sitio e inténtalo de nuevo",
  },
  "fr-FR": {
    ...NATIVE_AUTH_COPY["fr-FR"],
    languageLabel: "Langue",
    systemLanguage: "Système",
    pageTitleSignIn: "Connexion",
    pageTitleWelcome: "Bienvenue",
    welcomeTitle: "Bienvenue",
    signInTitle: "Connexion",
    welcomeBackTitle: "Bon retour",
    checkEmailTitle: "Vérifiez votre e-mail",
    resetPasswordTitle: "Réinitialiser le mot de passe",
    createAccountSubtitle: "Créez un compte pour commencer",
    googleOnlySubtitle: "Utilisez le compte Google de votre espace de travail",
    signInSubtitle: "Connectez-vous à votre compte",
    finishAccountSubtitle: "Terminez la création de votre compte",
    resetPasswordSubtitle: "Réinitialisez votre mot de passe",
    upgradeCopy:
      "Continuez la connexion pour associer cette app à votre compte et migrer les données locales.",
    createAccount: "Créer un compte",
    passwordMinPlaceholder: `Au moins ${PASSWORD_MIN_LENGTH} caractères`,
    confirmPasswordPlaceholder: "Confirmer le mot de passe",
    magicLinkTitle: NATIVE_AUTH_COPY["fr-FR"].welcomeTitle,
    magicLinkSubtitle: NATIVE_AUTH_COPY["fr-FR"].welcomeSubtitle,
    signupProgress: "Progression de l'inscription",
    progressAccount: "Compte",
    progressVerify: "Vérifier",
    progressStart: "Démarrer",
    verificationSent: "E-mail de vérification envoyé",
    verifyCopyPrefix: "Nous avons envoyé un lien sécurisé à",
    verifyCopySuffix:
      ". Cliquez dessus, revenez ici, et cette app terminera automatiquement la connexion.",
    verificationNote:
      "Vous pouvez garder cet onglet ouvert. S'il ne s'actualise pas à votre retour, utilisez Continuer.",
    continue: "Continuer",
    resendEmail: "Renvoyer l'e-mail",
    sendResetLink: "Envoyer le lien de réinitialisation",
    backToSignIn: "Retour à la connexion",
    localNotePrefix:
      "Votre compte est stocké dans la base de données propre à cette app",
    localNoteSuffix: ", pas dans un service tiers.",
    localDevButton: "Continuer comme développeur local",
    localDevDescription:
      "Fonctionne uniquement en développement local sur cet ordinateur.",
    localDevHelp: "En savoir plus sur la connexion locale",
    localDevSigningIn: "Connexion locale…",
    localDevFailed: "La connexion de développement local est indisponible.",
    localDevFullOptions: "Afficher toutes les options de connexion",
    openSource: "100 % gratuit et open source",
    useOwnGoogleClient: "Utilisez votre propre client Google OAuth :",
    copyCommand: "Copier la commande",
    copied: "Copié",
    closeGoogleChoices: "Fermer les choix de connexion Google",
    signInToContinue: "Connectez-vous pour continuer.",
    finishSignInFailed: "Impossible de terminer la connexion automatiquement.",
    enterPasswordAfterVerification:
      "Saisissez votre mot de passe après avoir vérifié votre e-mail.",
    finishSignInManually:
      "Impossible de terminer la connexion automatiquement. Connectez-vous pour continuer.",
    stillWaitingVerification:
      "La vérification est toujours en attente. Cliquez sur le lien dans votre e-mail, puis réessayez Continuer.",
    checkVerificationFailed:
      "Impossible de vérifier l'état. Veuillez réessayer.",
    verificationLinkInvalid:
      "Ce lien de vérification est invalide ou expiré. Demandez-en un nouveau.",
    checkingVerification: "Vérification en cours...",
    sent: "Envoyé",
    sentVerification: "Nouveau lien de vérification envoyé.",
    resendVerificationFailed:
      "Impossible de renvoyer l'e-mail de vérification.",
    networkErrorRetry: "Erreur réseau. Veuillez réessayer.",
    networkErrorDashRetry: "Erreur réseau — veuillez réessayer",
    passwordsMismatch: "Les mots de passe ne correspondent pas",
    creatingAccount: "Création du compte…",
    registrationFailed: "Échec de l'inscription",
    accountCreatedSigningIn: "Compte créé — connexion en cours…",
    emailVerifiedFinishing: "E-mail vérifié. Connexion en cours...",
    emailVerifiedSignIn: "E-mail vérifié. Connectez-vous pour continuer.",
    resetEmailSent:
      "Si cet e-mail existe, un lien de réinitialisation est en route.",
    resetEmailFailed: "Impossible d'envoyer l'e-mail de réinitialisation.",
    googleNotConfigured: "Google OAuth n'est pas configuré.",
    migrateLocalFallback:
      "Continuez la connexion pour migrer les données locales.",
    googlePopupHelp: "Autorisez les fenêtres pop-up pour ce site et réessayez",
  },
  "de-DE": {
    ...NATIVE_AUTH_COPY["de-DE"],
    languageLabel: "Sprache",
    systemLanguage: "System",
    pageTitleSignIn: "Anmelden",
    pageTitleWelcome: "Willkommen",
    welcomeTitle: "Willkommen",
    signInTitle: "Anmelden",
    welcomeBackTitle: "Willkommen zurück",
    checkEmailTitle: "E-Mail prüfen",
    resetPasswordTitle: "Passwort zurücksetzen",
    createAccountSubtitle: "Erstelle ein Konto, um zu beginnen",
    googleOnlySubtitle: "Verwende dein Workspace-Google-Konto",
    signInSubtitle: "Melde dich bei deinem Konto an",
    finishAccountSubtitle: "Schließe die Kontoerstellung ab",
    resetPasswordSubtitle: "Setze dein Passwort zurück",
    upgradeCopy:
      "Melde dich weiter an, um diese App mit deinem Konto zu verbinden und lokale Daten zu migrieren.",
    createAccount: "Konto erstellen",
    passwordMinPlaceholder: `Mindestens ${PASSWORD_MIN_LENGTH} Zeichen`,
    confirmPasswordPlaceholder: "Passwort bestätigen",
    magicLinkTitle: NATIVE_AUTH_COPY["de-DE"].welcomeTitle,
    magicLinkSubtitle: NATIVE_AUTH_COPY["de-DE"].welcomeSubtitle,
    signupProgress: "Registrierungsfortschritt",
    progressAccount: "Konto",
    progressVerify: "Prüfen",
    progressStart: "Start",
    verificationSent: "Bestätigungs-E-Mail gesendet",
    verifyCopyPrefix: "Wir haben einen sicheren Link gesendet an",
    verifyCopySuffix:
      ". Klicke darauf, kehre hierher zurück, und diese App meldet dich automatisch an.",
    verificationNote:
      "Du kannst diesen Tab geöffnet lassen. Wenn er nach deiner Rückkehr nicht aktualisiert wird, nutze Weiter.",
    continue: "Weiter",
    resendEmail: "E-Mail erneut senden",
    sendResetLink: "Reset-Link senden",
    backToSignIn: "Zurück zur Anmeldung",
    localNotePrefix:
      "Dein Konto wird in der eigenen Datenbank dieser App gespeichert",
    localNoteSuffix: ", nicht bei einem Drittanbieter.",
    localDevButton: "Als lokale Entwicklung fortfahren",
    localDevDescription:
      "Funktioniert nur in der lokalen Entwicklung auf diesem Computer.",
    localDevHelp: "Mehr über die lokale Anmeldung erfahren",
    localDevSigningIn: "Lokale Anmeldung…",
    localDevFailed: "Die lokale Entwicklungsanmeldung ist nicht verfügbar.",
    localDevFullOptions: "Alle Anmeldeoptionen anzeigen",
    openSource: "100 % kostenlos und Open Source",
    useOwnGoogleClient: "Eigenen Google-OAuth-Client verwenden:",
    copyCommand: "Befehl kopieren",
    copied: "Kopiert",
    closeGoogleChoices: "Google-Anmeldeoptionen schließen",
    signInToContinue: "Melde dich an, um fortzufahren.",
    finishSignInFailed:
      "Die Anmeldung konnte nicht automatisch abgeschlossen werden.",
    enterPasswordAfterVerification:
      "Gib dein Passwort ein, nachdem du deine E-Mail bestätigt hast.",
    finishSignInManually:
      "Die Anmeldung konnte nicht automatisch abgeschlossen werden. Melde dich an, um fortzufahren.",
    stillWaitingVerification:
      "Die Bestätigung steht noch aus. Klicke auf den Link in deiner E-Mail und versuche Weiter erneut.",
    checkVerificationFailed:
      "Bestätigung konnte nicht geprüft werden. Bitte erneut versuchen.",
    verificationLinkInvalid:
      "Dieser Bestätigungslink ist ungültig oder abgelaufen. Fordere einen neuen an.",
    checkingVerification: "Bestätigung wird geprüft...",
    sent: "Gesendet",
    sentVerification: "Ein neuer Bestätigungslink wurde gesendet.",
    resendVerificationFailed:
      "Bestätigungs-E-Mail konnte nicht erneut gesendet werden.",
    networkErrorRetry: "Netzwerkfehler. Bitte erneut versuchen.",
    networkErrorDashRetry: "Netzwerkfehler — bitte erneut versuchen",
    passwordsMismatch: "Die Passwörter stimmen nicht überein",
    creatingAccount: "Konto wird erstellt…",
    registrationFailed: "Registrierung fehlgeschlagen",
    accountCreatedSigningIn: "Konto erstellt — Anmeldung läuft…",
    emailVerifiedFinishing: "E-Mail bestätigt. Anmeldung wird abgeschlossen...",
    emailVerifiedSignIn: "E-Mail bestätigt. Melde dich an, um fortzufahren.",
    resetEmailSent:
      "Falls diese E-Mail existiert, ist ein Reset-Link unterwegs.",
    resetEmailFailed: "Reset-E-Mail konnte nicht gesendet werden.",
    googleNotConfigured: "Google OAuth ist nicht konfiguriert.",
    migrateLocalFallback: "Melde dich weiter an, um lokale Daten zu migrieren.",
    googlePopupHelp: "Erlaube Pop-ups für diese Website und versuche es erneut",
  },
  "ja-JP": {
    ...NATIVE_AUTH_COPY["ja-JP"],
    languageLabel: "言語",
    systemLanguage: "システム",
    pageTitleSignIn: "サインイン",
    pageTitleWelcome: "ようこそ",
    welcomeTitle: "ようこそ",
    signInTitle: "サインイン",
    welcomeBackTitle: "おかえりなさい",
    checkEmailTitle: "メールを確認してください",
    resetPasswordTitle: "パスワードをリセット",
    createAccountSubtitle: "アカウントを作成して始めましょう",
    googleOnlySubtitle: "ワークスペースの Google アカウントで続行",
    signInSubtitle: "アカウントにサインイン",
    finishAccountSubtitle: "アカウント作成を完了",
    resetPasswordSubtitle: "パスワードをリセットします",
    upgradeCopy:
      "サインインを続けて、このアプリをアカウントに接続し、ローカルデータを移行します。",
    createAccount: "アカウントを作成",
    passwordMinPlaceholder: `${PASSWORD_MIN_LENGTH} 文字以上`,
    confirmPasswordPlaceholder: "パスワードを確認",
    magicLinkTitle: NATIVE_AUTH_COPY["ja-JP"].welcomeTitle,
    magicLinkSubtitle: NATIVE_AUTH_COPY["ja-JP"].welcomeSubtitle,
    signupProgress: "登録の進行状況",
    progressAccount: "アカウント",
    progressVerify: "確認",
    progressStart: "開始",
    verificationSent: "確認メールを送信しました",
    verifyCopyPrefix: "安全なリンクを送信しました:",
    verifyCopySuffix:
      "。リンクをクリックしてここに戻ると、このアプリが自動的にサインインを完了します。",
    verificationNote:
      "このタブは開いたままで構いません。戻っても更新されない場合は、続行を押してください。",
    continue: "続行",
    resendEmail: "メールを再送信",
    sendResetLink: "リセットリンクを送信",
    backToSignIn: "サインインに戻る",
    localNotePrefix: "アカウントはこのアプリ自身の DB に保存されます",
    localNoteSuffix: "。サードパーティサービスには保存されません。",
    localDevButton: "ローカル開発として続行",
    localDevDescription: "このコンピューターのローカル開発でのみ利用できます。",
    localDevHelp: "ローカル開発サインインについて詳しく見る",
    localDevSigningIn: "ローカルでサインイン中…",
    localDevFailed: "ローカル開発のサインインは利用できません。",
    localDevFullOptions: "完全なサインイン オプションを表示",
    openSource: "100% 無料でオープンソース",
    useOwnGoogleClient: "自分の Google OAuth クライアントを使用:",
    copyCommand: "コマンドをコピー",
    copied: "コピーしました",
    closeGoogleChoices: "Google サインインの選択肢を閉じる",
    signInToContinue: "続行するにはサインインしてください。",
    finishSignInFailed: "サインインを自動で完了できませんでした。",
    enterPasswordAfterVerification:
      "メールを確認した後、パスワードを入力してください。",
    finishSignInManually:
      "サインインを自動で完了できませんでした。続行するにはサインインしてください。",
    stillWaitingVerification:
      "まだ確認待ちです。メール内のリンクをクリックしてから、もう一度続行してください。",
    checkVerificationFailed:
      "確認状態をチェックできませんでした。もう一度お試しください。",
    verificationLinkInvalid:
      "この確認リンクは無効か期限切れです。新しいリンクをリクエストしてください。",
    checkingVerification: "確認状態をチェック中...",
    sent: "送信済み",
    sentVerification: "新しい確認リンクを送信しました。",
    resendVerificationFailed: "確認メールを再送信できませんでした。",
    networkErrorRetry: "ネットワークエラーです。もう一度お試しください。",
    networkErrorDashRetry: "ネットワークエラー — もう一度お試しください",
    passwordsMismatch: "パスワードが一致しません",
    creatingAccount: "アカウントを作成中…",
    registrationFailed: "登録に失敗しました",
    accountCreatedSigningIn: "アカウントを作成しました — サインイン中…",
    emailVerifiedFinishing: "メールを確認しました。サインインを完了中...",
    emailVerifiedSignIn:
      "メールを確認しました。続行するにはサインインしてください。",
    resetEmailSent: "そのメールが存在する場合、リセットリンクを送信しました。",
    resetEmailFailed: "リセットメールを送信できませんでした。",
    googleNotConfigured: "Google OAuth が設定されていません。",
    migrateLocalFallback: "サインインを続けてローカルデータを移行します。",
    googlePopupHelp:
      "このサイトのポップアップを許可してから、もう一度お試しください",
  },
  "ko-KR": {
    ...NATIVE_AUTH_COPY["ko-KR"],
    languageLabel: "언어",
    systemLanguage: "시스템",
    pageTitleSignIn: "로그인",
    pageTitleWelcome: "환영합니다",
    welcomeTitle: "환영합니다",
    signInTitle: "로그인",
    welcomeBackTitle: "다시 오신 것을 환영합니다",
    checkEmailTitle: "이메일을 확인하세요",
    resetPasswordTitle: "비밀번호 재설정",
    createAccountSubtitle: "계정을 만들고 시작하세요",
    googleOnlySubtitle: "워크스페이스 Google 계정으로 계속하기",
    signInSubtitle: "계정에 로그인하세요",
    finishAccountSubtitle: "계정 생성을 완료하세요",
    resetPasswordSubtitle: "비밀번호를 재설정하세요",
    upgradeCopy:
      "계속 로그인하여 이 앱을 계정에 연결하고 로컬 데이터를 마이그레이션하세요.",
    createAccount: "계정 만들기",
    passwordMinPlaceholder: `${PASSWORD_MIN_LENGTH}자 이상`,
    confirmPasswordPlaceholder: "비밀번호 확인",
    magicLinkTitle: NATIVE_AUTH_COPY["ko-KR"].welcomeTitle,
    magicLinkSubtitle: NATIVE_AUTH_COPY["ko-KR"].welcomeSubtitle,
    signupProgress: "가입 진행 상황",
    progressAccount: "계정",
    progressVerify: "확인",
    progressStart: "시작",
    verificationSent: "확인 이메일을 보냈습니다",
    verifyCopyPrefix: "보안 링크를 보냈습니다:",
    verifyCopySuffix:
      ". 링크를 클릭하고 여기로 돌아오면 이 앱이 자동으로 로그인을 완료합니다.",
    verificationNote:
      "이 탭을 열어 두어도 됩니다. 돌아온 뒤 새로고침되지 않으면 계속을 누르세요.",
    continue: "계속",
    resendEmail: "이메일 다시 보내기",
    sendResetLink: "재설정 링크 보내기",
    backToSignIn: "로그인으로 돌아가기",
    localNotePrefix: "계정은 이 앱의 자체 DB에 저장됩니다",
    localNoteSuffix: ", 타사 서비스가 아닙니다.",
    localDevButton: "로컬 개발자로 계속",
    localDevDescription: "이 컴퓨터의 로컬 개발 환경에서만 작동합니다.",
    localDevHelp: "로컬 개발 로그인 자세히 보기",
    localDevSigningIn: "로컬로 로그인하는 중…",
    localDevFailed: "로컬 개발 로그인을 사용할 수 없습니다.",
    localDevFullOptions: "전체 로그인 옵션 보기",
    openSource: "100% 무료 오픈 소스",
    useOwnGoogleClient: "내 Google OAuth 클라이언트 사용:",
    copyCommand: "명령 복사",
    copied: "복사됨",
    closeGoogleChoices: "Google 로그인 선택 닫기",
    signInToContinue: "계속하려면 로그인하세요.",
    finishSignInFailed: "자동으로 로그인을 완료할 수 없습니다.",
    enterPasswordAfterVerification: "이메일을 확인한 후 비밀번호를 입력하세요.",
    finishSignInManually:
      "자동으로 로그인을 완료할 수 없습니다. 계속하려면 로그인하세요.",
    stillWaitingVerification:
      "아직 확인을 기다리고 있습니다. 이메일의 링크를 클릭한 뒤 계속을 다시 눌러주세요.",
    checkVerificationFailed: "확인 상태를 확인할 수 없습니다. 다시 시도하세요.",
    verificationLinkInvalid:
      "이 인증 링크가 유효하지 않거나 만료되었습니다. 새 링크를 요청하세요.",
    checkingVerification: "확인 상태 확인 중...",
    sent: "보냄",
    sentVerification: "새 확인 링크를 보냈습니다.",
    resendVerificationFailed: "확인 이메일을 다시 보낼 수 없습니다.",
    networkErrorRetry: "네트워크 오류입니다. 다시 시도하세요.",
    networkErrorDashRetry: "네트워크 오류 — 다시 시도하세요",
    passwordsMismatch: "비밀번호가 일치하지 않습니다",
    creatingAccount: "계정 생성 중…",
    registrationFailed: "가입 실패",
    accountCreatedSigningIn: "계정 생성됨 — 로그인 중…",
    emailVerifiedFinishing: "이메일 확인됨. 로그인 완료 중...",
    emailVerifiedSignIn: "이메일 확인됨. 계속하려면 로그인하세요.",
    resetEmailSent: "해당 이메일이 있으면 재설정 링크가 발송됩니다.",
    resetEmailFailed: "재설정 이메일을 보낼 수 없습니다.",
    googleNotConfigured: "Google OAuth가 구성되지 않았습니다.",
    migrateLocalFallback: "계속 로그인하여 로컬 데이터를 마이그레이션하세요.",
    googlePopupHelp: "이 사이트의 팝업을 허용한 뒤 다시 시도하세요",
  },
  "pt-BR": {
    ...NATIVE_AUTH_COPY["pt-BR"],
    languageLabel: "Idioma",
    systemLanguage: "Sistema",
    pageTitleSignIn: "Entrar",
    pageTitleWelcome: "Boas-vindas",
    welcomeTitle: "Boas-vindas",
    signInTitle: "Entrar",
    welcomeBackTitle: "Bem-vindo de volta",
    checkEmailTitle: "Confira seu email",
    resetPasswordTitle: "Redefinir senha",
    createAccountSubtitle: "Crie uma conta para começar",
    googleOnlySubtitle: "Use sua conta Google do workspace para continuar",
    signInSubtitle: "Entre na sua conta",
    finishAccountSubtitle: "Finalize a criação da sua conta",
    resetPasswordSubtitle: "Redefina sua senha",
    upgradeCopy:
      "Continue entrando para conectar este app à sua conta e migrar dados locais.",
    createAccount: "Criar conta",
    passwordMinPlaceholder: `Pelo menos ${PASSWORD_MIN_LENGTH} caracteres`,
    confirmPasswordPlaceholder: "Confirmar senha",
    magicLinkTitle: NATIVE_AUTH_COPY["pt-BR"].welcomeTitle,
    magicLinkSubtitle: NATIVE_AUTH_COPY["pt-BR"].welcomeSubtitle,
    signupProgress: "Progresso do cadastro",
    progressAccount: "Conta",
    progressVerify: "Verificar",
    progressStart: "Começar",
    verificationSent: "Email de verificação enviado",
    verifyCopyPrefix: "Enviamos um link seguro para",
    verifyCopySuffix:
      ". Clique nele, volte aqui e este app terminará o login automaticamente.",
    verificationNote:
      "Você pode manter esta aba aberta. Se ela não atualizar quando você voltar, use Continuar.",
    continue: "Continuar",
    resendEmail: "Reenviar email",
    sendResetLink: "Enviar link de redefinição",
    backToSignIn: "Voltar para entrar",
    localNotePrefix:
      "Sua conta fica armazenada no banco de dados próprio deste app",
    localNoteSuffix: ", não em um serviço de terceiros.",
    localDevButton: "Continuar como desenvolvedor local",
    localDevDescription:
      "Funciona apenas no desenvolvimento local deste computador.",
    localDevHelp: "Saiba mais sobre o login de desenvolvimento local",
    localDevSigningIn: "Entrando localmente…",
    localDevFailed: "O login de desenvolvimento local não está disponível.",
    localDevFullOptions: "Mostrar todas as opções de login",
    openSource: "100% grátis e open source",
    useOwnGoogleClient: "Use seu próprio cliente Google OAuth:",
    copyCommand: "Copiar comando",
    copied: "Copiado",
    closeGoogleChoices: "Fechar opções de login com Google",
    signInToContinue: "Entre para continuar.",
    finishSignInFailed: "Não foi possível concluir o login automaticamente.",
    enterPasswordAfterVerification:
      "Digite sua senha depois de verificar seu email.",
    finishSignInManually:
      "Não foi possível concluir o login automaticamente. Entre para continuar.",
    stillWaitingVerification:
      "Ainda estamos aguardando a verificação. Clique no link do email e tente Continuar novamente.",
    checkVerificationFailed: "Não foi possível verificar. Tente novamente.",
    verificationLinkInvalid:
      "Este link de verificação é inválido ou expirou. Solicite um novo.",
    checkingVerification: "Verificando sua confirmação...",
    sent: "Enviado",
    sentVerification: "Enviamos um novo link de verificação.",
    resendVerificationFailed:
      "Não foi possível reenviar o email de verificação.",
    networkErrorRetry: "Erro de rede. Tente novamente.",
    networkErrorDashRetry: "Erro de rede — tente novamente",
    passwordsMismatch: "As senhas não conferem",
    creatingAccount: "Criando conta…",
    registrationFailed: "Falha no cadastro",
    accountCreatedSigningIn: "Conta criada — entrando…",
    emailVerifiedFinishing: "Email verificado. Concluindo login...",
    emailVerifiedSignIn: "Email verificado. Entre para continuar.",
    resetEmailSent:
      "Se esse email existir, um link de redefinição está a caminho.",
    resetEmailFailed: "Não foi possível enviar o email de redefinição.",
    googleNotConfigured: "Google OAuth não está configurado.",
    migrateLocalFallback: "Continue entrando para migrar dados locais.",
    googlePopupHelp: "Permita pop-ups para este site e tente novamente",
  },
  "hi-IN": {
    ...NATIVE_AUTH_COPY["hi-IN"],
    languageLabel: "भाषा",
    systemLanguage: "सिस्टम",
    pageTitleSignIn: "साइन इन",
    pageTitleWelcome: "स्वागत है",
    welcomeTitle: "स्वागत है",
    signInTitle: "साइन इन",
    welcomeBackTitle: "वापस स्वागत है",
    checkEmailTitle: "अपना ईमेल देखें",
    resetPasswordTitle: "पासवर्ड रीसेट करें",
    createAccountSubtitle: "शुरू करने के लिए खाता बनाएं",
    googleOnlySubtitle: "जारी रखने के लिए अपना workspace Google खाता उपयोग करें",
    signInSubtitle: "अपने खाते में साइन इन करें",
    finishAccountSubtitle: "अपना खाता बनाना पूरा करें",
    resetPasswordSubtitle: "अपना पासवर्ड रीसेट करें",
    upgradeCopy:
      "इस ऐप को अपने खाते से जोड़ने और स्थानीय डेटा माइग्रेट करने के लिए साइन इन जारी रखें।",
    createAccount: "खाता बनाएं",
    passwordMinPlaceholder: `कम से कम ${PASSWORD_MIN_LENGTH} अक्षर`,
    confirmPasswordPlaceholder: "पासवर्ड की पुष्टि करें",
    magicLinkTitle: NATIVE_AUTH_COPY["hi-IN"].welcomeTitle,
    magicLinkSubtitle: NATIVE_AUTH_COPY["hi-IN"].welcomeSubtitle,
    signupProgress: "साइनअप प्रगति",
    progressAccount: "खाता",
    progressVerify: "सत्यापित करें",
    progressStart: "शुरू करें",
    verificationSent: "सत्यापन ईमेल भेजा गया",
    verifyCopyPrefix: "हमने एक सुरक्षित लिंक भेजा है",
    verifyCopySuffix:
      "पर। लिंक खोलें, यहां वापस आएं, और यह ऐप अपने आप आपका साइन इन पूरा करेगा।",
    verificationNote:
      "आप यह टैब खुला रख सकते हैं। वापस आने पर अगर यह refresh नहीं होता है, तो Continue दबाएं।",
    continue: "जारी रखें",
    resendEmail: "ईमेल फिर भेजें",
    sendResetLink: "रीसेट लिंक भेजें",
    backToSignIn: "साइन इन पर वापस जाएं",
    localNotePrefix: "आपका खाता इस ऐप के अपने DB में संग्रहीत है",
    localNoteSuffix: ", किसी third-party सेवा में नहीं।",
    localDevButton: "स्थानीय डेवलपर के रूप में जारी रखें",
    localDevDescription: "यह केवल इस कंप्यूटर के स्थानीय विकास में काम करता है।",
    localDevHelp: "स्थानीय विकास साइन-इन के बारे में जानें",
    localDevSigningIn: "स्थानीय रूप से साइन इन हो रहा है…",
    localDevFailed: "स्थानीय विकास साइन-इन उपलब्ध नहीं है।",
    localDevFullOptions: "साइन-इन के सभी विकल्प दिखाएं",
    openSource: "100% मुफ्त और open source",
    useOwnGoogleClient: "अपना Google OAuth client उपयोग करें:",
    copyCommand: "कमांड कॉपी करें",
    copied: "कॉपी हो गया",
    closeGoogleChoices: "Google साइन-इन विकल्प बंद करें",
    signInToContinue: "जारी रखने के लिए साइन इन करें।",
    finishSignInFailed: "साइन इन अपने आप पूरा नहीं हो सका।",
    enterPasswordAfterVerification: "ईमेल सत्यापित करने के बाद अपना पासवर्ड दर्ज करें।",
    finishSignInManually:
      "साइन इन अपने आप पूरा नहीं हो सका। जारी रखने के लिए साइन इन करें।",
    stillWaitingVerification:
      "सत्यापन का इंतजार है। ईमेल में लिंक खोलें, फिर Continue दोबारा दबाएं।",
    checkVerificationFailed: "सत्यापन जांच नहीं हो सकी। कृपया फिर कोशिश करें।",
    verificationLinkInvalid:
      "यह सत्यापन लिंक अमान्य या समाप्त हो गया है। नया लिंक मांगें।",
    checkingVerification: "आपका सत्यापन जांच रहे हैं...",
    sent: "भेजा गया",
    sentVerification: "नया सत्यापन लिंक भेजा गया।",
    resendVerificationFailed: "सत्यापन ईमेल फिर नहीं भेजा जा सका।",
    networkErrorRetry: "नेटवर्क त्रुटि। कृपया फिर कोशिश करें।",
    networkErrorDashRetry: "नेटवर्क त्रुटि — कृपया फिर कोशिश करें",
    passwordsMismatch: "पासवर्ड मेल नहीं खाते",
    creatingAccount: "खाता बनाया जा रहा है…",
    registrationFailed: "रजिस्ट्रेशन असफल",
    accountCreatedSigningIn: "खाता बन गया — साइन इन हो रहा है…",
    emailVerifiedFinishing: "ईमेल सत्यापित। साइन इन पूरा हो रहा है...",
    emailVerifiedSignIn: "ईमेल सत्यापित। जारी रखने के लिए साइन इन करें।",
    resetEmailSent: "अगर वह ईमेल मौजूद है, तो reset लिंक भेजा जा रहा है।",
    resetEmailFailed: "रीसेट ईमेल नहीं भेजा जा सका।",
    googleNotConfigured: "Google OAuth configured नहीं है।",
    migrateLocalFallback: "स्थानीय डेटा माइग्रेट करने के लिए साइन इन जारी रखें।",
    googlePopupHelp: "इस साइट के लिए pop-ups allow करें और फिर कोशिश करें",
  },
  "ar-SA": {
    ...NATIVE_AUTH_COPY["ar-SA"],
    languageLabel: "اللغة",
    systemLanguage: "النظام",
    pageTitleSignIn: "تسجيل الدخول",
    pageTitleWelcome: "مرحبًا",
    welcomeTitle: "مرحبًا",
    signInTitle: "تسجيل الدخول",
    welcomeBackTitle: "مرحبًا بعودتك",
    checkEmailTitle: "تحقق من بريدك الإلكتروني",
    resetPasswordTitle: "إعادة تعيين كلمة المرور",
    createAccountSubtitle: "أنشئ حسابًا للبدء",
    googleOnlySubtitle: "استخدم حساب Google الخاص بمساحة العمل للمتابعة",
    signInSubtitle: "سجّل الدخول إلى حسابك",
    finishAccountSubtitle: "أكمل إنشاء حسابك",
    resetPasswordSubtitle: "أعد تعيين كلمة المرور",
    upgradeCopy:
      "تابع تسجيل الدخول لربط هذا التطبيق بحسابك وترحيل البيانات المحلية.",
    createAccount: "إنشاء حساب",
    passwordMinPlaceholder: `${PASSWORD_MIN_LENGTH} أحرف على الأقل`,
    confirmPasswordPlaceholder: "تأكيد كلمة المرور",
    magicLinkTitle: NATIVE_AUTH_COPY["ar-SA"].welcomeTitle,
    magicLinkSubtitle: NATIVE_AUTH_COPY["ar-SA"].welcomeSubtitle,
    signupProgress: "تقدم التسجيل",
    progressAccount: "الحساب",
    progressVerify: "التحقق",
    progressStart: "البدء",
    verificationSent: "تم إرسال رسالة التحقق",
    verifyCopyPrefix: "أرسلنا رابطًا آمنًا إلى",
    verifyCopySuffix:
      ". افتحه، ثم عُد إلى هنا وسيكمل هذا التطبيق تسجيل دخولك تلقائيًا.",
    verificationNote:
      "يمكنك إبقاء هذه النافذة مفتوحة. إذا لم يتم التحديث بعد عودتك، استخدم متابعة.",
    continue: "متابعة",
    resendEmail: "إعادة إرسال البريد",
    sendResetLink: "إرسال رابط إعادة التعيين",
    backToSignIn: "العودة إلى تسجيل الدخول",
    localNotePrefix: "يتم تخزين حسابك في قاعدة بيانات هذا التطبيق",
    localNoteSuffix: "، وليس في خدمة خارجية.",
    localDevButton: "المتابعة كمطور محلي",
    localDevDescription: "يعمل فقط أثناء التطوير المحلي على هذا الكمبيوتر.",
    localDevHelp: "تعرف على تسجيل دخول التطوير المحلي",
    localDevSigningIn: "جارٍ تسجيل الدخول محليًا…",
    localDevFailed: "تسجيل دخول التطوير المحلي غير متاح.",
    localDevFullOptions: "عرض خيارات تسجيل الدخول الكاملة",
    openSource: "مجاني ومفتوح المصدر 100%",
    useOwnGoogleClient: "استخدم عميل Google OAuth الخاص بك:",
    copyCommand: "نسخ الأمر",
    copied: "تم النسخ",
    closeGoogleChoices: "إغلاق خيارات تسجيل الدخول عبر Google",
    signInToContinue: "سجّل الدخول للمتابعة.",
    finishSignInFailed: "تعذر إكمال تسجيل الدخول تلقائيًا.",
    enterPasswordAfterVerification:
      "أدخل كلمة المرور بعد التحقق من بريدك الإلكتروني.",
    finishSignInManually:
      "تعذر إكمال تسجيل الدخول تلقائيًا. سجّل الدخول للمتابعة.",
    stillWaitingVerification:
      "ما زلنا ننتظر التحقق. افتح الرابط في بريدك الإلكتروني ثم جرّب متابعة مرة أخرى.",
    checkVerificationFailed: "تعذر التحقق من الحالة. حاول مرة أخرى.",
    verificationLinkInvalid:
      "رابط التحقق هذا غير صالح أو منتهي الصلاحية. اطلب رابطًا جديدًا.",
    checkingVerification: "جارٍ التحقق من حالتك...",
    sent: "تم الإرسال",
    sentVerification: "تم إرسال رابط تحقق جديد.",
    resendVerificationFailed: "تعذر إعادة إرسال رسالة التحقق.",
    networkErrorRetry: "خطأ في الشبكة. حاول مرة أخرى.",
    networkErrorDashRetry: "خطأ في الشبكة — حاول مرة أخرى",
    passwordsMismatch: "كلمتا المرور غير متطابقتين",
    creatingAccount: "جارٍ إنشاء الحساب…",
    registrationFailed: "فشل التسجيل",
    accountCreatedSigningIn: "تم إنشاء الحساب — جارٍ تسجيل الدخول…",
    emailVerifiedFinishing: "تم التحقق من البريد. جارٍ إكمال تسجيل الدخول...",
    emailVerifiedSignIn: "تم التحقق من البريد. سجّل الدخول للمتابعة.",
    resetEmailSent: "إذا كان هذا البريد موجودًا، فسيصل رابط إعادة التعيين.",
    resetEmailFailed: "تعذر إرسال بريد إعادة التعيين.",
    googleNotConfigured: "لم يتم إعداد Google OAuth.",
    migrateLocalFallback: "تابع تسجيل الدخول لترحيل البيانات المحلية.",
    googlePopupHelp: "اسمح بالنوافذ المنبثقة لهذا الموقع ثم حاول مرة أخرى",
  },
};

function resolveBuiltInMarketingSlug(
  marketing: AuthMarketingContent | undefined,
  opts: { requestHost?: string; requestPath?: string } = {},
): string | undefined {
  if (!marketing) return undefined;

  const matchesBuiltInMarketing = (builtIn: AuthMarketingContent) =>
    marketing.appName === builtIn.appName &&
    marketing.tagline === builtIn.tagline &&
    marketing.description === builtIn.description &&
    JSON.stringify(marketing.features ?? []) ===
      JSON.stringify(builtIn.features ?? []) &&
    JSON.stringify(marketing.signupLocalModeNote ?? null) ===
      JSON.stringify(builtIn.signupLocalModeNote ?? null);

  const requestSlug = resolveBuiltInAuthMarketingSlug(opts);
  if (requestSlug) {
    const builtIn = BUILT_IN_AUTH_MARKETING[requestSlug];
    if (builtIn && matchesBuiltInMarketing(builtIn)) return requestSlug;
  }

  for (const [slug, builtIn] of Object.entries(BUILT_IN_AUTH_MARKETING)) {
    // Caller-supplied marketing can reuse a built-in app name. Only an exact
    // content match may claim a slug, or localized copy would overwrite the
    // custom description/features.
    if (matchesBuiltInMarketing(builtIn)) {
      return slug;
    }
  }
  return undefined;
}

export interface SignupLegalNoticeOptions {
  termsUrl: string;
  privacyUrl: string;
  termsLabel?: string;
  privacyLabel?: string;
  prefix?: string;
  connector?: string;
  suffix?: string;
}

function normalizeRequestHostname(host: string | undefined): string {
  const firstHost = host?.split(",")[0]?.trim().toLowerCase() ?? "";
  if (!firstHost) return "";
  if (firstHost.startsWith("[")) {
    const close = firstHost.indexOf("]");
    return close > 0 ? firstHost.slice(1, close) : firstHost;
  }
  return firstHost.replace(/:\d+$/, "");
}

function isAgentNativeHostedHost(host: string | undefined): boolean {
  const hostname = normalizeRequestHostname(host);
  return (
    hostname === "agent-native.com" || hostname.endsWith(".agent-native.com")
  );
}

export interface OnboardingHtmlOptions {
  /**
   * Hide email/password forms and show ONLY the Google sign-in button.
   * Useful for templates (mail, calendar) where Google is required anyway.
   * If Google OAuth env vars are not configured, an error message is shown.
   */
  googleOnly?: boolean;
  /** Authentication surface to render. Defaults to the existing password flow. */
  authMode?: "magic-link" | "password";
  /** Render the quiet, centered auth surface used when the app has an initial prompt. */
  initialPrompt?: boolean;
  /**
   * Product marketing content shown alongside the sign-in form.
   * When provided, the page uses a split layout: marketing on the left,
   * sign-in form on the right (stacked on mobile).
   */
  marketing?: {
    appName: string;
    tagline: string;
    description?: string;
    features?: string[];
    /** @deprecated Local execution is no longer offered from auth pages. */
    runLocalCommand?: string;
  };
  /**
   * Request context used only to recover branded first-party marketing when a
   * default auth guard serves before a template-specific auth plugin.
   */
  requestHost?: string;
  requestPath?: string;
  requestOrigin?: string;
  /**
   * Optional email signup legal copy. Builder-hosted `*.agent-native.com`
   * deployments get the Agent-Native links automatically; self-hosted and
   * custom-domain apps must opt in with their own URLs.
   */
  signupLegalNotice?: SignupLegalNoticeOptions | false;
  /**
   * Google sign-in flow: `'popup'`, `'redirect'`, or `'auto'` (default).
   * Falls back to `GOOGLE_AUTH_MODE` env var, then `'auto'`. Builder web
   * iframes use popup; Builder desktop preview/editor surfaces use redirect.
   */
  googleAuthMode?: GoogleAuthMode;
}

function initialAuthView(
  opts: OnboardingHtmlOptions,
  authMode: OnboardingHtmlOptions["authMode"],
  googleOnly: boolean,
): AuthView {
  if (googleOnly) return "googleOnly";
  if (authMode === "magic-link") return "magicLink";
  try {
    const url = new URL(opts.requestPath ?? "/", "https://agent-native.local");
    if (
      url.searchParams.has("verified") ||
      url.searchParams.get("error") === "verification_link_invalid"
    ) {
      return "login";
    }
    const requestedView = url.searchParams.get("tab");
    if (requestedView === "login" || requestedView === "signup") {
      return requestedView;
    }
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    if (pathname.endsWith("/login")) return "login";
    if (pathname.endsWith("/signup")) return "signup";
  } catch (error) {
    // coercion-ok: malformed paths use the public signup state; no session data is inferred.
    void error;
  }
  return "signup";
}

function serializeAuthPageData(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function authClientAssetPath(appBasePath: string): string {
  const buildId =
    typeof __AGENT_NATIVE_BUILD_ID__ === "string"
      ? __AGENT_NATIVE_BUILD_ID__.trim()
      : "";
  const cacheBuster = buildId ? `?v=${encodeURIComponent(buildId)}` : "";
  return `${appBasePath}/assets/auth-client.js${cacheBuster}`;
}

export function getOnboardingHtml(opts: OnboardingHtmlOptions = {}): string {
  const showGoogle = hasGoogleOAuth();
  const googleOnly = !!opts.googleOnly;
  const authMode = opts.authMode ?? "password";
  const simplifiedAuth = opts.initialPrompt === true;
  const configuredAppBasePath = getAppBasePathFromViteEnv();
  const appBasePath =
    configuredAppBasePath || workspaceBasePathFromRequest(opts.requestPath);
  const appHomePath = resolveAppHomePath(getAppConfig().app);
  const workspaceRuntime = isWorkspaceRuntime();
  const trackingApp =
    getAppConfig().app.slug ??
    getAppConfig().app.template ??
    getAppConfig().app.id ??
    "";
  const publicOAuthOrigin = getPublicOAuthOrigin();
  const workspaceGatewayReturnOrigin = getWorkspaceGatewayReturnOrigin();
  const googleAuthMode = resolveGoogleAuthMode(opts.googleAuthMode);
  const builderPreviewLocalDevEnabled = isBuilderPreviewLocalDevEnabled();
  const localeInitScript = getLocaleInitScript();
  const embeddedAuthInitScript = `(function() {
  try {
    var params = new URLSearchParams(window.location.search || "");
    if (params.get("embedded") === "1" || window.self !== window.top) {
      document.documentElement.setAttribute("data-agent-native-embedded", "1");
    }
  } catch (error) {
    void error;
  }
})();`;

  const marketing: AuthMarketingContent | undefined =
    opts.marketing ??
    resolveBuiltInAuthMarketing({
      requestHost: opts.requestHost,
      requestPath: opts.requestPath,
    });
  const hasMarketing = !!marketing && !simplifiedAuth;
  const marketingSlug = resolveBuiltInMarketingSlug(marketing, {
    requestHost: opts.requestHost,
    requestPath: opts.requestPath,
  });
  const localizedMarketingCopy: Record<string, AuthMarketingLocaleCopy> = {};
  if (marketingSlug) {
    for (const [locale, copyBySlug] of Object.entries(
      AUTH_MARKETING_LOCALE_COPY,
    )) {
      const copy = copyBySlug?.[marketingSlug];
      if (copy) localizedMarketingCopy[locale] = copy;
    }
  }
  const signupLocalModeNote =
    isAgentNativeHostedHost(opts.requestHost) &&
    marketing?.signupLocalModeNote?.command.trim()
      ? {
          text: marketing.signupLocalModeNote.text.trim(),
          command: marketing.signupLocalModeNote.command.trim(),
        }
      : undefined;
  const brandMarkSrc = withAppBasePath(
    "/agent-native-icon-dark.svg",
    appBasePath,
  );
  const socialImageUrl = withAgentNativeSocialImageCacheBuster(
    opts.requestOrigin
      ? `${opts.requestOrigin}${withAppBasePath(AGENT_NATIVE_SOCIAL_IMAGE_PATH, appBasePath)}`
      : withAppBasePath(AGENT_NATIVE_SOCIAL_IMAGE_PATH, appBasePath),
  );
  const t = (key: keyof typeof EN_AUTH_COPY) => EN_AUTH_COPY[key];
  const hostedSignupLegalNotice: SignupLegalNoticeOptions | undefined =
    opts.signupLegalNotice === undefined &&
    isAgentNativeHostedHost(opts.requestHost)
      ? {
          termsUrl: AGENT_NATIVE_TERMS_URL,
          privacyUrl: AGENT_NATIVE_PRIVACY_URL,
        }
      : undefined;
  const signupLegalNotice =
    opts.signupLegalNotice === false
      ? undefined
      : (opts.signupLegalNotice ?? hostedSignupLegalNotice);
  const identitySsoEnabled = Boolean(identitySsoLoginButtonHtml());
  const embeddedAuthCss = identitySsoEnabled
    ? '  html[data-agent-native-embedded="1"] #identity-sso-btn { display: none !important; }\n'
    : "";
  const identitySsoMagicLinkSelector = identitySsoEnabled
    ? "  .card.magic-link-complete #identity-sso-btn,\n"
    : "";

  const marketingStyles = hasMarketing
    ? `
  body.has-marketing { padding: 0; position: relative; overflow-x: hidden; }
  #starfield {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0.35;
    pointer-events: none;
    z-index: 0;
  }
  @media (prefers-reduced-motion: reduce) {
    #starfield { opacity: 0.18; }
  }
  .split {
    position: relative;
    z-index: 1;
    display: flex;
    min-height: 100vh;
    width: 100%;
    max-width: 1100px;
    margin: 0 auto;
  }
  .marketing-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 3rem 3.5rem;
  }
  .marketing-content { max-width: 480px; }
  .app-name {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    font-size: 2rem;
    font-weight: 700;
    color: #fff;
    margin-bottom: 0.625rem;
    letter-spacing: -0.02em;
  }
  .app-name img.brand-mark {
    height: 2.21375rem;
    width: auto;
    display: block;
    flex-shrink: 0;
  }
  .app-tagline {
    font-size: 1.25rem;
    color: #a1a1aa;
    line-height: 1.6;
    margin-bottom: 2rem;
  }
  .app-desc {
    font-size: 1rem;
    color: #71717a;
    line-height: 1.6;
    margin-bottom: 2rem;
  }
  .feature-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
  }
  .feature-list li {
    display: flex;
    align-items: flex-start;
    gap: 0.625rem;
    font-size: 1rem;
    color: #a1a1aa;
    line-height: 1.5;
  }
  .feature-list li::before {
    content: '';
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    margin-top: 6px;
    border-radius: 50%;
    background: #3f3f46;
    border: 1px solid #52525b;
  }
  .oss-link {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.8125rem;
    font-weight: 600;
    color: #00B5FF;
    text-decoration: none;
    transition: color 0.15s ease;
  }
  .oss-link:hover { color: #33C4FF; }
  .oss-link svg { width: 15px; height: 15px; flex-shrink: 0; }
  .marketing-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    margin-top: 2rem;
  }
  .copy-run-local {
    margin-top: 0.625rem;
    padding: 0.375rem 0.625rem;
    background: transparent;
    color: #a1a1aa;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 6px;
    font-size: 0.75rem;
    cursor: pointer;
  }
  .copy-run-local:hover { color: #fff; border-color: rgba(255,255,255,0.22); }
  .form-panel {
    flex: 0 0 440px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2rem;
  }
  .form-panel .card { max-width: 400px; }
  .form-panel .local-note { max-width: 400px; }
  @media (max-width: 900px) {
    .split { flex-direction: column; min-height: auto; }
    .marketing-panel { padding: 4.25rem 1.5rem 1.5rem; }
    .app-name { font-size: 1.375rem; }
    .app-name img.brand-mark { height: 1.58125rem; }
    .app-tagline { font-size: 1rem; margin-bottom: 1rem; }
    .app-desc { margin-bottom: 1rem; }
    .feature-list { gap: 0.5rem; }
    .form-panel { flex: none; padding: 1.5rem 1rem; }
  }
`
    : "";

  const authMarketingLocales: AuthPageProps["marketingLocales"] =
    Object.fromEntries(
      Object.entries(localizedMarketingCopy).map(([locale, copy]) => [
        locale,
        {
          appName: marketing?.appName ?? "",
          tagline: copy.tagline ?? marketing?.tagline ?? "",
          description: copy.description ?? marketing?.description,
          features: copy.features ?? marketing?.features,
        },
      ]),
    );
  const authPageProps: AuthPageProps = {
    authMode,
    googleOnly,
    initialPrompt: simplifiedAuth,
    initialView: initialAuthView(opts, authMode, googleOnly),
    appBasePath,
    homePath: appHomePath,
    workspaceRuntime,
    trackingApp,
    defaultLocale: DEFAULT_LOCALE,
    localeStorageKey: LOCALE_STORAGE_KEY,
    locales: AUTH_LOCALE_COPY,
    localeMetadata: LOCALE_METADATA,
    localeOptions: SUPPORTED_LOCALES.map((locale) => ({
      value: locale,
      label: localeDisplayName(locale),
    })),
    marketing: hasMarketing && marketing ? marketing : undefined,
    marketingLocales: authMarketingLocales,
    brandMarkSrc,
    githubUrl: "https://github.com/BuilderIO/agent-native",
    showGoogle,
    signupLegalNotice,
    signupLocalModeNote,
    connectionLabel: getConnectionLabel(),
    docsAuthUrl: docsUrl("authentication", {
      hash: "local-development-sign-in",
    }),
    identitySsoEnabled,
    publicOAuthOrigin,
    workspaceGatewayReturnOrigin,
    googleAuthMode,
    builderPreviewLocalDevEnabled,
    environmentBetaHosts: ENVIRONMENT_BETA_HOSTS,
    betaForceQueryParam: BETA_FORCE_QUERY_PARAM,
    betaForceSessionStorageKey: BETA_FORCE_SESSION_STORAGE_KEY,
    betaOptOutQueryParam: BETA_OPT_OUT_QUERY_PARAM,
    betaOptOutStorageKey: BETA_OPT_OUT_STORAGE_KEY,
    betaOptOutDurationMs: BETA_OPT_OUT_DURATION_MS,
    passwordMinLength: PASSWORD_MIN_LENGTH,
    passwordMaxLength: PASSWORD_MAX_LENGTH,
    passwordMaxCopy: `Choose a password with no more than ${PASSWORD_MAX_LENGTH} characters.`,
  };
  const authPageData = serializeAuthPageData(authPageProps);

  const authDocumentStyles = `\n
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #0a0a0a;
    color: #e5e5e5;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 1rem;
  }
  .locale-picker {
    position: fixed;
    top: max(1rem, env(safe-area-inset-top));
    inset-inline-end: max(1rem, env(safe-area-inset-right));
    z-index: 40;
  }
  .locale-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    background: rgba(20,20,20,0.82);
    color: #e5e5e5;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 8px;
    cursor: pointer;
    outline: none;
    backdrop-filter: blur(12px);
  }
  .locale-trigger svg {
    width: 1rem;
    height: 1rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .locale-trigger:hover,
  .locale-trigger[aria-expanded="true"] {
    border-color: rgba(255,255,255,0.22);
    background: rgba(28,28,28,0.92);
  }
  .locale-trigger:focus {
    border-color: rgba(255,255,255,0.42);
    box-shadow: 0 0 0 3px rgba(255,255,255,0.08);
  }
  .locale-menu {
    position: absolute;
    top: calc(100% + 0.375rem);
    inset-inline-end: 0;
    min-width: 14rem;
    max-height: min(22rem, calc(100vh - 4rem));
    overflow-y: auto;
    padding: 0.25rem;
    background: rgba(20,20,20,0.94);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 10px;
    box-shadow: 0 18px 50px rgba(0,0,0,0.42);
    backdrop-filter: blur(14px);
  }
  .locale-menu[hidden] { display: none; }
  .locale-menu-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2rem;
    padding: 0.375rem 0.5rem;
    background: transparent;
    border: 0;
    border-radius: 7px;
    color: #a1a1aa;
    cursor: pointer;
    font: inherit;
    font-size: 0.8125rem;
    text-align: start;
  }
  .locale-menu-item:hover,
  .locale-menu-item:focus {
    background: rgba(255,255,255,0.07);
    color: #fff;
    outline: none;
  }
  .locale-menu-item[aria-checked="true"] {
    color: #fff;
    background: rgba(255,255,255,0.08);
  }
  .locale-menu-check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    color: #33C4FF;
    opacity: 0;
  }
  .locale-menu-item[aria-checked="true"] .locale-menu-check {
    opacity: 1;
  }
  /* guard:allow-raw-color - standalone auth HTML has no app theme token layer */
  .environment-switcher {
    position: fixed;
    left: max(0.75rem, env(safe-area-inset-left));
    bottom: max(0.75rem, env(safe-area-inset-bottom));
    z-index: 100;
  }
  .environment-switcher[hidden],
  .environment-popover[hidden] { display: none; }
  .environment-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 1.5rem;
    min-width: 0;
    padding: 0 0.5rem;
    background: #3a3a3a;
    color: #fff;
    border: 1px solid rgba(255,255,255,0.16);
    border-radius: 0.75rem;
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    font: inherit;
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.03125rem;
    line-height: 1;
    text-transform: uppercase;
    cursor: pointer;
  }
  .environment-badge:hover,
  .environment-badge[aria-expanded="true"] { background: #4a4a4a; }
  .environment-badge:focus-visible,
  .environment-production-link:focus-visible,
  .environment-hide-badge:focus-visible {
    outline: 2px solid #33c4ff;
    outline-offset: 2px;
  }
  .environment-popover {
    position: absolute;
    left: 0;
    bottom: calc(100% + 0.5rem);
    width: min(17.5rem, calc(100vw - 1.5rem));
    box-sizing: border-box;
    padding: 1.25rem;
    background: #141414;
    color: #fff;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 0.75rem;
    box-shadow: 0 18px 50px rgba(0,0,0,0.42);
  }
  .environment-popover-title { margin-bottom: 0.25rem; font-size: 0.875rem; font-weight: 600; line-height: 1.25rem; }
  .environment-popover-copy { margin-bottom: 1rem; color: #888; font-size: 0.875rem; line-height: 1.25rem; }
  .environment-production-link {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 2rem;
    padding: 0.375rem 0.75rem;
    color: #e5e5e5;
    border: 1px solid rgba(255,255,255,0.16);
    border-radius: 0.375rem;
    font-size: 0.8125rem;
    text-decoration: none;
  }
  .environment-production-link:hover { background: #242424; }
  .environment-hide-badge {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 2rem;
    margin-top: 0.5rem;
    margin-bottom: -0.5rem;
    padding: 0.375rem 0.75rem;
    color: inherit;
    opacity: 0.65;
    border: 0;
    background: transparent;
    font: inherit;
    font-size: 0.8125rem;
    cursor: pointer;
  }
  .environment-hide-badge:hover { opacity: 1; }
  .card {
    width: 100%;
    max-width: 400px;
    padding: 2rem;
    background: #141414;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
  }
  h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.25rem; color: #fff; }
  .subtitle { font-size: 0.8125rem; color: #888; margin-bottom: 1.5rem; }
  .tabs {
    display: inline-flex;
    width: 100%;
    padding: 4px;
    margin-bottom: 1.5rem;
    background: rgba(255,255,255,0.06);
    border-radius: 8px;
  }
  .tabs[hidden] { display: none; }
  .tab {
    flex: 1;
    padding: 0.5rem 0.75rem;
    background: none;
    border: none;
    color: #888;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    border-radius: 6px;
  }
  .tab.active {
    background: #3a3a3a;
    color: #fff;
    box-shadow: 0 1px 2px rgba(0,0,0,0.3);
  }
  .tab:hover:not(.active) { color: #bbb; }
  .form { display: none; }
  .form.active { display: block; }
  .card.verifying .tabs,
  .card.verifying #google-btn,
  .card.verifying #google-err,
  .card.verifying #auth-divider,
  .card.verifying #upgrade-note {
    display: none;
  }
  label { display: block; font-size: 0.8125rem; color: #888; margin-bottom: 0.375rem; }
  input {
    width: 100%;
    padding: 0.5rem 0.75rem;
    background: transparent;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 6px;
    color: #e5e5e5;
    font-size: 0.875rem;
    outline: none;
    margin-bottom: 0.875rem;
  }
  input:focus { border-color: rgba(255,255,255,0.3); box-shadow: 0 0 0 1px rgba(255,255,255,0.1); }
  input::placeholder { color: #555; }
  button[type="submit"], .btn-primary {
    width: 100%;
    margin-top: 0.25rem;
    padding: 0.5rem;
    background: #fff;
    color: #000;
    border: none;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
  }
  button[type="submit"]:hover, .btn-primary:hover { background: #e5e5e5; }
  button[type="submit"]:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary {
    width: 100%;
    margin-top: 0.75rem;
    padding: 0.5rem;
    background: transparent;
    color: #888;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px;
    font-size: 0.8125rem;
    cursor: pointer;
  }
  .btn-secondary:hover { color: #bbb; border-color: rgba(255,255,255,0.2); }
  .local-dev-signin {
    margin: 1.25rem 0 0.25rem;
    padding-top: 1rem;
    border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  }
  .btn-local-dev {
    margin-top: 0.25rem;
  }
  .btn-local-dev:disabled { opacity: 0.5; cursor: wait; }
  .local-dev-description {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    margin: 0.5rem 0 0;
    color: color-mix(in srgb, currentColor 50%, transparent);
    font-size: 0.6875rem;
    line-height: 1.45;
    text-align: center;
  }
  .local-dev-help {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 1.5rem;
    height: 1.5rem;
    margin: -0.375rem;
    color: inherit;
    text-decoration: none;
  }
  .local-dev-help-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 0.625rem;
    height: 0.625rem;
    border: 1px solid currentColor;
    border-radius: 50%;
    font-size: 0.4375rem;
    font-weight: 600;
    line-height: 1;
  }
  .local-dev-help:hover { color: currentColor; }
  .local-dev-help:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }
  .local-dev-full-options {
    display: block;
    margin: 0.75rem auto 0;
    padding: 0;
    background: transparent;
    border: 0;
    color: color-mix(in srgb, currentColor 62%, transparent);
    font-size: 0.75rem;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .local-dev-full-options:hover { color: currentColor; }
  .local-dev-full-options[hidden] { display: none; }
  .full-auth-options { margin-top: 1rem; }
  .full-auth-options[hidden] { display: none; }
  .legal-note {
    margin-top: 0.375rem;
    margin-bottom: 0.875rem;
    color: #666;
    font-size: 0.6875rem;
    line-height: 1.45;
    text-align: start;
  }
  .legal-note a {
    color: #777;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .legal-note a:hover { color: #aaa; }
  .signup-local-mode-note {
    margin-top: 0.75rem;
    padding: 0.625rem;
    color: #777;
    background: rgba(255,255,255,0.025);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    font-size: 0.6875rem;
    line-height: 1.45;
    text-align: left;
  }
  .signup-local-mode-note p {
    margin: 0 0 0.5rem;
  }
  .signup-local-mode-note code {
    display: block;
    overflow-x: auto;
    padding-bottom: 0.125rem;
    color: #b8b8b8;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 0.6875rem;
    line-height: 1.5;
    white-space: nowrap;
  }
  .signup-local-mode-note .copy-run-local {
    margin-top: 0.5rem;
  }
  .msg { margin-top: 0.75rem; font-size: 0.8125rem; display: none; }
  .msg.error { color: #f87171; }
  .msg.success { color: #33C4FF; }
  .msg.show { display: block; }
  .step-progress {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.5rem;
    margin-bottom: 1.25rem;
  }
  .progress-step {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.375rem;
    color: #666;
    font-size: 0.6875rem;
    line-height: 1.2;
    text-align: center;
  }
  .progress-step::before {
    content: '';
    position: absolute;
    top: 11px;
    left: calc(-50% + 16px);
    width: calc(100% - 32px);
    height: 1px;
    background: rgba(255,255,255,0.1);
  }
  .progress-step:first-child::before { display: none; }
  .progress-step span {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.14);
    background: #151515;
    color: #777;
    font-size: 0.6875rem;
    font-weight: 600;
  }
  .progress-step strong { font-weight: 500; }
  .progress-step.complete,
  .progress-step.current { color: #e5e5e5; }
  .progress-step.complete span {
    background: rgba(0,181,255,0.16);
    border-color: rgba(0,181,255,0.55);
    color: #dff7ff;
  }
  .progress-step.current span {
    background: #fff;
    border-color: #fff;
    color: #000;
    box-shadow: 0 0 0 4px rgba(255,255,255,0.08);
  }
  .verification-panel {
    padding: 1rem;
    margin-bottom: 0.875rem;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
  }
  .verification-kicker {
    margin-bottom: 0.5rem;
    color: #33C4FF;
    font-size: 0.75rem;
    font-weight: 500;
  }
  .verification-copy {
    color: #d4d4d8;
    font-size: 0.875rem;
    line-height: 1.55;
  }
  .verification-copy strong {
    color: #fff;
    font-weight: 600;
    word-break: break-word;
  }
  .verification-note {
    margin-top: 0.75rem;
    color: #71717a;
    font-size: 0.75rem;
    line-height: 1.45;
  }
  .inline-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-top: 0.75rem;
  }
  .link-button {
    padding: 0.25rem 0;
    background: none;
    border: none;
    color: #888;
    cursor: pointer;
    font-size: 0.75rem;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .auth-mode-link { text-decoration: none; }
  .link-button:hover { color: #bbb; }
  .link-button:disabled { cursor: wait; opacity: 0.5; }
  .magic-link-submit { display: block; }
  .magic-link-success { display: none; }
  .magic-link-success.is-visible { display: block; }
  .magic-link-success-copy {
    margin: 0;
    color: rgba(255,255,255,0.62); /* guard:allow-raw-color - standalone auth HTML has no app theme token layer */
    font-size: 0.875rem;
    line-height: 1.5;
  }
  .magic-link-success-copy strong {
    color: inherit;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .magic-link-back {
    margin-top: 1.5rem;
    text-decoration: none;
  }
  .btn-google.magic-link-secondary {
    background: transparent;
    color: inherit;
    border: 1px solid rgba(255,255,255,0.16); /* guard:allow-raw-color - standalone auth HTML has no app theme token layer */
  }
  .btn-google.magic-link-secondary:hover {
    background: rgba(255,255,255,0.05); /* guard:allow-raw-color - standalone auth HTML has no app theme token layer */
  }
  .card.magic-link-complete .subtitle,
  .card.magic-link-complete #google-signin,
${identitySsoMagicLinkSelector}
  .card.magic-link-complete #auth-divider,
  .card.magic-link-complete #auth-tabs,
  .card.magic-link-complete #upgrade-note,
  .card.magic-link-complete .form {
    display: none;
  }
  .divider {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 1.25rem 0;
    font-size: 0.75rem;
    color: #555;
  }
  .divider::before, .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: rgba(255,255,255,0.08);
  }
  .upgrade-note {
    margin-bottom: 1rem;
    padding: 0.75rem;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    background: rgba(255,255,255,0.03);
    font-size: 0.75rem;
    line-height: 1.5;
    color: #a1a1aa;
    display: none;
  }
  .upgrade-note.show { display: block; }
  .btn-google {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.625rem;
    padding: 0.5rem;
    background: #fff;
    color: #000;
    border: none;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
  }
  .btn-google:hover { background: #e5e5e5; }
  .btn-google:disabled { opacity: 0.5; cursor: wait; }
  .btn-google svg { width: 18px; height: 18px; flex-shrink: 0; }
  .google-signin {
    position: relative;
    width: 100%;
  }
  .google-error { margin-top: 0.5rem; font-size: 0.8125rem; color: #f87171; display: none; }
  .google-error.show { display: block; }
  .google-debug {
    display: none;
    margin-top: 0.5rem;
    font-size: 0.6875rem;
    line-height: 1.45;
    color: #777;
    word-break: break-word;
  }
  .google-debug.show { display: block; }
  .local-note {
    display: none;
    max-width: 400px;
    width: 100%;
    margin-top: 1rem;
    padding: 0.625rem 0.875rem;
    font-size: 0.6875rem;
    line-height: 1.5;
    color: #666;
    border: 1px dashed rgba(255,255,255,0.08);
    border-radius: 8px;
    text-align: center;
  }
  .local-note.show { display: block; }
  .local-note strong { color: #999; font-weight: 500; }
  .local-note a { color: #888; text-decoration: none; }
  .local-note a:hover { color: #bbb; }
${marketingStyles}
  /* guard:allow-raw-color - standalone auth HTML has no app theme token layer */
  body.simplified-auth { background: #141414; }
  body.simplified-auth .card { border-color: transparent; box-shadow: none; }
  body.simplified-auth .local-note { display: none !important; }
${embeddedAuthCss}
`;
  const authPageLayoutStyles = `
  .auth-root { width: 100%; }
  .auth-marketing-home { width: 100%; padding: 0; position: relative; overflow-x: hidden; }
  .auth-marketing-shell { padding: 0; }
  .auth-marketing-home .split { width: 100%; }
  .auth-marketing-home .marketing-panel { min-width: 0; }
  .auth-marketing-home .form-panel { min-width: 0; }
  .auth-marketing-home [data-agent-native-starfield] { position: fixed; inset: 0; width: 100%; height: 100%; }
  @media (max-width: 900px) {
    .auth-marketing-home .auth-marketing-shell { display: block; }
  }
`;
  const authClientScriptPath = authClientAssetPath(appBasePath);
  const title = hasMarketing
    ? `${marketing!.appName} — ${t("pageTitleSignIn")}`
    : t("pageTitleWelcome");
  const authDocumentMarkup = renderToString(
    createElement(
      "html",
      { lang: DEFAULT_LOCALE, dir: "ltr" },
      createElement(
        "head",
        null,
        createElement("meta", { charSet: "UTF-8" }),
        createElement("script", {
          "data-agent-native-locale-init": "",
          dangerouslySetInnerHTML: { __html: localeInitScript },
        }),
        createElement("script", {
          "data-agent-native-embedded-init": "",
          dangerouslySetInnerHTML: { __html: embeddedAuthInitScript },
        }),
        createElement("meta", {
          name: "viewport",
          content:
            "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
        }),
        createElement("title", null, title),
        createElement("link", {
          rel: "icon",
          type: "image/svg+xml",
          href: withAppBasePath("/favicon.svg", appBasePath),
        }),
        createElement("link", {
          rel: "apple-touch-icon",
          href: withAppBasePath("/icon-180.svg", appBasePath),
        }),
        hasMarketing
          ? [
              createElement("meta", {
                key: "description",
                name: "description",
                content: marketing!.tagline,
              }),
              createElement("meta", {
                key: "og-title",
                property: "og:title",
                content: marketing!.appName,
              }),
              createElement("meta", {
                key: "og-description",
                property: "og:description",
                content: marketing!.tagline,
              }),
              createElement("meta", {
                key: "og-image",
                property: "og:image",
                content: socialImageUrl,
              }),
              createElement("meta", {
                key: "og-image-secure",
                property: "og:image:secure_url",
                content: socialImageUrl,
              }),
              createElement("meta", {
                key: "og-image-type",
                property: "og:image:type",
                content: AGENT_NATIVE_SOCIAL_IMAGE_TYPE,
              }),
              createElement("meta", {
                key: "og-image-width",
                property: "og:image:width",
                content: AGENT_NATIVE_SOCIAL_IMAGE_WIDTH,
              }),
              createElement("meta", {
                key: "og-image-height",
                property: "og:image:height",
                content: AGENT_NATIVE_SOCIAL_IMAGE_HEIGHT,
              }),
              createElement("meta", {
                key: "og-image-alt",
                property: "og:image:alt",
                content: AGENT_NATIVE_SOCIAL_IMAGE_ALT,
              }),
              createElement("meta", {
                key: "twitter-card",
                name: "twitter:card",
                content: "summary_large_image",
              }),
              createElement("meta", {
                key: "twitter-image",
                name: "twitter:image",
                content: socialImageUrl,
              }),
              createElement("meta", {
                key: "twitter-image-alt",
                name: "twitter:image:alt",
                content: AGENT_NATIVE_SOCIAL_IMAGE_ALT,
              }),
            ]
          : null,
        createElement("style", {
          dangerouslySetInnerHTML: {
            __html: authDocumentStyles + authPageLayoutStyles,
          },
        }),
        createElement("script", {
          type: "module",
          src: authClientScriptPath,
        }),
      ),
      createElement(
        "body",
        {
          className: simplifiedAuth
            ? "simplified-auth"
            : hasMarketing
              ? "has-marketing"
              : undefined,
        },
        createElement(
          "div",
          { id: "agent-native-auth-root", className: "auth-root" },
          createElement(AuthPage, authPageProps),
        ),
        createElement("script", {
          type: "application/json",
          id: "agent-native-auth-data",
          dangerouslySetInnerHTML: { __html: authPageData },
        }),
      ),
    ),
  );
  return `<!DOCTYPE html>${authDocumentMarkup}`;
}

/** @deprecated Use getOnboardingHtml() instead */
export const ONBOARDING_HTML = getOnboardingHtml();

const RESET_PASSWORD_STYLES = `
  /* guard:allow-raw-color - standalone reset page has no app theme token layer */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0a0a0a; color: #e5e5e5; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 1rem; }
  .card { width: 100%; max-width: 400px; padding: 2rem; background: #141414; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; }
  h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.25rem; color: #fff; }
  .subtitle { font-size: 0.8125rem; color: #888; margin-bottom: 1.5rem; }
  label { display: block; font-size: 0.8125rem; color: #888; margin-bottom: 0.375rem; }
  input { width: 100%; padding: 0.5rem 0.75rem; background: transparent; border: 1px solid rgba(255,255,255,0.12); border-radius: 6px; color: #e5e5e5; font-size: 0.875rem; outline: none; margin-bottom: 0.875rem; }
  input:focus { border-color: rgba(255,255,255,0.3); box-shadow: 0 0 0 1px rgba(255,255,255,0.1); }
  input::placeholder { color: #555; }
  button[type="submit"] { width: 100%; margin-top: 0.25rem; padding: 0.5rem; background: #fff; color: #000; border: none; border-radius: 6px; font-size: 0.875rem; font-weight: 500; cursor: pointer; }
  button[type="submit"]:hover { background: #e5e5e5; }
  button[type="submit"]:disabled { opacity: 0.5; cursor: not-allowed; }
  .msg { margin-top: 0.75rem; font-size: 0.8125rem; display: none; }
  .msg.error { color: #f87171; }
  .msg.success { color: #33C4FF; }
  .msg.show { display: block; }
  .back { display: inline-block; margin-top: 1rem; font-size: 0.75rem; color: #888; text-decoration: none; }
  .back:hover { color: #bbb; }
`;

/** React document for the password reset page linked from auth email. */
export function getResetPasswordHtml(requestPath?: string): string {
  const configuredAppBasePath = getAppBasePathFromViteEnv();
  const appBasePath =
    configuredAppBasePath || workspaceBasePathFromRequest(requestPath);
  const resetPageProps = {
    pageType: "reset-password" as const,
    appBasePath,
    passwordMinLength: PASSWORD_MIN_LENGTH,
    passwordMaxLength: PASSWORD_MAX_LENGTH,
  };
  const resetDocumentMarkup = renderToString(
    createElement(
      "html",
      { lang: "en", dir: "ltr" },
      createElement(
        "head",
        null,
        createElement("meta", { charSet: "UTF-8" }),
        createElement("meta", {
          name: "viewport",
          content:
            "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
        }),
        createElement("title", null, "Reset password"),
        createElement("link", {
          rel: "icon",
          type: "image/svg+xml",
          href: withAppBasePath("/favicon.svg", appBasePath),
        }),
        createElement("link", {
          rel: "apple-touch-icon",
          href: withAppBasePath("/icon-180.svg", appBasePath),
        }),
        createElement("style", {
          dangerouslySetInnerHTML: { __html: RESET_PASSWORD_STYLES },
        }),
        createElement("script", {
          type: "module",
          src: authClientAssetPath(appBasePath),
        }),
      ),
      createElement(
        "body",
        null,
        createElement(
          "div",
          { id: "agent-native-auth-root" },
          createElement(ResetPasswordPage, resetPageProps),
        ),
        createElement("script", {
          type: "application/json",
          id: "agent-native-auth-data",
          dangerouslySetInnerHTML: {
            __html: serializeAuthPageData(resetPageProps),
          },
        }),
      ),
    ),
  );
  return `<!DOCTYPE html>${resetDocumentMarkup}`;
}
