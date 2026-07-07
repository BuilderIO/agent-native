/**
 * First-run onboarding page for agent-native apps.
 *
 * Shown when Better Auth is active and the user isn't signed in.
 * Provides a path to create or sign into an account from day one.
 *
 * After first account exists, this page acts as a normal login page.
 */

import { getLocaleInitScript } from "../localization/server.js";
import {
  DEFAULT_LOCALE,
  LOCALE_METADATA,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  type LocaleCode,
} from "../localization/shared.js";
import { AUTH_REDIRECT_QUERY_PARAM } from "../shared/auth-redirect-url.js";
import {
  AGENT_NATIVE_SOCIAL_IMAGE_ALT,
  AGENT_NATIVE_SOCIAL_IMAGE_HEIGHT,
  AGENT_NATIVE_SOCIAL_IMAGE_PATH,
  AGENT_NATIVE_SOCIAL_IMAGE_TYPE,
  AGENT_NATIVE_SOCIAL_IMAGE_WIDTH,
  withAgentNativeSocialImageCacheBuster,
} from "../shared/social-meta.js";
import { normalizeAppBasePath } from "./app-base-path.js";
import {
  BUILT_IN_AUTH_MARKETING,
  resolveBuiltInAuthMarketing,
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

function withAppBasePath(path: string): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const basePath = normalizeAppBasePath(
    process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH,
  );
  return `${basePath}${cleanPath}`;
}

const AGENT_NATIVE_TERMS_URL = "https://www.agent-native.com/terms";
const AGENT_NATIVE_PRIVACY_URL = "https://www.agent-native.com/privacy";

const EN_AUTH_COPY = {
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
  googleButton: "Sign in with Google",
  dividerOr: "or",
  createAccount: "Create account",
  signIn: "Sign in",
  email: "Email",
  password: "Password",
  confirmPassword: "Confirm password",
  passwordMinPlaceholder: "At least 8 characters",
  confirmPasswordPlaceholder: "Confirm password",
  enterPasswordPlaceholder: "Enter password",
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
  back: "Back",
  forgotPassword: "Forgot password?",
  sendResetLink: "Send reset link",
  backToSignIn: "Back to sign in",
  localNotePrefix: "Your account is stored in this app's own DB",
  localNoteSuffix: ", not a third-party service.",
  runLocally: "Run Locally",
  runLocallySentence: "Run locally",
  openSource: "100% free and open source",
  useOwnGoogleClient: "Use your own Google OAuth client:",
  copyCommand: "Copy command",
  copied: "Copied",
  close: "Close",
  closeGoogleChoices: "Close Google sign-in choices",
  legalPrefix: "By signing up, you accept our",
  legalTerms: "Terms",
  legalConnector: "and",
  legalPrivacy: "Privacy Policy",
  legalSuffix: ".",
  invalidEmail: "Enter a valid email address, like you@example.com.",
  signInToContinue: "Sign in to continue.",
  finishSignInFailed: "Could not finish sign-in automatically.",
  enterPasswordAfterVerification:
    "Enter your password after verifying your email.",
  finishSignInManually:
    "We could not finish sign-in automatically. Sign in to continue.",
  stillWaitingVerification:
    "Still waiting on verification. Click the link in your email, then try Continue again.",
  checkVerificationFailed: "Could not check verification. Please try again.",
  checking: "Checking...",
  checkingVerification: "Checking your verification...",
  sending: "Sending...",
  sent: "Sent",
  sentVerification: "Sent a fresh verification link.",
  resendVerificationFailed: "Could not resend the verification email.",
  networkErrorRetry: "Network error. Please try again.",
  networkErrorDashRetry: "Network error — please try again",
  passwordsMismatch: "Passwords do not match",
  creatingAccount: "Creating account…",
  registrationFailed: "Registration failed",
  accountCreatedSigningIn: "Account created — signing you in…",
  emailVerifiedFinishing: "Email verified. Finishing sign-in...",
  emailVerifiedSignIn: "Email verified. Sign in to continue.",
  resetEmailSent: "If that email exists, a reset link is on its way.",
  resetEmailFailed: "Could not send reset email.",
  signingIn: "Signing in…",
  invalidLogin: "Invalid email or password",
  googleNotConfigured: "Google OAuth is not configured.",
  failedToConnect: "Failed to connect. Please try again.",
  migrateLocalFallback: "Continue signing in to migrate local data.",
  googlePopupHelp: "Allow popups for this site and try again",
  googleNeverFinished:
    "Google sign-in did not finish. Check the Google OAuth redirect URI and server logs for [agent-native][google-oauth].",
};

const AUTH_LOCALE_COPY: Record<LocaleCode, typeof EN_AUTH_COPY> = {
  "en-US": EN_AUTH_COPY,
  "zh-CN": {
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
    googleButton: "使用 Google 登录",
    dividerOr: "或",
    createAccount: "创建账户",
    signIn: "登录",
    email: "电子邮箱",
    password: "密码",
    confirmPassword: "确认密码",
    passwordMinPlaceholder: "至少 8 个字符",
    confirmPasswordPlaceholder: "确认密码",
    enterPasswordPlaceholder: "输入密码",
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
    back: "返回",
    forgotPassword: "忘记密码？",
    sendResetLink: "发送重置链接",
    backToSignIn: "返回登录",
    localNotePrefix: "你的账户存储在此应用自己的数据库中",
    localNoteSuffix: "，而不是第三方服务。",
    runLocally: "本地运行",
    runLocallySentence: "本地运行",
    openSource: "100% 免费且开源",
    useOwnGoogleClient: "使用你自己的 Google OAuth 客户端：",
    copyCommand: "复制命令",
    copied: "已复制",
    close: "关闭",
    closeGoogleChoices: "关闭 Google 登录选项",
    legalPrefix: "注册即表示你接受我们的",
    legalTerms: "条款",
    legalConnector: "和",
    legalPrivacy: "隐私政策",
    legalSuffix: "。",
    invalidEmail: "请输入有效邮箱地址，例如 you@example.com。",
    signInToContinue: "登录以继续。",
    finishSignInFailed: "无法自动完成登录。",
    enterPasswordAfterVerification: "验证邮箱后请输入密码。",
    finishSignInManually: "无法自动完成登录。请登录以继续。",
    stillWaitingVerification:
      "仍在等待验证。请点击邮件中的链接，然后再次点击继续。",
    checkVerificationFailed: "无法检查验证状态。请重试。",
    checking: "正在检查...",
    checkingVerification: "正在检查验证状态...",
    sending: "正在发送...",
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
    signingIn: "正在登录…",
    invalidLogin: "邮箱或密码无效",
    googleNotConfigured: "Google OAuth 未配置。",
    failedToConnect: "连接失败。请重试。",
    migrateLocalFallback: "继续登录以迁移本地数据。",
    googlePopupHelp: "请允许此网站弹出窗口后重试",
    googleNeverFinished:
      "Google 登录未完成。请检查 Google OAuth 重定向 URI 和服务器日志中的 [agent-native][google-oauth]。",
  },
  "zh-TW": {
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
    googleButton: "使用 Google 登入",
    dividerOr: "或",
    createAccount: "建立帳號",
    signIn: "登入",
    email: "電子郵件",
    password: "密碼",
    confirmPassword: "確認密碼",
    passwordMinPlaceholder: "至少 8 個字元",
    confirmPasswordPlaceholder: "確認密碼",
    enterPasswordPlaceholder: "輸入密碼",
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
    back: "返回",
    forgotPassword: "忘記密碼？",
    sendResetLink: "寄送重設連結",
    backToSignIn: "返回登入",
    localNotePrefix: "你的帳號儲存在此應用程式自己的資料庫中",
    localNoteSuffix: "，而不是第三方服務。",
    runLocally: "在本機執行",
    runLocallySentence: "在本機執行",
    openSource: "100% 免費且開源",
    useOwnGoogleClient: "使用你自己的 Google OAuth 用戶端：",
    copyCommand: "複製指令",
    copied: "已複製",
    close: "關閉",
    closeGoogleChoices: "關閉 Google 登入選項",
    legalPrefix: "註冊即表示你接受我們的",
    legalTerms: "條款",
    legalConnector: "和",
    legalPrivacy: "隱私權政策",
    legalSuffix: "。",
    invalidEmail: "請輸入有效的電子郵件地址，例如 you@example.com。",
    signInToContinue: "登入以繼續。",
    finishSignInFailed: "無法自動完成登入。",
    enterPasswordAfterVerification: "驗證電子郵件後請輸入密碼。",
    finishSignInManually: "無法自動完成登入。請登入以繼續。",
    stillWaitingVerification:
      "仍在等待驗證。請點擊郵件中的連結，然後再次點擊繼續。",
    checkVerificationFailed: "無法檢查驗證狀態。請重試。",
    checking: "正在檢查...",
    checkingVerification: "正在檢查驗證狀態...",
    sending: "正在寄送...",
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
    signingIn: "正在登入...",
    invalidLogin: "電子郵件或密碼無效",
    googleNotConfigured: "Google OAuth 尚未設定。",
    failedToConnect: "連線失敗。請重試。",
    migrateLocalFallback: "繼續登入以遷移本機資料。",
    googlePopupHelp: "請允許此網站開啟彈出式視窗後重試",
    googleNeverFinished:
      "Google 登入未完成。請檢查 Google OAuth 重新導向 URI，以及伺服器記錄中的 [agent-native][google-oauth]。",
  },
  "es-ES": {
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
    googleButton: "Iniciar sesión con Google",
    dividerOr: "o",
    createAccount: "Crear cuenta",
    signIn: "Iniciar sesión",
    email: "Email",
    password: "Contraseña",
    confirmPassword: "Confirmar contraseña",
    passwordMinPlaceholder: "Al menos 8 caracteres",
    confirmPasswordPlaceholder: "Confirmar contraseña",
    enterPasswordPlaceholder: "Introduce la contraseña",
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
    back: "Volver",
    forgotPassword: "¿Olvidaste tu contraseña?",
    sendResetLink: "Enviar enlace de restablecimiento",
    backToSignIn: "Volver a iniciar sesión",
    localNotePrefix:
      "Tu cuenta se almacena en la propia base de datos de esta app",
    localNoteSuffix: ", no en un servicio de terceros.",
    runLocally: "Ejecutar localmente",
    runLocallySentence: "Ejecutar localmente",
    openSource: "100% gratis y de código abierto",
    useOwnGoogleClient: "Usa tu propio cliente de Google OAuth:",
    copyCommand: "Copiar comando",
    copied: "Copiado",
    close: "Cerrar",
    closeGoogleChoices: "Cerrar opciones de inicio con Google",
    legalPrefix: "Al registrarte, aceptas nuestros",
    legalTerms: "Términos",
    legalConnector: "y",
    legalPrivacy: "Política de privacidad",
    legalSuffix: ".",
    invalidEmail: "Introduce un email válido, como you@example.com.",
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
    checking: "Comprobando...",
    checkingVerification: "Comprobando tu verificación...",
    sending: "Enviando...",
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
    signingIn: "Iniciando sesión…",
    invalidLogin: "Email o contraseña no válidos",
    googleNotConfigured: "Google OAuth no está configurado.",
    failedToConnect: "No se pudo conectar. Inténtalo de nuevo.",
    migrateLocalFallback: "Sigue iniciando sesión para migrar datos locales.",
    googlePopupHelp:
      "Permite ventanas emergentes para este sitio e inténtalo de nuevo",
    googleNeverFinished:
      "El inicio de sesión con Google no terminó. Comprueba el URI de redirección de Google OAuth y los logs del servidor para [agent-native][google-oauth].",
  },
  "fr-FR": {
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
    googleButton: "Se connecter avec Google",
    dividerOr: "ou",
    createAccount: "Créer un compte",
    signIn: "Connexion",
    email: "E-mail",
    password: "Mot de passe",
    confirmPassword: "Confirmer le mot de passe",
    passwordMinPlaceholder: "Au moins 8 caractères",
    confirmPasswordPlaceholder: "Confirmer le mot de passe",
    enterPasswordPlaceholder: "Saisir le mot de passe",
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
    back: "Retour",
    forgotPassword: "Mot de passe oublié ?",
    sendResetLink: "Envoyer le lien de réinitialisation",
    backToSignIn: "Retour à la connexion",
    localNotePrefix:
      "Votre compte est stocké dans la base de données propre à cette app",
    localNoteSuffix: ", pas dans un service tiers.",
    runLocally: "Exécuter localement",
    runLocallySentence: "Exécuter localement",
    openSource: "100 % gratuit et open source",
    useOwnGoogleClient: "Utilisez votre propre client Google OAuth :",
    copyCommand: "Copier la commande",
    copied: "Copié",
    close: "Fermer",
    closeGoogleChoices: "Fermer les choix de connexion Google",
    legalPrefix: "En vous inscrivant, vous acceptez nos",
    legalTerms: "Conditions",
    legalConnector: "et",
    legalPrivacy: "Politique de confidentialité",
    legalSuffix: ".",
    invalidEmail: "Saisissez une adresse e-mail valide, comme you@example.com.",
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
    checking: "Vérification...",
    checkingVerification: "Vérification en cours...",
    sending: "Envoi...",
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
    signingIn: "Connexion…",
    invalidLogin: "E-mail ou mot de passe invalide",
    googleNotConfigured: "Google OAuth n'est pas configuré.",
    failedToConnect: "Connexion impossible. Veuillez réessayer.",
    migrateLocalFallback:
      "Continuez la connexion pour migrer les données locales.",
    googlePopupHelp: "Autorisez les fenêtres pop-up pour ce site et réessayez",
    googleNeverFinished:
      "La connexion Google n'a pas abouti. Vérifiez l'URI de redirection Google OAuth et les logs serveur pour [agent-native][google-oauth].",
  },
  "de-DE": {
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
    googleButton: "Mit Google anmelden",
    dividerOr: "oder",
    createAccount: "Konto erstellen",
    signIn: "Anmelden",
    email: "E-Mail",
    password: "Passwort",
    confirmPassword: "Passwort bestätigen",
    passwordMinPlaceholder: "Mindestens 8 Zeichen",
    confirmPasswordPlaceholder: "Passwort bestätigen",
    enterPasswordPlaceholder: "Passwort eingeben",
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
    back: "Zurück",
    forgotPassword: "Passwort vergessen?",
    sendResetLink: "Reset-Link senden",
    backToSignIn: "Zurück zur Anmeldung",
    localNotePrefix:
      "Dein Konto wird in der eigenen Datenbank dieser App gespeichert",
    localNoteSuffix: ", nicht bei einem Drittanbieter.",
    runLocally: "Lokal ausführen",
    runLocallySentence: "Lokal ausführen",
    openSource: "100 % kostenlos und Open Source",
    useOwnGoogleClient: "Eigenen Google-OAuth-Client verwenden:",
    copyCommand: "Befehl kopieren",
    copied: "Kopiert",
    close: "Schließen",
    closeGoogleChoices: "Google-Anmeldeoptionen schließen",
    legalPrefix: "Mit der Registrierung akzeptierst du unsere",
    legalTerms: "Bedingungen",
    legalConnector: "und",
    legalPrivacy: "Datenschutzrichtlinie",
    legalSuffix: ".",
    invalidEmail: "Gib eine gültige E-Mail-Adresse ein, z. B. you@example.com.",
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
    checking: "Prüfen...",
    checkingVerification: "Bestätigung wird geprüft...",
    sending: "Senden...",
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
    signingIn: "Anmeldung…",
    invalidLogin: "E-Mail oder Passwort ungültig",
    googleNotConfigured: "Google OAuth ist nicht konfiguriert.",
    failedToConnect: "Verbindung fehlgeschlagen. Bitte erneut versuchen.",
    migrateLocalFallback: "Melde dich weiter an, um lokale Daten zu migrieren.",
    googlePopupHelp: "Erlaube Pop-ups für diese Website und versuche es erneut",
    googleNeverFinished:
      "Die Google-Anmeldung wurde nicht abgeschlossen. Prüfe die Google-OAuth-Redirect-URI und Serverlogs für [agent-native][google-oauth].",
  },
  "ja-JP": {
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
    googleButton: "Google でサインイン",
    dividerOr: "または",
    createAccount: "アカウントを作成",
    signIn: "サインイン",
    email: "メール",
    password: "パスワード",
    confirmPassword: "パスワードを確認",
    passwordMinPlaceholder: "8 文字以上",
    confirmPasswordPlaceholder: "パスワードを確認",
    enterPasswordPlaceholder: "パスワードを入力",
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
    back: "戻る",
    forgotPassword: "パスワードをお忘れですか？",
    sendResetLink: "リセットリンクを送信",
    backToSignIn: "サインインに戻る",
    localNotePrefix: "アカウントはこのアプリ自身の DB に保存されます",
    localNoteSuffix: "。サードパーティサービスには保存されません。",
    runLocally: "ローカルで実行",
    runLocallySentence: "ローカルで実行",
    openSource: "100% 無料でオープンソース",
    useOwnGoogleClient: "自分の Google OAuth クライアントを使用:",
    copyCommand: "コマンドをコピー",
    copied: "コピーしました",
    close: "閉じる",
    closeGoogleChoices: "Google サインインの選択肢を閉じる",
    legalPrefix: "登録すると、以下に同意したものとみなされます:",
    legalTerms: "利用規約",
    legalConnector: "および",
    legalPrivacy: "プライバシーポリシー",
    legalSuffix: "。",
    invalidEmail:
      "you@example.com のような有効なメールアドレスを入力してください。",
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
    checking: "確認中...",
    checkingVerification: "確認状態をチェック中...",
    sending: "送信中...",
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
    signingIn: "サインイン中…",
    invalidLogin: "メールまたはパスワードが正しくありません",
    googleNotConfigured: "Google OAuth が設定されていません。",
    failedToConnect: "接続できませんでした。もう一度お試しください。",
    migrateLocalFallback: "サインインを続けてローカルデータを移行します。",
    googlePopupHelp:
      "このサイトのポップアップを許可してから、もう一度お試しください",
    googleNeverFinished:
      "Google サインインが完了しませんでした。Google OAuth リダイレクト URI と [agent-native][google-oauth] のサーバーログを確認してください。",
  },
  "ko-KR": {
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
    googleButton: "Google로 로그인",
    dividerOr: "또는",
    createAccount: "계정 만들기",
    signIn: "로그인",
    email: "이메일",
    password: "비밀번호",
    confirmPassword: "비밀번호 확인",
    passwordMinPlaceholder: "8자 이상",
    confirmPasswordPlaceholder: "비밀번호 확인",
    enterPasswordPlaceholder: "비밀번호 입력",
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
    back: "뒤로",
    forgotPassword: "비밀번호를 잊으셨나요?",
    sendResetLink: "재설정 링크 보내기",
    backToSignIn: "로그인으로 돌아가기",
    localNotePrefix: "계정은 이 앱의 자체 DB에 저장됩니다",
    localNoteSuffix: ", 타사 서비스가 아닙니다.",
    runLocally: "로컬에서 실행",
    runLocallySentence: "로컬에서 실행",
    openSource: "100% 무료 오픈 소스",
    useOwnGoogleClient: "내 Google OAuth 클라이언트 사용:",
    copyCommand: "명령 복사",
    copied: "복사됨",
    close: "닫기",
    closeGoogleChoices: "Google 로그인 선택 닫기",
    legalPrefix: "가입하면 다음에 동의하게 됩니다:",
    legalTerms: "약관",
    legalConnector: "및",
    legalPrivacy: "개인정보 처리방침",
    legalSuffix: ".",
    invalidEmail: "you@example.com 같은 올바른 이메일 주소를 입력하세요.",
    signInToContinue: "계속하려면 로그인하세요.",
    finishSignInFailed: "자동으로 로그인을 완료할 수 없습니다.",
    enterPasswordAfterVerification: "이메일을 확인한 후 비밀번호를 입력하세요.",
    finishSignInManually:
      "자동으로 로그인을 완료할 수 없습니다. 계속하려면 로그인하세요.",
    stillWaitingVerification:
      "아직 확인을 기다리고 있습니다. 이메일의 링크를 클릭한 뒤 계속을 다시 눌러주세요.",
    checkVerificationFailed: "확인 상태를 확인할 수 없습니다. 다시 시도하세요.",
    checking: "확인 중...",
    checkingVerification: "확인 상태 확인 중...",
    sending: "보내는 중...",
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
    signingIn: "로그인 중…",
    invalidLogin: "이메일 또는 비밀번호가 올바르지 않습니다",
    googleNotConfigured: "Google OAuth가 구성되지 않았습니다.",
    failedToConnect: "연결하지 못했습니다. 다시 시도하세요.",
    migrateLocalFallback: "계속 로그인하여 로컬 데이터를 마이그레이션하세요.",
    googlePopupHelp: "이 사이트의 팝업을 허용한 뒤 다시 시도하세요",
    googleNeverFinished:
      "Google 로그인이 완료되지 않았습니다. Google OAuth 리디렉션 URI와 [agent-native][google-oauth] 서버 로그를 확인하세요.",
  },
  "pt-BR": {
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
    googleButton: "Entrar com Google",
    dividerOr: "ou",
    createAccount: "Criar conta",
    signIn: "Entrar",
    email: "Email",
    password: "Senha",
    confirmPassword: "Confirmar senha",
    passwordMinPlaceholder: "Pelo menos 8 caracteres",
    confirmPasswordPlaceholder: "Confirmar senha",
    enterPasswordPlaceholder: "Digite a senha",
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
    back: "Voltar",
    forgotPassword: "Esqueceu a senha?",
    sendResetLink: "Enviar link de redefinição",
    backToSignIn: "Voltar para entrar",
    localNotePrefix:
      "Sua conta fica armazenada no banco de dados próprio deste app",
    localNoteSuffix: ", não em um serviço de terceiros.",
    runLocally: "Executar localmente",
    runLocallySentence: "Executar localmente",
    openSource: "100% grátis e open source",
    useOwnGoogleClient: "Use seu próprio cliente Google OAuth:",
    copyCommand: "Copiar comando",
    copied: "Copiado",
    close: "Fechar",
    closeGoogleChoices: "Fechar opções de login com Google",
    legalPrefix: "Ao se cadastrar, você aceita nossos",
    legalTerms: "Termos",
    legalConnector: "e",
    legalPrivacy: "Política de Privacidade",
    legalSuffix: ".",
    invalidEmail: "Digite um email válido, como you@example.com.",
    signInToContinue: "Entre para continuar.",
    finishSignInFailed: "Não foi possível concluir o login automaticamente.",
    enterPasswordAfterVerification:
      "Digite sua senha depois de verificar seu email.",
    finishSignInManually:
      "Não foi possível concluir o login automaticamente. Entre para continuar.",
    stillWaitingVerification:
      "Ainda estamos aguardando a verificação. Clique no link do email e tente Continuar novamente.",
    checkVerificationFailed: "Não foi possível verificar. Tente novamente.",
    checking: "Verificando...",
    checkingVerification: "Verificando sua confirmação...",
    sending: "Enviando...",
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
    signingIn: "Entrando…",
    invalidLogin: "Email ou senha inválidos",
    googleNotConfigured: "Google OAuth não está configurado.",
    failedToConnect: "Não foi possível conectar. Tente novamente.",
    migrateLocalFallback: "Continue entrando para migrar dados locais.",
    googlePopupHelp: "Permita pop-ups para este site e tente novamente",
    googleNeverFinished:
      "O login com Google não terminou. Confira o URI de redirecionamento do Google OAuth e os logs do servidor para [agent-native][google-oauth].",
  },
  "hi-IN": {
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
    googleButton: "Google से साइन इन करें",
    dividerOr: "या",
    createAccount: "खाता बनाएं",
    signIn: "साइन इन",
    email: "ईमेल",
    password: "पासवर्ड",
    confirmPassword: "पासवर्ड की पुष्टि करें",
    passwordMinPlaceholder: "कम से कम 8 अक्षर",
    confirmPasswordPlaceholder: "पासवर्ड की पुष्टि करें",
    enterPasswordPlaceholder: "पासवर्ड दर्ज करें",
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
    back: "वापस",
    forgotPassword: "पासवर्ड भूल गए?",
    sendResetLink: "रीसेट लिंक भेजें",
    backToSignIn: "साइन इन पर वापस जाएं",
    localNotePrefix: "आपका खाता इस ऐप के अपने DB में संग्रहीत है",
    localNoteSuffix: ", किसी third-party सेवा में नहीं।",
    runLocally: "लोकल चलाएं",
    runLocallySentence: "लोकल चलाएं",
    openSource: "100% मुफ्त और open source",
    useOwnGoogleClient: "अपना Google OAuth client उपयोग करें:",
    copyCommand: "कमांड कॉपी करें",
    copied: "कॉपी हो गया",
    close: "बंद करें",
    closeGoogleChoices: "Google साइन-इन विकल्प बंद करें",
    legalPrefix: "साइन अप करके, आप हमारी",
    legalTerms: "शर्तें",
    legalConnector: "और",
    legalPrivacy: "गोपनीयता नीति",
    legalSuffix: "स्वीकार करते हैं।",
    invalidEmail: "एक मान्य ईमेल पता दर्ज करें, जैसे you@example.com.",
    signInToContinue: "जारी रखने के लिए साइन इन करें।",
    finishSignInFailed: "साइन इन अपने आप पूरा नहीं हो सका।",
    enterPasswordAfterVerification: "ईमेल सत्यापित करने के बाद अपना पासवर्ड दर्ज करें।",
    finishSignInManually:
      "साइन इन अपने आप पूरा नहीं हो सका। जारी रखने के लिए साइन इन करें।",
    stillWaitingVerification:
      "सत्यापन का इंतजार है। ईमेल में लिंक खोलें, फिर Continue दोबारा दबाएं।",
    checkVerificationFailed: "सत्यापन जांच नहीं हो सकी। कृपया फिर कोशिश करें।",
    checking: "जांच हो रही है...",
    checkingVerification: "आपका सत्यापन जांच रहे हैं...",
    sending: "भेजा जा रहा है...",
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
    signingIn: "साइन इन हो रहा है…",
    invalidLogin: "ईमेल या पासवर्ड अमान्य है",
    googleNotConfigured: "Google OAuth configured नहीं है।",
    failedToConnect: "कनेक्ट नहीं हो सका। कृपया फिर कोशिश करें।",
    migrateLocalFallback: "स्थानीय डेटा माइग्रेट करने के लिए साइन इन जारी रखें।",
    googlePopupHelp: "इस साइट के लिए pop-ups allow करें और फिर कोशिश करें",
    googleNeverFinished:
      "Google साइन इन पूरा नहीं हुआ। Google OAuth redirect URI और [agent-native][google-oauth] के server logs देखें।",
  },
  "ar-SA": {
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
    googleButton: "تسجيل الدخول باستخدام Google",
    dividerOr: "أو",
    createAccount: "إنشاء حساب",
    signIn: "تسجيل الدخول",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    confirmPassword: "تأكيد كلمة المرور",
    passwordMinPlaceholder: "8 أحرف على الأقل",
    confirmPasswordPlaceholder: "تأكيد كلمة المرور",
    enterPasswordPlaceholder: "أدخل كلمة المرور",
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
    back: "رجوع",
    forgotPassword: "هل نسيت كلمة المرور؟",
    sendResetLink: "إرسال رابط إعادة التعيين",
    backToSignIn: "العودة إلى تسجيل الدخول",
    localNotePrefix: "يتم تخزين حسابك في قاعدة بيانات هذا التطبيق",
    localNoteSuffix: "، وليس في خدمة خارجية.",
    runLocally: "تشغيل محليًا",
    runLocallySentence: "تشغيل محليًا",
    openSource: "مجاني ومفتوح المصدر 100%",
    useOwnGoogleClient: "استخدم عميل Google OAuth الخاص بك:",
    copyCommand: "نسخ الأمر",
    copied: "تم النسخ",
    close: "إغلاق",
    closeGoogleChoices: "إغلاق خيارات تسجيل الدخول عبر Google",
    legalPrefix: "بالتسجيل، فإنك توافق على",
    legalTerms: "الشروط",
    legalConnector: "و",
    legalPrivacy: "سياسة الخصوصية",
    legalSuffix: ".",
    invalidEmail: "أدخل بريدًا إلكترونيًا صالحًا، مثل you@example.com.",
    signInToContinue: "سجّل الدخول للمتابعة.",
    finishSignInFailed: "تعذر إكمال تسجيل الدخول تلقائيًا.",
    enterPasswordAfterVerification:
      "أدخل كلمة المرور بعد التحقق من بريدك الإلكتروني.",
    finishSignInManually:
      "تعذر إكمال تسجيل الدخول تلقائيًا. سجّل الدخول للمتابعة.",
    stillWaitingVerification:
      "ما زلنا ننتظر التحقق. افتح الرابط في بريدك الإلكتروني ثم جرّب متابعة مرة أخرى.",
    checkVerificationFailed: "تعذر التحقق من الحالة. حاول مرة أخرى.",
    checking: "جارٍ التحقق...",
    checkingVerification: "جارٍ التحقق من حالتك...",
    sending: "جارٍ الإرسال...",
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
    signingIn: "جارٍ تسجيل الدخول…",
    invalidLogin: "البريد الإلكتروني أو كلمة المرور غير صحيحة",
    googleNotConfigured: "لم يتم إعداد Google OAuth.",
    failedToConnect: "تعذر الاتصال. حاول مرة أخرى.",
    migrateLocalFallback: "تابع تسجيل الدخول لترحيل البيانات المحلية.",
    googlePopupHelp: "اسمح بالنوافذ المنبثقة لهذا الموقع ثم حاول مرة أخرى",
    googleNeverFinished:
      "لم يكتمل تسجيل الدخول عبر Google. تحقق من URI إعادة التوجيه في Google OAuth وسجلات الخادم لـ [agent-native][google-oauth].",
  },
};

const defaultAuthCopy = AUTH_LOCALE_COPY[DEFAULT_LOCALE];

type AuthMarketingLocalization = Pick<
  AuthMarketingContent,
  "tagline" | "description" | "features"
>;

const AUTH_MARKETING_LOCALE_COPY: Partial<
  Record<LocaleCode, Record<string, Partial<AuthMarketingLocalization>>>
> = {
  "zh-CN": {
    forms: {
      tagline: "你的 AI 代理与你一起构建、发布和分析表单。",
      features: [
        "用一句话创建完整表单",
        "即时发布，生成可分享链接和验证码",
        "按需获取回复摘要、导出和趋势分析",
      ],
    },
  },
  "zh-TW": {
    forms: {
      tagline: "你的 AI 代理會和你一起建立、發布與分析表單。",
      features: [
        "用一句話建立完整表單",
        "立即發布，產生可分享連結與驗證碼",
        "依需求取得回覆摘要、匯出與趨勢分析",
      ],
    },
  },
  "es-ES": {
    forms: {
      tagline: "Tu agente de IA crea, publica y analiza formularios contigo.",
      features: [
        "Crea formularios completos con una sola frase",
        "Publicación instantánea con enlaces compartibles y captcha",
        "Resúmenes de respuestas, exportaciones y análisis de tendencias al instante",
      ],
    },
  },
  "fr-FR": {
    forms: {
      tagline:
        "Votre agent IA crée, publie et analyse des formulaires avec vous.",
      features: [
        "Créez des formulaires complets à partir d'une seule phrase",
        "Publication instantanée avec liens partageables et captcha",
        "Résumés de réponses, exports et analyse des tendances à la demande",
      ],
    },
  },
  "de-DE": {
    forms: {
      tagline:
        "Dein KI-Agent erstellt, veröffentlicht und analysiert Formulare mit dir.",
      features: [
        "Erstelle vollständige Formulare aus einem einzigen Satz",
        "Sofortige Veröffentlichung mit teilbaren Links und Captcha",
        "Antwortzusammenfassungen, Exporte und Trendanalysen auf Abruf",
      ],
    },
  },
  "ja-JP": {
    forms: {
      tagline: "AI エージェントがフォームの作成、公開、分析を一緒に進めます。",
      features: [
        "一文から完全なフォームを作成",
        "共有リンクと CAPTCHA 付きで即時公開",
        "回答の要約、エクスポート、トレンド分析を必要なときに実行",
      ],
    },
  },
  "ko-KR": {
    forms: {
      tagline: "AI 에이전트가 양식 생성, 게시, 분석을 함께 도와줍니다.",
      features: [
        "한 문장으로 완성된 양식 만들기",
        "공유 링크와 captcha로 즉시 게시",
        "응답 요약, 내보내기, 추세 분석을 필요할 때 실행",
      ],
    },
  },
  "pt-BR": {
    forms: {
      tagline:
        "Seu agente de IA cria, publica e analisa formulários junto com você.",
      features: [
        "Crie formulários completos a partir de uma única frase",
        "Publicação instantânea com links compartilháveis e captcha",
        "Resumos de respostas, exportações e análise de tendências sob demanda",
      ],
    },
  },
  "hi-IN": {
    forms: {
      tagline:
        "आपका AI एजेंट आपके साथ फ़ॉर्म बनाता, प्रकाशित करता और उनका विश्लेषण करता है।",
      features: [
        "एक वाक्य से पूरे फ़ॉर्म बनाएं",
        "शेयर करने योग्य लिंक और captcha के साथ तुरंत प्रकाशित करें",
        "ज़रूरत पड़ने पर प्रतिक्रिया सारांश, exports और trend analysis पाएं",
      ],
    },
  },
  "ar-SA": {
    forms: {
      tagline: "يساعدك وكيل الذكاء الاصطناعي على إنشاء النماذج ونشرها وتحليلها.",
      features: [
        "أنشئ نماذج كاملة من جملة واحدة",
        "نشر فوري مع روابط قابلة للمشاركة وcaptcha",
        "ملخصات للإجابات وتصدير وتحليل اتجاهات عند الطلب",
      ],
    },
  },
};

function resolveBuiltInMarketingSlug(
  marketing: AuthMarketingContent | undefined,
): string | undefined {
  if (!marketing) return undefined;
  for (const [slug, builtIn] of Object.entries(BUILT_IN_AUTH_MARKETING)) {
    if (
      marketing.appName === builtIn.appName &&
      marketing.tagline === builtIn.tagline
    ) {
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
   * Optional preflight copy shown before redirecting through Google sign-in.
   * Use this when a hosted app needs to warn about provider-specific consent
   * screens while leaving self-hosted deployments untouched.
   */
  googleSignInNotice?: {
    host?: string;
    title: string;
    body: string | string[];
    continueLabel?: string;
    cancelLabel?: string;
  };
  /**
   * Optional email signup legal copy. Builder-hosted `*.agent-native.com`
   * deployments get the Agent Native links automatically; self-hosted and
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

export function getOnboardingHtml(opts: OnboardingHtmlOptions = {}): string {
  const showGoogle = hasGoogleOAuth();
  const googleOnly = !!opts.googleOnly;
  // In a Google-only app, Google is the sole sign-in method, so always render
  // a working button — never gate it on env vars detected at render time. The
  // login page is a public, CDN-cacheable shell served to everyone (per-user
  // and per-config state is resolved client-side after load), so baking a
  // "not configured" message in here would freeze that error into the cache
  // for every visitor. A genuinely misconfigured server instead surfaces a
  // clear error at click time via the auth API.
  const renderGoogleButton = showGoogle || googleOnly;
  const appBasePath = normalizeAppBasePath(
    process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH,
  );
  const publicOAuthOrigin = getPublicOAuthOrigin();
  const workspaceGatewayReturnOrigin = getWorkspaceGatewayReturnOrigin();
  const googleAuthMode = resolveGoogleAuthMode(opts.googleAuthMode);
  const localeInitScript = getLocaleInitScript();

  const marketing: AuthMarketingContent | undefined =
    opts.marketing ??
    resolveBuiltInAuthMarketing({
      requestHost: opts.requestHost,
      requestPath: opts.requestPath,
    });
  const hasMarketing = !!marketing;
  const marketingSlug = resolveBuiltInMarketingSlug(marketing);
  const defaultMarketingCopy: Partial<AuthMarketingLocalization> | undefined =
    marketing
      ? {
          tagline: marketing.tagline,
          description: marketing.description,
          features: marketing.features,
        }
      : undefined;
  const runLocalCommand = marketing?.runLocalCommand?.trim();
  const signupLocalModeNote =
    isAgentNativeHostedHost(opts.requestHost) &&
    marketing?.signupLocalModeNote?.command.trim()
      ? {
          text: marketing.signupLocalModeNote.text.trim(),
          command: marketing.signupLocalModeNote.command.trim(),
        }
      : undefined;
  const brandMarkSrc = withAppBasePath("/agent-native-icon-dark.svg");
  const socialImageUrl = withAgentNativeSocialImageCacheBuster(
    opts.requestOrigin
      ? `${opts.requestOrigin}${withAppBasePath(AGENT_NATIVE_SOCIAL_IMAGE_PATH)}`
      : withAppBasePath(AGENT_NATIVE_SOCIAL_IMAGE_PATH),
  );
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const t = (key: keyof typeof EN_AUTH_COPY) => defaultAuthCopy[key];
  const i18nAttr = (key: keyof typeof EN_AUTH_COPY | undefined) =>
    key ? ` data-i18n="${key}"` : "";
  const i18nAriaAttr = (key: keyof typeof EN_AUTH_COPY | undefined) =>
    key ? ` data-i18n-aria-label="${key}"` : "";
  const i18nPlaceholderAttr = (key: keyof typeof EN_AUTH_COPY | undefined) =>
    key ? ` data-i18n-placeholder="${key}"` : "";
  const i18nDataAttr = (
    attr: string,
    key: keyof typeof EN_AUTH_COPY | undefined,
  ) => (key ? ` data-i18n-${attr}="${key}"` : "");
  const i18nText = (key: keyof typeof EN_AUTH_COPY) =>
    `<span${i18nAttr(key)}>${esc(t(key))}</span>`;
  const localizedValue = (
    value: string | undefined,
    key: keyof typeof EN_AUTH_COPY,
  ) => (value === undefined ? i18nText(key) : esc(value));
  const localizedAnchorLabel = (
    value: string | undefined,
    key: keyof typeof EN_AUTH_COPY,
  ) =>
    value === undefined ? `${i18nAttr(key)}>${esc(t(key))}` : `>${esc(value)}`;
  const localeMenuItemsHtml = [
    `    <button type="button" class="locale-menu-item" role="menuitemradio" aria-checked="false" data-locale-value="system">
      <span class="locale-menu-check" aria-hidden="true">✓</span>
      <span${i18nAttr("systemLanguage")}>${esc(t("systemLanguage"))}</span>
    </button>`,
    ...SUPPORTED_LOCALES.map((locale) => {
      const metadata = LOCALE_METADATA[locale];
      const label =
        metadata.nativeName === metadata.englishName
          ? `${metadata.nativeName} (${metadata.code})`
          : `${metadata.nativeName} (${metadata.englishName})`;
      return `    <button type="button" class="locale-menu-item" role="menuitemradio" aria-checked="false" data-locale-value="${esc(locale)}">
      <span class="locale-menu-check" aria-hidden="true">✓</span>
      <span>${esc(label)}</span>
    </button>`;
    }),
  ].join("\n");
  const localePickerHtml = `
<div class="locale-picker">
  <button type="button" class="locale-trigger" id="auth-locale-trigger" aria-haspopup="menu" aria-expanded="false" aria-controls="auth-locale-menu" aria-label="${esc(t("languageLabel"))}" title="${esc(t("languageLabel"))}"${i18nAriaAttr("languageLabel")} data-i18n-title="languageLabel">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5h7" />
      <path d="M7.5 4v1" />
      <path d="M9.5 5c-.8 4.4-2.6 7.2-5.5 9" />
      <path d="M5 9c1.2 2.1 3.2 3.8 6 5" />
      <path d="M13 20l4-9 4 9" />
      <path d="M14.5 17h5" />
    </svg>
  </button>
  <div class="locale-menu" id="auth-locale-menu" role="menu" aria-labelledby="auth-locale-trigger" hidden>
${localeMenuItemsHtml}
  </div>
</div>`;
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
  const signupLegalNoteHtml = signupLegalNotice
    ? `      <p class="legal-note">${localizedValue(signupLegalNotice.prefix, "legalPrefix")} <a href="${esc(signupLegalNotice.termsUrl)}" target="_blank" rel="noreferrer"${localizedAnchorLabel(signupLegalNotice.termsLabel, "legalTerms")}</a> ${localizedValue(signupLegalNotice.connector, "legalConnector")} <a href="${esc(signupLegalNotice.privacyUrl)}" target="_blank" rel="noreferrer"${localizedAnchorLabel(signupLegalNotice.privacyLabel, "legalPrivacy")}</a>${localizedValue(signupLegalNotice.suffix, "legalSuffix")}</p>`
    : "";
  const signupLocalModeNoteHtml = signupLocalModeNote
    ? `      <div class="signup-local-mode-note" id="signup-local-mode-note" data-command="${esc(signupLocalModeNote.command)}">
        <p>${esc(signupLocalModeNote.text)}</p>
        <code>${esc(signupLocalModeNote.command)}</code>
        <button type="button" class="copy-run-local" id="copy-signup-local-mode" onclick="__anCopySignupLocalModeCommand()"${i18nAttr("copyCommand")}>${esc(t("copyCommand"))}</button>
      </div>`
    : "";
  const googleSignInNotice = opts.googleSignInNotice;
  const googleNoticeBodyParts = googleSignInNotice
    ? (Array.isArray(googleSignInNotice.body)
        ? googleSignInNotice.body
        : [googleSignInNotice.body]
      ).filter((body) => body.trim().length > 0)
    : [];
  const googleNoticeBodyHtml = googleNoticeBodyParts
    .map(
      (body, index) =>
        `<p class="google-preflight-copy"${index === 0 ? ' id="google-preflight-copy"' : ""}>${esc(body)}</p>`,
    )
    .join("\n");
  const googleNoticeRunLocalHtml = runLocalCommand
    ? `
      <button type="button" class="btn-secondary google-preflight-local" id="google-preflight-run-local" onclick="__anChooseRunLocalFromGoogleNotice()"${i18nAttr(googleSignInNotice?.cancelLabel === undefined ? "runLocallySentence" : undefined)}>${esc(googleSignInNotice?.cancelLabel ?? t("runLocallySentence"))}</button>`
    : `
      <button type="button" class="btn-secondary" onclick="__anHideGoogleNotice()"${i18nAttr(googleSignInNotice?.cancelLabel === undefined ? "close" : undefined)}>${esc(googleSignInNotice?.cancelLabel ?? t("close"))}</button>`;
  const googleNoticeRunLocalPanelHtml = runLocalCommand
    ? `
    <div class="google-preflight-command" id="google-preflight-run-local-panel" hidden data-command="${esc(runLocalCommand)}">
      <p class="google-preflight-command-label"${i18nAttr("useOwnGoogleClient")}>${esc(t("useOwnGoogleClient"))}</p>
      <code>${esc(runLocalCommand)}</code>
      <button type="button" class="copy-run-local" id="copy-google-preflight-run-local" onclick="__anCopyGoogleNoticeRunLocalCommand()"${i18nAttr("copyCommand")}>${esc(t("copyCommand"))}</button>
    </div>`
    : "";
  const googleNoticeHtml =
    renderGoogleButton && googleSignInNotice
      ? `
  <div
    class="google-preflight"
    id="google-preflight"
    data-host="${esc(googleSignInNotice.host ?? "")}"
    role="dialog"
    aria-labelledby="google-preflight-title"
    aria-describedby="google-preflight-copy"
    tabindex="-1"
  >
    <button type="button" class="google-preflight-close" aria-label="${esc(t("closeGoogleChoices"))}"${i18nAriaAttr("closeGoogleChoices")} onclick="__anHideGoogleNotice()">&times;</button>
    <div class="google-preflight-main">
      <span class="google-preflight-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.24 3.957l-8.422 14.06a1.989 1.989 0 0 0 1.7 2.983h16.845a1.989 1.989 0 0 0 1.7 -2.983l-8.423 -14.06a1.989 1.989 0 0 0 -3.4 0z"/><path d="M12 9v4"/><path d="M12 16h.01"/></svg>
      </span>
      <div class="google-preflight-text">
        <p class="google-preflight-title" id="google-preflight-title">${esc(googleSignInNotice.title)}</p>
${googleNoticeBodyHtml}
      </div>
    </div>
    <div class="google-preflight-actions">
      <button type="button" class="btn-primary" id="google-preflight-continue" onclick="__anAcceptGoogleNotice()"${i18nAttr(googleSignInNotice.continueLabel === undefined ? "continue" : undefined)}>${esc(googleSignInNotice.continueLabel ?? t("continue"))}</button>
${googleNoticeRunLocalHtml}
    </div>
${googleNoticeRunLocalPanelHtml}
  </div>`
      : "";
  const identitySsoHtml = identitySsoLoginButtonHtml();
  const identitySsoScript = identitySsoHtml
    ? `
    function __anIdentitySsoUrl() {
      var params = new URLSearchParams();
      params.set('return', __anGetReturnPath());
      return __anPath('/_agent-native/identity/login') + '?' + params.toString();
    }
    function __anStartIdentitySso(event) {
      if (event && event.preventDefault) event.preventDefault();
      window.location.href = __anIdentitySsoUrl();
      return false;
    }
    (function __anPrepareIdentitySsoButton() {
      var identity = document.getElementById('identity-sso-btn');
      if (!identity) return;
      identity.setAttribute('href', __anIdentitySsoUrl());
      identity.addEventListener('click', __anStartIdentitySso);
    })();`
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
  .run-local-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 2.25rem;
    padding: 0.5rem 0.875rem;
    background: rgba(255,255,255,0.08);
    color: #fff;
    border: 1px solid rgba(255,255,255,0.14);
    border-radius: 8px;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
  }
  .run-local-button:hover {
    background: rgba(255,255,255,0.12);
    border-color: rgba(255,255,255,0.24);
  }
  .run-local-panel {
    max-width: 480px;
    margin-top: 0.75rem;
    padding: 0.75rem;
    background: rgba(20,20,20,0.86);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    box-shadow: 0 14px 36px rgba(0,0,0,0.28);
  }
  .run-local-panel[hidden] { display: none; }
  .run-local-panel code {
    display: block;
    overflow-x: auto;
    padding-bottom: 0.125rem;
    color: #e5e5e5;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 0.75rem;
    line-height: 1.5;
    white-space: nowrap;
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

  const marketingPanelHtml = hasMarketing
    ? `<canvas id="starfield"></canvas>
<div class="split">
  <div class="marketing-panel">
    <div class="marketing-content">
      <h2 class="app-name">
        <img class="brand-mark" src="${esc(brandMarkSrc)}" alt="" aria-hidden="true" />
        <span>${esc(marketing!.appName)}</span>
      </h2>
      <p class="app-tagline" data-marketing-field="tagline">${esc(marketing!.tagline)}</p>
${marketing!.description ? `      <p class="app-desc" data-marketing-field="description">${esc(marketing!.description)}</p>\n` : ""}${
        marketing!.features?.length
          ? `      <ul class="feature-list">\n${marketing!.features.map((f, index) => `        <li data-marketing-feature-index="${index}">${esc(f)}</li>`).join("\n")}\n      </ul>\n`
          : ""
      }      <div class="marketing-actions">
${runLocalCommand ? `        <button type="button" class="run-local-button" id="run-local-button" aria-expanded="false" aria-controls="run-local-panel" onclick="__anToggleRunLocalCommand()"${i18nAttr("runLocally")}>${esc(t("runLocally"))}</button>\n` : ""}        <a class="oss-link" href="https://github.com/BuilderIO/agent-native" target="_blank" rel="noreferrer">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 00-1.3-3.2 4.2 4.2 0 00-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 00-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 00-.1 3.2A4.6 4.6 0 004 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/></svg>
        <span${i18nAttr("openSource")}>${esc(t("openSource"))}</span>
      </a>
      </div>
${
  runLocalCommand
    ? `      <div class="run-local-panel" id="run-local-panel" hidden data-command="${esc(runLocalCommand)}">
        <code>${esc(runLocalCommand)}</code>
        <button type="button" class="copy-run-local" id="copy-run-local" onclick="__anCopyRunLocalCommand()"${i18nAttr("copyCommand")}>${esc(t("copyCommand"))}</button>
      </div>\n`
    : ""
}
    </div>
  </div>
  <div class="form-panel">`
    : "";

  const marketingCloseHtml = hasMarketing ? `\n  </div>\n</div>` : "";

  const starfieldScript = hasMarketing
    ? `
  (function initStarfield() {
    var canvas = document.getElementById('starfield');
    if (!canvas) return;
    var gl = canvas.getContext('webgl', { alpha: false, antialias: false });
    if (!gl) return;

    var vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, 'attribute vec2 position;void main(){gl_Position=vec4(position,0.0,1.0);}');
    gl.compileShader(vs);

    var fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, [
      'precision highp float;',
      'uniform float iTime;uniform vec2 iResolution;uniform vec3 uPointer;',
      '#define S(a,b,t) smoothstep(a,b,t)',
      '#define NUM_LAYERS 4.',
      'float N21(vec2 p){vec3 a=fract(vec3(p.xyx)*vec3(213.897,653.453,253.098));a+=dot(a,a.yzx+79.76);return fract((a.x+a.y)*a.z);}',
      'vec2 GetPos(vec2 id,vec2 offs,float t){float n=N21(id+offs);float n1=fract(n*10.);float n2=fract(n*100.);float a=t+n;return offs+vec2(sin(a*n1),cos(a*n2))*.4;}',
      'vec2 Attract(vec2 p,vec2 cursor,float strength){vec2 delta=cursor-p;float d=length(delta);float pull=1.-smoothstep(.08,1.9,d);pull=pull*pull*(3.-2.*pull);return p+delta*pull*.095*strength;}',
      'float df_line(vec2 a,vec2 b,vec2 p){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h);}',
      'float line(vec2 a,vec2 b,vec2 uv){float r1=.025;float r2=.006;float d=df_line(a,b,uv);float d2=length(a-b);float fade=S(1.5,.5,d2);fade+=S(.05,.02,abs(d2-.75));return S(r1,r2,d)*fade;}',
      'float NetLayer(vec2 st,float n,float t,vec2 pointer,float pointerStrength){',
      '  vec2 cell=floor(st);vec2 id=cell+n;vec2 cursor=pointer-cell;st=fract(st)-.5;',
      '  vec2 p0=Attract(GetPos(id,vec2(-1,-1),t),cursor,pointerStrength);vec2 p1=Attract(GetPos(id,vec2(0,-1),t),cursor,pointerStrength);vec2 p2=Attract(GetPos(id,vec2(1,-1),t),cursor,pointerStrength);',
      '  vec2 p3=Attract(GetPos(id,vec2(-1,0),t),cursor,pointerStrength);vec2 p4=Attract(GetPos(id,vec2(0,0),t),cursor,pointerStrength);vec2 p5=Attract(GetPos(id,vec2(1,0),t),cursor,pointerStrength);',
      '  vec2 p6=Attract(GetPos(id,vec2(-1,1),t),cursor,pointerStrength);vec2 p7=Attract(GetPos(id,vec2(0,1),t),cursor,pointerStrength);vec2 p8=Attract(GetPos(id,vec2(1,1),t),cursor,pointerStrength);',
      '  float m=0.;float sparkle=0.;float d;float s;float pulse;',
      '  m+=line(p4,p0,st);d=length(st-p0);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p0.x)+fract(p0.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p4,p1,st);d=length(st-p1);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p1.x)+fract(p1.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p4,p2,st);d=length(st-p2);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p2.x)+fract(p2.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p4,p3,st);d=length(st-p3);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p3.x)+fract(p3.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p4,p4,st);d=length(st-p4);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p4.x)+fract(p4.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p4,p5,st);d=length(st-p5);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p5.x)+fract(p5.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p4,p6,st);d=length(st-p6);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p6.x)+fract(p6.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p4,p7,st);d=length(st-p7);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p7.x)+fract(p7.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p4,p8,st);d=length(st-p8);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p8.x)+fract(p8.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p1,p3,st);m+=line(p1,p5,st);m+=line(p7,p5,st);m+=line(p7,p3,st);',
      '  float sPhase=(sin(t+n)+sin(t*.1))*.25+.5;sPhase+=pow(sin(t*.1)*.5+.5,50.)*5.;m+=sparkle*sPhase;',
      '  return m;',
      '}',
      'void mainImage(out vec4 fragColor,in vec2 fragCoord){',
      '  vec2 uv=(fragCoord-iResolution.xy*.5)/iResolution.y;',
      '  float t=iTime*.03;float s=sin(t);float c=cos(t);mat2 rot=mat2(c,-s,s,c);vec2 st=uv*rot;vec2 pointerUv=(uPointer.xy-iResolution.xy*.5)/iResolution.y;',
      '  float m=0.;',
      '  for(float i=0.;i<1.;i+=1./NUM_LAYERS){float z=fract(t+i);float size=mix(15.,1.,z);float fade=S(0.,.6,z)*S(1.,.8,z);vec2 pointerSt=pointerUv*rot*size;vec2 layerSt=st*size;float warp=1.-smoothstep(.15,2.7,length(layerSt-pointerSt));warp=warp*warp*(3.-2.*warp)*uPointer.z;layerSt-=(pointerSt-layerSt)*warp*.035;m+=fade*NetLayer(layerSt,i,iTime*0.3,pointerSt,uPointer.z);}',
      '  float cursorLift=1.-smoothstep(.04,.48,length(uv-pointerUv));cursorLift=cursorLift*cursorLift*(3.-2.*cursorLift)*uPointer.z;m*=1.+cursorLift*1.6;',
      '  vec3 col=vec3(0.35)*m;col*=1.-dot(uv,uv);',
      '  float tt=min(iTime,5.0);col*=S(0.,20.,tt);',
      '  col=clamp(col,0.,1.);fragColor=vec4(col,1.);',
      '}',
      'void main(){mainImage(gl_FragColor,gl_FragCoord.xy);}'
    ].join('\\n'));
    gl.compileShader(fs);

    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    var pos = gl.getAttribLocation(prog, 'position');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    var uTime = gl.getUniformLocation(prog, 'iTime');
    var uRes = gl.getUniformLocation(prog, 'iResolution');
    var uPointer = gl.getUniformLocation(prog, 'uPointer');
    var reducedMotionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var reducedMotion = reducedMotionQuery ? reducedMotionQuery.matches : false;
    var pointerDpr = 1, hasPointer = false;
    var pointerX = 0, pointerY = 0, pointerStrength = 0;
    var targetX = 0, targetY = 0, targetStrength = 0;

    function resize() {
      var w = window.innerWidth, h = window.innerHeight;
      pointerDpr = Math.min(window.devicePixelRatio, 1.5);
      canvas.width = w * pointerDpr; canvas.height = h * pointerDpr;
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (!hasPointer) {
        pointerX = targetX = canvas.width * 0.5;
        pointerY = targetY = canvas.height * 0.5;
      }
    }
    function onPointerMove(event) {
      var rect = canvas.getBoundingClientRect();
      var x = event.clientX - rect.left;
      var y = event.clientY - rect.top;
      hasPointer = true;
      targetX = x * pointerDpr;
      targetY = (rect.height - y) * pointerDpr;
      targetStrength = x >= 0 && x <= rect.width && y >= 0 && y <= rect.height ? 1 : 0;
    }
    function fadePointer() {
      targetStrength = 0;
    }
    function easePointer(allowPointer) {
      if (!allowPointer) {
        pointerStrength = 0;
        return;
      }
      pointerX += (targetX - pointerX) * 0.22;
      pointerY += (targetY - pointerY) * 0.22;
      pointerStrength += (targetStrength - pointerStrength) * 0.14;
      if (pointerStrength < 0.001 && targetStrength === 0) pointerStrength = 0;
    }
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('mousemove', onPointerMove, { passive: true });
    document.addEventListener('pointerleave', fadePointer, { passive: true });
    window.addEventListener('blur', fadePointer);

    var start = performance.now(), last = 0, raf = 0, reducedMotionStaticTime = 20;
    function draw(timeSeconds, allowPointer) {
      easePointer(allowPointer !== false && !reducedMotion);
      gl.uniform1f(uTime, timeSeconds);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform3f(uPointer, pointerX, pointerY, pointerStrength);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    function render(now) {
      if (reducedMotion) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(render);
      if (now - last < 33) return;
      last = now;
      draw((now - start) * 0.001);
    }
    function startAnimation() {
      if (!raf) raf = requestAnimationFrame(render);
    }
    function stopAnimation() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    }
    function onReducedMotionChange() {
      reducedMotion = reducedMotionQuery ? reducedMotionQuery.matches : false;
      if (reducedMotion) {
        stopAnimation();
        last = 0;
        draw(reducedMotionStaticTime, false);
      } else {
        startAnimation();
      }
    }
    draw(reducedMotion ? reducedMotionStaticTime : 0, !reducedMotion);
    if (reducedMotionQuery) {
      if (reducedMotionQuery.addEventListener) {
        reducedMotionQuery.addEventListener('change', onReducedMotionChange);
      } else {
        reducedMotionQuery.addListener(onReducedMotionChange);
      }
    }
    if (!reducedMotion) startAnimation();
  })();`
    : "";

  return `<!DOCTYPE html>
<html lang="${DEFAULT_LOCALE}" dir="ltr">
<head>
<meta charset="UTF-8">
<script data-agent-native-locale-init>${localeInitScript}</script>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>${hasMarketing ? esc(marketing!.appName) + " — " + esc(t("pageTitleSignIn")) : esc(t("pageTitleWelcome"))}</title>
<link rel="icon" type="image/svg+xml" href="${withAppBasePath("/favicon.svg")}">
<link rel="apple-touch-icon" href="${withAppBasePath("/icon-180.svg")}">
${
  hasMarketing
    ? `<meta name="description" content="${esc(marketing!.tagline)}">
<meta property="og:title" content="${esc(marketing!.appName)}">
<meta property="og:description" content="${esc(marketing!.tagline)}">
<meta property="og:image" content="${esc(socialImageUrl)}">
<meta property="og:image:secure_url" content="${esc(socialImageUrl)}">
<meta property="og:image:type" content="${AGENT_NATIVE_SOCIAL_IMAGE_TYPE}">
<meta property="og:image:width" content="${AGENT_NATIVE_SOCIAL_IMAGE_WIDTH}">
<meta property="og:image:height" content="${AGENT_NATIVE_SOCIAL_IMAGE_HEIGHT}">
<meta property="og:image:alt" content="${AGENT_NATIVE_SOCIAL_IMAGE_ALT}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(socialImageUrl)}">
<meta name="twitter:image:alt" content="${AGENT_NATIVE_SOCIAL_IMAGE_ALT}">`
    : ""
}
<style>
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
  .legal-note {
    margin-top: 0.625rem;
    color: #666;
    font-size: 0.6875rem;
    line-height: 1.45;
    text-align: center;
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
  .link-button:hover { color: #bbb; }
  .link-button:disabled { cursor: wait; opacity: 0.5; }
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
  .google-preflight {
    display: none;
    position: absolute;
    top: calc(100% + 0.625rem);
    left: 0;
    right: 0;
    z-index: 20;
    padding: 0.875rem;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 10px;
    background: #1b1b1b;
    box-shadow: 0 18px 50px rgba(0,0,0,0.48);
  }
  .google-preflight.show { display: block; }
  .google-preflight::before {
    content: '';
    position: absolute;
    top: -6px;
    left: 50%;
    width: 10px;
    height: 10px;
    transform: translateX(-50%) rotate(45deg);
    background: #1b1b1b;
    border-left: 1px solid rgba(255,255,255,0.12);
    border-top: 1px solid rgba(255,255,255,0.12);
  }
  .google-preflight-main {
    display: flex;
    align-items: flex-start;
    gap: 0.625rem;
    padding-right: 1.25rem;
  }
  .google-preflight-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 7px;
    background: rgba(245,158,11,0.15);
    color: #fcd34d;
  }
  .google-preflight-icon svg { width: 1rem; height: 1rem; }
  .google-preflight-text { min-width: 0; }
  .google-preflight-title {
    color: #fff;
    font-size: 0.8125rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
  }
  .google-preflight-close {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    background: transparent;
    border: none;
    border-radius: 999px;
    color: #888;
    cursor: pointer;
    font-size: 1.125rem;
    line-height: 1;
  }
  .google-preflight-close:hover { color: #fff; background: rgba(255,255,255,0.07); }
  .google-preflight-copy {
    color: #b4b4b8;
    font-size: 0.75rem;
    line-height: 1.55;
  }
  .google-preflight-copy + .google-preflight-copy { margin-top: 0.5rem; }
  .google-preflight-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.875rem;
  }
  .google-preflight-actions .btn-primary,
  .google-preflight-actions .btn-secondary {
    flex: 1;
    width: auto;
    margin-top: 0;
    white-space: nowrap;
  }
  .google-preflight-command {
    margin-top: 0.75rem;
    padding: 0.75rem;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    background: rgba(0,0,0,0.24);
  }
  .google-preflight-command[hidden] { display: none; }
  .google-preflight-command-label {
    margin-bottom: 0.5rem;
    color: #d4d4d8;
    font-size: 0.75rem;
    font-weight: 500;
  }
  .google-preflight-command code {
    display: block;
    overflow-x: auto;
    color: #e5e5e5;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 0.71875rem;
    line-height: 1.45;
    white-space: nowrap;
  }
  @media (max-width: 480px) {
    .google-preflight {
      position: static;
      margin-top: 0.625rem;
    }
    .google-preflight::before { display: none; }
    .google-preflight-actions { flex-direction: column; }
    .google-preflight-actions .btn-primary,
    .google-preflight-actions .btn-secondary { width: 100%; }
  }
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
</style>
</head>
<body${hasMarketing ? ' class="has-marketing"' : ""}>
${localePickerHtml}
${marketingPanelHtml}
<div class="card">
  <h1 id="heading"${i18nAttr(googleOnly ? "signInTitle" : "welcomeTitle")}>${esc(t(googleOnly ? "signInTitle" : "welcomeTitle"))}</h1>
  <p class="subtitle" id="subtitle"${i18nAttr(googleOnly ? "googleOnlySubtitle" : "createAccountSubtitle")}>${esc(t(googleOnly ? "googleOnlySubtitle" : "createAccountSubtitle"))}</p>
  <p
    class="upgrade-note"
    id="upgrade-note"
    data-upgrade-copy="${esc(t("upgradeCopy"))}"
    ${i18nDataAttr("data-upgrade-copy", "upgradeCopy").trim()}
  ></p>
${identitySsoHtml}
${
  renderGoogleButton
    ? `
  <div class="google-signin" id="google-signin">
  <button class="btn-google" id="google-btn" onclick="signInWithGoogle()"${googleSignInNotice ? ' aria-haspopup="dialog" aria-expanded="false" aria-controls="google-preflight"' : ""}>
    <svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
    <span${i18nAttr("googleButton")}>${esc(t("googleButton"))}</span>
  </button>
  <p class="google-error" id="google-err"></p>
  <p class="google-debug" id="google-debug"></p>
${googleNoticeHtml}
  </div>
${googleOnly ? "" : `\n  <div class="divider" id="auth-divider"${i18nAttr("dividerOr")}>${esc(t("dividerOr"))}</div>\n`}
`
    : ""
}
${
  googleOnly
    ? ""
    : `  <div class="tabs">
    <button class="tab" data-tab="signup"${i18nAttr("createAccount")}>${esc(t("createAccount"))}</button>
    <button class="tab" data-tab="login"${i18nAttr("signIn")}>${esc(t("signIn"))}</button>
  </div>

    <form id="signup-form" class="form">
      <label for="s-email"${i18nAttr("email")}>${esc(t("email"))}</label>
      <input id="s-email" type="email" autocomplete="email" autofocus placeholder="you@example.com" required />
    <label for="s-pass"${i18nAttr("password")}>${esc(t("password"))}</label>
    <input id="s-pass" type="password" autocomplete="new-password" placeholder="${esc(t("passwordMinPlaceholder"))}"${i18nPlaceholderAttr("passwordMinPlaceholder")} required minlength="8" />
    <label for="s-pass2"${i18nAttr("confirmPassword")}>${esc(t("confirmPassword"))}</label>
    <input id="s-pass2" type="password" autocomplete="new-password" placeholder="${esc(t("confirmPasswordPlaceholder"))}"${i18nPlaceholderAttr("confirmPasswordPlaceholder")} required minlength="8" />
      <button type="submit"${i18nAttr("createAccount")}>${esc(t("createAccount"))}</button>
${signupLegalNoteHtml}
${signupLocalModeNoteHtml}
      <p class="msg" id="s-msg"></p>
    </form>

    <div id="verification-step" class="form verification-step" aria-live="polite">
      <div class="step-progress" aria-label="${esc(t("signupProgress"))}"${i18nAriaAttr("signupProgress")}>
        <div class="progress-step complete"><span>1</span><strong${i18nAttr("progressAccount")}>${esc(t("progressAccount"))}</strong></div>
        <div class="progress-step current"><span>2</span><strong${i18nAttr("progressVerify")}>${esc(t("progressVerify"))}</strong></div>
        <div class="progress-step"><span>3</span><strong${i18nAttr("progressStart")}>${esc(t("progressStart"))}</strong></div>
      </div>
      <div class="verification-panel">
        <p class="verification-kicker"${i18nAttr("verificationSent")}>${esc(t("verificationSent"))}</p>
        <p class="verification-copy"><span${i18nAttr("verifyCopyPrefix")}>${esc(t("verifyCopyPrefix"))}</span> <strong id="verify-email"></strong><span${i18nAttr("verifyCopySuffix")}>${esc(t("verifyCopySuffix"))}</span></p>
        <p class="verification-note"${i18nAttr("verificationNote")}>${esc(t("verificationNote"))}</p>
      </div>
      <button type="button" class="btn-primary" id="verify-continue"${i18nAttr("continue")}>${esc(t("continue"))}</button>
      <div class="inline-actions">
        <button type="button" class="link-button" id="resend-verification"${i18nAttr("resendEmail")}>${esc(t("resendEmail"))}</button>
        <button type="button" class="link-button" id="back-to-signup"${i18nAttr("back")}>${esc(t("back"))}</button>
      </div>
      <p class="msg" id="verify-msg"></p>
    </div>

    <form id="login-form" class="form">
    <label for="l-email"${i18nAttr("email")}>${esc(t("email"))}</label>
    <input id="l-email" type="email" autocomplete="email" placeholder="you@example.com" required />
    <label for="l-pass"${i18nAttr("password")}>${esc(t("password"))}</label>
    <input id="l-pass" type="password" autocomplete="current-password" placeholder="${esc(t("enterPasswordPlaceholder"))}"${i18nPlaceholderAttr("enterPasswordPlaceholder")} required />
    <button type="submit"${i18nAttr("signIn")}>${esc(t("signIn"))}</button>
    <p class="msg error" id="l-msg"></p>
    <p style="margin-top:0.75rem;font-size:0.75rem;text-align:right">
      <a href="#" id="forgot-link" style="color:#888;text-decoration:underline;text-underline-offset:2px"${i18nAttr("forgotPassword")}>${esc(t("forgotPassword"))}</a>
    </p>
  </form>

  <form id="forgot-form" class="form">
    <label for="f-email"${i18nAttr("email")}>${esc(t("email"))}</label>
    <input id="f-email" type="email" autocomplete="email" placeholder="you@example.com" required />
    <button type="submit"${i18nAttr("sendResetLink")}>${esc(t("sendResetLink"))}</button>
    <p class="msg" id="f-msg"></p>
    <p style="margin-top:0.75rem;font-size:0.75rem;text-align:center">
      <a href="#" id="back-to-login" style="color:#888;text-decoration:underline;text-underline-offset:2px"${i18nAttr("backToSignIn")}>${esc(t("backToSignIn"))}</a>
    </p>
  </form>`
}
</div>
<p class="local-note" id="local-note">
  <span${i18nAttr("localNotePrefix")}>${esc(t("localNotePrefix"))}</span> (<strong>${getConnectionLabel()}</strong>)<span${i18nAttr("localNoteSuffix")}>${esc(t("localNoteSuffix"))}</span>
</p>${marketingCloseHtml}
<script>
  function __anBasePath() {
    var configured = ${JSON.stringify(appBasePath)};
    if (configured) return configured;
    var marker = '/_agent-native';
    var idx = window.location.pathname.indexOf(marker);
    return idx > 0 ? window.location.pathname.slice(0, idx) : '';
  }
    function __anPath(path) {
      return __anBasePath() + path;
    }
    var __AN_AUTH_DEFAULT_LOCALE = ${JSON.stringify(DEFAULT_LOCALE)};
    var __AN_AUTH_SUPPORTED_LOCALES = ${JSON.stringify(SUPPORTED_LOCALES)};
    var __AN_AUTH_LOCALE_STORAGE_KEY = ${JSON.stringify(LOCALE_STORAGE_KEY)};
    var __AN_AUTH_LOCALE_METADATA = ${JSON.stringify(LOCALE_METADATA)};
    var __AN_AUTH_LOCALES = ${JSON.stringify(AUTH_LOCALE_COPY)};
    var __AN_AUTH_MARKETING_APP_NAME = ${JSON.stringify(marketing?.appName ?? "")};
    var __AN_AUTH_HAS_MARKETING = ${JSON.stringify(hasMarketing)};
    var __AN_AUTH_MARKETING_SLUG = ${JSON.stringify(marketingSlug ?? "")};
    var __AN_AUTH_MARKETING_DEFAULT = ${JSON.stringify(defaultMarketingCopy ?? {})};
    var __AN_AUTH_MARKETING_LOCALES = ${JSON.stringify(AUTH_MARKETING_LOCALE_COPY)};
    var __anAuthLocale = __AN_AUTH_DEFAULT_LOCALE;
    var __anAuthLocalePreference = 'system';
    var __anAuthView = ${JSON.stringify(googleOnly ? "googleOnly" : "signup")};
    function __anAuthLocaleIsSupported(value) {
      return __AN_AUTH_SUPPORTED_LOCALES.indexOf(value) !== -1;
    }
    function __anNormalizeAuthLocale(value) {
      if (typeof value !== 'string' || !value) return null;
      if (__anAuthLocaleIsSupported(value)) return value;
      try {
        var canonical = Intl.getCanonicalLocales(value)[0];
        if (__anAuthLocaleIsSupported(canonical)) return canonical;
        var language = canonical && canonical.split('-')[0].toLowerCase();
        for (var i = 0; i < __AN_AUTH_SUPPORTED_LOCALES.length; i++) {
          var locale = __AN_AUTH_SUPPORTED_LOCALES[i];
          if (locale.split('-')[0].toLowerCase() === language) return locale;
        }
      } catch(e) {}
      return null;
    }
    function __anNormalizeAuthLocalePreference(value) {
      if (value === 'system') return 'system';
      return __anNormalizeAuthLocale(value);
    }
    function __anReadAuthLocalePreference() {
      try {
        return __anNormalizeAuthLocalePreference(localStorage.getItem(__AN_AUTH_LOCALE_STORAGE_KEY)) || 'system';
      } catch(e) {
        return 'system';
      }
    }
    function __anWriteAuthLocalePreference(preference) {
      try {
        localStorage.setItem(__AN_AUTH_LOCALE_STORAGE_KEY, preference);
      } catch(e) {}
    }
    function __anBrowserAuthLocales() {
      try {
        if (navigator.languages && navigator.languages.length) return navigator.languages;
        if (navigator.language) return [navigator.language];
      } catch(e) {}
      return [];
    }
    function __anResolveAuthLocale(preference) {
      var normalizedPreference = __anNormalizeAuthLocalePreference(preference) || 'system';
      if (normalizedPreference !== 'system') return normalizedPreference;
      var rootLocale = __anNormalizeAuthLocale(document.documentElement.getAttribute('data-locale'));
      if (rootLocale) return rootLocale;
      var locales = __anBrowserAuthLocales();
      for (var i = 0; i < locales.length; i++) {
        var match = __anNormalizeAuthLocale(locales[i]);
        if (match) return match;
      }
      return __AN_AUTH_DEFAULT_LOCALE;
    }
    function __anT(key) {
      var localized = __AN_AUTH_LOCALES[__anAuthLocale] || __AN_AUTH_LOCALES[__AN_AUTH_DEFAULT_LOCALE] || {};
      var fallback = __AN_AUTH_LOCALES[__AN_AUTH_DEFAULT_LOCALE] || {};
      return localized[key] || fallback[key] || key;
    }
    function __anSetAuthI18nKey(node, key) {
      if (!node || !key) return;
      node.setAttribute('data-i18n', key);
      node.textContent = __anT(key);
    }
    function __anAuthHeadingKeys(view) {
      if (view === 'login') return { heading: 'welcomeBackTitle', subtitle: 'signInSubtitle' };
      if (view === 'forgot') return { heading: 'resetPasswordTitle', subtitle: 'resetPasswordSubtitle' };
      if (view === 'verification') return { heading: 'checkEmailTitle', subtitle: 'finishAccountSubtitle' };
      if (view === 'googleOnly') return { heading: 'signInTitle', subtitle: 'googleOnlySubtitle' };
      return { heading: 'welcomeTitle', subtitle: 'createAccountSubtitle' };
    }
    function __anRefreshAuthViewCopy() {
      var keys = __anAuthHeadingKeys(__anAuthView);
      __anSetAuthI18nKey(document.getElementById('heading'), keys.heading);
      __anSetAuthI18nKey(document.getElementById('subtitle'), keys.subtitle);
    }
    function __anSetAuthView(view) {
      __anAuthView = view || 'signup';
      __anRefreshAuthViewCopy();
    }
    function __anMarketingCopy() {
      if (!__AN_AUTH_MARKETING_SLUG) return __AN_AUTH_MARKETING_DEFAULT || {};
      var localeMarketing = (__AN_AUTH_MARKETING_LOCALES[__anAuthLocale] || {})[__AN_AUTH_MARKETING_SLUG] || {};
      return {
        tagline: localeMarketing.tagline || __AN_AUTH_MARKETING_DEFAULT.tagline,
        description: localeMarketing.description || __AN_AUTH_MARKETING_DEFAULT.description,
        features: localeMarketing.features || __AN_AUTH_MARKETING_DEFAULT.features || []
      };
    }
    function __anApplyAuthMarketingCopy() {
      var copy = __anMarketingCopy();
      var tagline = document.querySelector('[data-marketing-field="tagline"]');
      if (tagline && copy.tagline) tagline.textContent = copy.tagline;
      var description = document.querySelector('[data-marketing-field="description"]');
      if (description && copy.description) description.textContent = copy.description;
      document.querySelectorAll('[data-marketing-feature-index]').forEach(function(node) {
        var index = Number(node.getAttribute('data-marketing-feature-index'));
        var feature = copy.features && copy.features[index];
        if (feature) node.textContent = feature;
      });
    }
    function __anApplyAuthLocale(preference) {
      __anAuthLocalePreference = __anNormalizeAuthLocalePreference(preference) || __anReadAuthLocalePreference();
      __anAuthLocale = __anResolveAuthLocale(__anAuthLocalePreference);
      var root = document.documentElement;
      var meta = __AN_AUTH_LOCALE_METADATA[__anAuthLocale] || {};
      root.setAttribute('lang', __anAuthLocale);
      root.setAttribute('dir', meta.dir || 'ltr');
      root.setAttribute('data-locale', __anAuthLocale);
      document.querySelectorAll('[data-i18n]').forEach(function(node) {
        node.textContent = __anT(node.getAttribute('data-i18n'));
      });
      document.querySelectorAll('[data-i18n-placeholder]').forEach(function(node) {
        node.setAttribute('placeholder', __anT(node.getAttribute('data-i18n-placeholder')));
      });
      document.querySelectorAll('[data-i18n-aria-label]').forEach(function(node) {
        node.setAttribute('aria-label', __anT(node.getAttribute('data-i18n-aria-label')));
      });
      document.querySelectorAll('[data-i18n-title]').forEach(function(node) {
        node.setAttribute('title', __anT(node.getAttribute('data-i18n-title')));
      });
      document.querySelectorAll('[data-i18n-data-upgrade-copy]').forEach(function(node) {
        node.setAttribute('data-upgrade-copy', __anT(node.getAttribute('data-i18n-data-upgrade-copy')));
      });
      document.querySelectorAll('[data-locale-value]').forEach(function(node) {
        var checked = node.getAttribute('data-locale-value') === __anAuthLocalePreference;
        node.setAttribute('aria-checked', checked ? 'true' : 'false');
      });
      document.title = __AN_AUTH_HAS_MARKETING && __AN_AUTH_MARKETING_APP_NAME
        ? __AN_AUTH_MARKETING_APP_NAME + ' — ' + __anT('pageTitleSignIn')
        : __anT('pageTitleWelcome');
      __anApplyAuthMarketingCopy();
      __anRefreshAuthViewCopy();
    }
    function __anSetAuthLocaleMenuOpen(open) {
      var trigger = document.getElementById('auth-locale-trigger');
      var menu = document.getElementById('auth-locale-menu');
      if (!trigger || !menu) return;
      if (open) {
        menu.removeAttribute('hidden');
      } else {
        menu.setAttribute('hidden', '');
      }
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    (function __anInitAuthLocalePicker() {
      var trigger = document.getElementById('auth-locale-trigger');
      var menu = document.getElementById('auth-locale-menu');
      var preference = __anReadAuthLocalePreference();
      __anApplyAuthLocale(preference);
      if (!trigger || !menu) return;
      trigger.addEventListener('click', function(event) {
        event.preventDefault();
        __anSetAuthLocaleMenuOpen(menu.hasAttribute('hidden'));
      });
      menu.querySelectorAll('[data-locale-value]').forEach(function(item) {
        item.addEventListener('click', function() {
          var next = __anNormalizeAuthLocalePreference(item.getAttribute('data-locale-value')) || 'system';
          __anWriteAuthLocalePreference(next);
          __anApplyAuthLocale(next);
          __anSetAuthLocaleMenuOpen(false);
          trigger.focus();
        });
      });
      document.addEventListener('click', function(event) {
        var picker = document.querySelector('.locale-picker');
        if (picker && picker.contains(event.target)) return;
        __anSetAuthLocaleMenuOpen(false);
      });
      document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') __anSetAuthLocaleMenuOpen(false);
      });
    })();
    var __AN_PUBLIC_OAUTH_ORIGIN = ${JSON.stringify(publicOAuthOrigin)};
    var __AN_WORKSPACE_GATEWAY_RETURN_ORIGIN = ${JSON.stringify(workspaceGatewayReturnOrigin)};
    var __AN_GOOGLE_AUTH_MODE = ${JSON.stringify(googleAuthMode)};
    function __anConfiguredOAuthOrigin() {
      if (!__AN_PUBLIC_OAUTH_ORIGIN) return '';
      try {
        var origin = new URL(__AN_PUBLIC_OAUTH_ORIGIN).origin;
        return origin && origin !== window.location.origin ? origin : '';
      } catch(e) {
        return '';
      }
    }
    function __anAuthPath(path) {
      var origin = __anIsBuilderPreview() ? __anConfiguredOAuthOrigin() : '';
      return origin ? origin + path : __anPath(path);
    }
    function __anGoogleAuthUrlPath() {
      return __anIsBuilderPreview()
        ? __anAuthPath('/_agent-native/google/auth-url')
        : __anPath('/_agent-native/google/auth-url');
    }
    function __anBuilderPreviewReturnOrigin() {
      var candidates = [window.location.href, document.referrer || ''];
      try {
        if (window.location.ancestorOrigins) {
          for (var j = 0; j < window.location.ancestorOrigins.length; j++) {
            candidates.push(window.location.ancestorOrigins[j]);
          }
        }
      } catch(e) {}
      for (var i = 0; i < candidates.length; i++) {
        try {
          var url = new URL(candidates[i]);
          var host = url.hostname.toLowerCase();
          var isPreviewHost =
            host === 'builderio.xyz' || host.slice(-14) === '.builderio.xyz' ||
            host === 'builderio.dev' || host.slice(-14) === '.builderio.dev' ||
            host === 'builder.codes' || host.slice(-14) === '.builder.codes' ||
            host === 'builder.my' || host.slice(-11) === '.builder.my';
          if (url.protocol === 'https:' && isPreviewHost) return url.origin;
        } catch(e) {}
      }
      return '';
    }
    function __anWorkspaceGatewayReturnOrigin() {
      var previewOrigin = __anBuilderPreviewReturnOrigin();
      if (previewOrigin) return previewOrigin;
      if (__AN_WORKSPACE_GATEWAY_RETURN_ORIGIN) return __AN_WORKSPACE_GATEWAY_RETURN_ORIGIN;
      return __anIsBuilderDesktop() ? 'http://127.0.0.1:8080' : '';
    }
    function __anNormalizeWorkspaceReturnPath(ret) {
      try {
        var url = new URL(ret || '/', window.location.origin);
        var path = url.pathname || '/';
        if (path === '/dispatch/dispatch') {
          path = '/dispatch';
        } else if (path.indexOf('/dispatch/') === 0) {
          var rest = path.slice('/dispatch/'.length);
          var first = rest.split('/')[0];
          var dispatchRoutes = {
            overview: true, apps: true, metrics: true, vault: true,
            integrations: true, messaging: true, workspace: true,
            agents: true, destinations: true, identities: true,
            approvals: true, audit: true, team: true, 'thread-debug': true,
            'new-app': true
          };
          if (first === 'dispatch') {
            path = '/dispatch' + rest.slice(first.length);
          } else if (first && !dispatchRoutes[first]) {
            path = '/' + rest;
          }
        }
        return path + url.search + url.hash;
      } catch(e) {
        return ret || '/';
      }
    }
    function __anOAuthReturnTarget(ret) {
      var path = __anNormalizeWorkspaceReturnPath(ret);
      var origin = __anWorkspaceGatewayReturnOrigin();
      return origin ? origin + path : path;
    }
    function __anSessionBridgeUrl(ret, sessionToken) {
      try {
        var url = new URL(ret || window.location.pathname + window.location.search, window.location.origin);
        url.searchParams.set('_session', sessionToken);
        return url.pathname + url.search + url.hash;
      } catch(e) {
        var sep = (ret || '/').indexOf('?') === -1 ? '?' : '&';
        return (ret || '/') + sep + '_session=' + encodeURIComponent(sessionToken);
      }
    }
    function __anFinishOAuthExchange(ret, flowId, sessionToken) {
      __anGoogleSignInInFlight = false;
      if (__anIsBuilderPreview()) {
        if (sessionToken) {
          __anSetOAuthDebug('OAuth exchange redeemed; applying session bridge to embedded app', flowId);
          window.location.replace(__anSessionBridgeUrl(ret, sessionToken));
          return;
        }
        __anSetOAuthDebug('OAuth exchange redeemed; reloading the embedded app', flowId);
        window.location.reload();
        return;
      }
      __anSetOAuthDebug('OAuth exchange redeemed; returning to the app', flowId);
      __anRedirectToSignedInApp(ret);
    }
    function __anHasControlCharacter(value) {
      for (var i = 0; i < value.length; i++) {
        if (value.charCodeAt(i) < 32) return true;
      }
      return false;
    }
    function __anNormalizeReturnPath(raw) {
      var value = typeof raw === 'string' ? raw : '';
      if (!value || __anHasControlCharacter(value)) return '';
      if (value.charAt(0) === '\\\\') return '';
      if (value.charAt(0) === '/' && (value.charAt(1) === '/' || value.charAt(1) === '\\\\')) return '';
      try {
        var url = new URL(value, window.location.origin);
        if (url.origin !== window.location.origin) return '';
        return url.pathname + url.search + url.hash;
      } catch(e) {
        return '';
      }
    }
    function __anCurrentReturnPath() {
      return window.location.pathname + window.location.search + window.location.hash;
    }
    function __anGetReturnPath() {
      try {
        var inner = new URLSearchParams(window.location.search).get('return');
        var normalized = __anNormalizeReturnPath(inner);
        if (normalized) return normalized;
      } catch(e) {}
      return __anCurrentReturnPath();
    }
    function __anMountedPathname(pathname) {
      var base = __anBasePath();
      if (base && pathname.indexOf(base + '/') === 0) return pathname.slice(base.length);
      if (base && pathname === base) return '/';
      return pathname || '/';
    }
    function __anIsAuthEntryPath(pathname) {
      var p = __anMountedPathname(pathname);
      return p === '/login' || p === '/signup' || p === '/_agent-native/sign-in';
    }
    function __anGetSignedInReturnPath() {
      try {
        var inner = new URLSearchParams(window.location.search).get('return');
        var normalized = __anNormalizeReturnPath(inner);
        if (normalized) return normalized;
      } catch(e) {}
      if (__anIsAuthEntryPath(window.location.pathname)) return __anPath('/');
      return __anCurrentReturnPath();
    }
    function __anWithAuthCacheBypass(ret) {
      try {
        var url = new URL(ret || __anPath('/'), window.location.origin);
        url.searchParams.set('${AUTH_REDIRECT_QUERY_PARAM}', Date.now().toString(36));
        return url.pathname + url.search + url.hash;
      } catch(e) {
        var fallback = ret || __anPath('/');
        var hashIndex = fallback.indexOf('#');
        var beforeHash = hashIndex === -1 ? fallback : fallback.slice(0, hashIndex);
        var hash = hashIndex === -1 ? '' : fallback.slice(hashIndex);
        var sep = beforeHash.indexOf('?') === -1 ? '?' : '&';
        return beforeHash + sep + '${AUTH_REDIRECT_QUERY_PARAM}=' + Date.now().toString(36) + hash;
      }
    }
    function __anRedirectToSignedInApp(ret) {
      window.location.replace(__anWithAuthCacheBypass(ret || __anGetSignedInReturnPath()));
    }
${identitySsoScript}
	    (function __anRedirectIfAlreadySignedIn() {
	      fetch(__anPath('/_agent-native/auth/session'), {
	        headers: { 'Accept': 'application/json' },
	        credentials: 'include',
	        cache: 'no-store',
      }).then(function(res) {
        if (!res.ok) return null;
        return res.json().catch(function() { return null; });
      }).then(function(data) {
	        if (data && data.email && !data.error) __anRedirectToSignedInApp();
	      }).catch(function() {});
	    })();
	    function __anSafeAttributionValue(value) {
	      return typeof value === 'string' ? value.trim().slice(0, 120) : '';
	    }
	    function __anFirstTouchCookiePresent() {
	      try {
	        return document.cookie.split(';').some(function(part) {
	          return part.trim().indexOf('an_ft=') === 0;
	        });
	      } catch(e) {
	        return false;
	      }
	    }
	    function __anWriteFirstTouchCookie(json) {
	      try {
	        document.cookie = 'an_ft=' + encodeURIComponent(json) + '; path=/; max-age=2592000; SameSite=Lax';
	      } catch(e) {}
	    }
	    function __anExternalReferrerHost(referrer) {
	      try {
	        var url = new URL(referrer);
	        if (url.host.toLowerCase() === window.location.host.toLowerCase()) return '';
	        return __anSafeAttributionValue(url.host);
	      } catch(e) {
	        return '';
	      }
	    }
	    function __anCaptureSignupAttribution() {
	      try {
	        var stored = '';
	        try { stored = localStorage.getItem('an_attribution') || ''; } catch(e) {}
	        if (stored) {
	          if (!__anFirstTouchCookiePresent()) __anWriteFirstTouchCookie(stored);
	          return;
	        }
	        if (__anFirstTouchCookiePresent()) return;
	        var params = new URLSearchParams(window.location.search || '');
	        var ft = {};
	        ['ref', 'via', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function(key) {
	          var value = __anSafeAttributionValue(params.get(key));
	          if (value) ft[key] = value;
	        });
	        var returnPath = __anNormalizeReturnPath(params.get('return'));
	        var landingPath = __anSafeAttributionValue(returnPath || window.location.pathname || '');
	        if (landingPath) ft.landing_path = landingPath;
	        var referrer = __anExternalReferrerHost(document.referrer || '');
	        if (referrer) ft.landing_referrer = referrer;
	        ft.landed_at = new Date().toISOString();
	        var json = JSON.stringify(ft);
	        try { localStorage.setItem('an_attribution', json); } catch(e) {}
	        __anWriteFirstTouchCookie(json);
	      } catch(e) {}
	    }
	    __anCaptureSignupAttribution();
	    var __anBuilderPreviewSeen = false;
    function __anRememberBuilderPreview() {
      __anBuilderPreviewSeen = true;
      try { sessionStorage.setItem('__an_builder_preview_seen', '1'); } catch(e) {}
    }
    function __anHasBuilderPreviewSignal() {
      try {
        var params = new URLSearchParams(window.location.search);
        if (params.has('builder.preview') || params.has('builder.frameEditing') || params.has('__builder_editing__')) return true;
      } catch(e) {}
      return false;
    }
    function __anIsBuilderPreview() {
      if (__anBuilderPreviewSeen) return true;
      if (__anHasBuilderPreviewSignal()) {
        __anRememberBuilderPreview();
        return true;
      }
      try {
        if (sessionStorage.getItem('__an_builder_preview_seen') === '1') {
          __anBuilderPreviewSeen = true;
          return true;
        }
      } catch(e) {}
      try {
        var ref = document.referrer || '';
        var fromBuilder = ref.indexOf('builder.io') !== -1 || ref.indexOf('builder.my') !== -1 || ref.indexOf('builderio.xyz') !== -1 || ref.indexOf('builderio.dev') !== -1 || ref.indexOf('builder.codes') !== -1;
        if (fromBuilder) __anRememberBuilderPreview();
        return fromBuilder;
      } catch(e) {
        return false;
      }
    }
    __anIsBuilderPreview();
    function __anIsBuilderDesktop() {
      try {
        var ua = navigator.userAgent || '';
        return ua.indexOf('Electron') !== -1 && ua.indexOf('AgentNativeDesktop') === -1;
      } catch(e) {
        return false;
      }
    }
    function __anIsAgentNativeDesktop() {
      try {
        return (navigator.userAgent || '').indexOf('AgentNativeDesktop') !== -1;
      } catch(e) {
        return false;
      }
    }
    function __anIsInFrame() {
      try {
        return window.self !== window.top;
      } catch(e) {
        return true;
      }
    }
    function __anIsElectron() {
      try {
        return (navigator.userAgent || '').indexOf('Electron') !== -1;
      } catch(e) {
        return false;
      }
    }
    function __anResolveAuthFlow() {
      if (__anIsBuilderPreview()) return __anIsInFrame() ? 'popup' : 'redirect';
      // Per-session override for ad-hoc testing outside Builder: append
      // ?authMode=popup or ?authMode=redirect to the sign-in URL.
      try {
        var qp = new URLSearchParams(window.location.search).get('authMode');
        if (qp === 'popup' || qp === 'redirect') return qp;
      } catch(e) {}
      var mode = __AN_GOOGLE_AUTH_MODE || 'auto';
      if (mode === 'popup') return 'popup';
      if (mode === 'redirect') return 'redirect';
      return __anIsAgentNativeDesktop() ? 'redirect' : 'popup';
    }
    var __anOAuthPollTimer = null;
    var __anOAuthPollCount = 0;
    var __anGoogleSignInInFlight = false;
    var __anGoogleRecoverBound = false;
    function __anNewOAuthFlowId() {
      try {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
          return window.crypto.randomUUID();
        }
      } catch(e) {}
      return 'builder-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    }
    function __anFlowDebugId(flowId) {
      return flowId ? String(flowId).slice(-10) : '';
    }
    function __anSetOAuthDebug(message, flowId) {
      var text = message + (flowId ? ' (flow ' + __anFlowDebugId(flowId) + ')' : '');
      try {
        console.info('[agent-native][google-oauth] ' + text);
      } catch(e) {}
      // Only surface the debug overlay when explicitly opted in via #oauth-debug
      // hash or ?oauth_debug=1 query — otherwise it leaks raw flow IDs and
      // diagnostic strings into the user-facing sign-in screen.
      var showDebugOverlay = false;
      try {
        var loc = window.location || {};
        showDebugOverlay =
          (typeof loc.hash === 'string' && loc.hash.indexOf('oauth-debug') !== -1) ||
          (typeof loc.search === 'string' && loc.search.indexOf('oauth_debug=1') !== -1);
      } catch(e) {}
      var debug = document.getElementById('google-debug');
      if (debug) {
        debug.textContent = text;
        if (showDebugOverlay) debug.classList.add('show');
      }
    }
    function __anShowOAuthError(err, btn, message) {
      if (__anOAuthPollTimer) {
        clearInterval(__anOAuthPollTimer);
        __anOAuthPollTimer = null;
      }
      err.textContent = message;
      err.classList.add('show');
      btn.disabled = false;
      __anGoogleSignInInFlight = false;
    }
    function __anRecoverGoogleSignInAfterReturn() {
      // The user left for the Google sign-in window and came back. If the flow
      // never completed (e.g. they closed the window to switch profiles), the
      // button is stuck disabled with no error path firing for up to 5 minutes.
      // Re-enable it so they can retry. Wait briefly first so a genuinely
      // in-flight exchange can still finish and navigate without a flicker.
      if (!__anGoogleSignInInFlight) return;
      setTimeout(function() {
        if (!__anGoogleSignInInFlight) return;
        var btn = document.getElementById('google-btn');
        if (!btn || !btn.disabled) return;
        // Keep the desktop-exchange poll alive. Agent Native Desktop opens
        // Google in the system browser, so focus can return before the
        // callback has stored the session token.
        btn.disabled = false;
        __anGoogleSignInInFlight = false;
      }, 1200);
    }
    function __anBindGoogleRecover() {
      if (__anGoogleRecoverBound) return;
      __anGoogleRecoverBound = true;
      window.addEventListener('focus', __anRecoverGoogleSignInAfterReturn);
      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') __anRecoverGoogleSignInAfterReturn();
      });
    }
    function __anHandlePopupOAuthFailure(ret, btn, err, flowId, redirectReason, builderFrameMessage) {
      if (__anIsBuilderPreview() && __anIsInFrame()) {
        __anShowOAuthError(err, btn, builderFrameMessage + ' ' + __anT('googlePopupHelp') + ' (flow ' + __anFlowDebugId(flowId) + ').');
        return;
      }
      __anStartRedirectOAuth(ret, btn, err, flowId, redirectReason);
    }
    function __anStartRedirectOAuth(ret, btn, err, flowId, reason) {
      var params = new URLSearchParams();
      var oauthReturn = __anIsBuilderPreview() ? __anOAuthReturnTarget(ret) : ret;
      if (oauthReturn) params.set('return', oauthReturn);
      params.set('redirect', '1');
      __anSetOAuthDebug(reason || 'Opening Google sign-in redirect', flowId);
      try {
        __anOpenOAuthUrl(__anGoogleAuthUrlPath() + '?' + params.toString());
      } catch(e) {
        __anShowOAuthError(err, btn, 'Could not start Google sign-in redirect' + (flowId ? ' for flow ' + __anFlowDebugId(flowId) : '') + ': ' + (e && e.message ? e.message : 'unknown error'));
      }
    }
    function __anWaitForOAuthExchange(flowId, ret, btn, err) {
      var started = Date.now();
      var timeoutMs = 5 * 60 * 1000;
      __anOAuthPollCount = 0;
      async function check() {
        __anOAuthPollCount++;
        try {
          var res = await fetch(__anPath('/_agent-native/auth/desktop-exchange') + '?flow_id=' + encodeURIComponent(flowId), { credentials: 'include' });
          var data = await res.json().catch(function() { return {}; });
          if (data && (data.email || data.token)) {
            if (__anOAuthPollTimer) clearInterval(__anOAuthPollTimer);
            __anOAuthPollTimer = null;
            __anFinishOAuthExchange(ret, flowId, data.token);
            return;
          }
          if (data && data.error) {
            __anSetOAuthDebug('OAuth exchange returned an error: ' + (data.message || data.error), flowId);
            __anShowOAuthError(err, btn, data.message || data.error);
            return;
          }
          if (data && data.pending && (__anOAuthPollCount === 1 || __anOAuthPollCount % 5 === 0)) {
            __anSetOAuthDebug('Waiting for the Google callback; polling attempt ' + __anOAuthPollCount, flowId);
          }
        } catch(e) {
          if (__anOAuthPollCount === 1 || __anOAuthPollCount % 5 === 0) {
            __anSetOAuthDebug('Could not reach the OAuth exchange endpoint: ' + (e && e.message ? e.message : 'network error'), flowId);
          }
        }
        if (Date.now() - started > timeoutMs) {
          __anShowOAuthError(err, btn, __anT('googleNeverFinished') + ' Flow ' + __anFlowDebugId(flowId) + '.');
        }
      }
      if (__anOAuthPollTimer) clearInterval(__anOAuthPollTimer);
      __anOAuthPollTimer = setInterval(check, 1000);
      setTimeout(check, 500);
    }
    function __anStartPopupOAuth(ret, btn, err) {
      var flowId = __anNewOAuthFlowId();
      var oauthReturn = __anIsBuilderPreview() ? __anOAuthReturnTarget(ret) : ret;
      var params = new URLSearchParams();
      if (oauthReturn) params.set('return', oauthReturn);
      params.set('desktop', '1');
      params.set('flow_id', flowId);
      params.set('redirect', '1');
      var url = __anGoogleAuthUrlPath() + '?' + params.toString();
      try { sessionStorage.setItem('__an_signin', '1'); } catch(e) {}
      __anSetOAuthDebug('Opening Google sign-in popup', flowId);
      try {
        var popup = window.open('', '_blank', 'width=640,height=760');
        if (!popup) {
          __anHandlePopupOAuthFailure(ret, btn, err, flowId, 'Google popup was blocked; falling back to redirect', 'Google popup was blocked.');
          return;
        }
        try { popup.opener = null; } catch(e) {}
        try {
          popup.location.href = url;
        } catch(e) {
          try { popup.close(); } catch(closeErr) {}
          __anHandlePopupOAuthFailure(ret, btn, err, flowId, 'Could not navigate Google popup; falling back to redirect', 'Could not navigate Google popup.');
          return;
        }
        __anSetOAuthDebug('Google popup opened; waiting for callback', flowId);
      } catch(e) {
        __anHandlePopupOAuthFailure(ret, btn, err, flowId, 'Could not open Google popup; falling back to redirect', 'Could not open Google popup.');
        return;
      }
      __anWaitForOAuthExchange(flowId, ret, btn, err);
    }
    function __anStartNativeDesktopOAuth(ret, btn, err) {
      var flowId = __anNewOAuthFlowId();
      var params = new URLSearchParams();
      if (ret) params.set('return', ret);
      params.set('desktop', '1');
      params.set('flow_id', flowId);
      params.set('redirect', '1');
      var url = __anGoogleAuthUrlPath() + '?' + params.toString();
      __anSetOAuthDebug('Opening Google sign-in in system browser', flowId);
      __anOpenOAuthUrl(url);
      __anWaitForOAuthExchange(flowId, ret, btn, err);
    }
    function __anOpenOAuthUrl(url) {
      try { sessionStorage.setItem('__an_signin', '1'); } catch(e) {}
      window.location.href = url;
    }
    (function revealLocalNote() {
    var h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local')) {
      var n = document.getElementById('local-note');
      if (n) n.classList.add('show');
    }
  })();
  (function revealUpgradeNote() {
    var shouldShow = false;
    try {
      var params = new URLSearchParams(location.search);
      shouldShow = params.get('signin') === '1' || params.get('upgrade-from-local') === '1';
    } catch(e) {}
    if (!shouldShow) {
      try { shouldShow = localStorage.getItem('an_migrate_from_local') === '1'; } catch(e) {}
    }
    if (!shouldShow) return;
    var n = document.getElementById('upgrade-note');
    if (!n) return;
    n.textContent = n.getAttribute('data-upgrade-copy') || __anT('migrateLocalFallback');
    n.classList.add('show');
  })();
${
  googleOnly
    ? ""
    : `  var TAB_STORAGE_KEY = 'an.onboarding.tab';
    var tabs = document.querySelectorAll('.tab');
    var forms = document.querySelectorAll('.form');
	    var pendingSignupEmail = '';
	    var pendingSignupPassword = '';
	    var verificationCheckInFlight = false;
	    var RESEND_VERIFICATION_COOLDOWN_SECONDS = 60;
	    var resendVerificationCooldownUntil = 0;
	    var resendVerificationCooldownTimer = null;
	    function setActiveTab(name, opts) {
	      if (name !== 'signup' && name !== 'login') return;
	      var form = document.getElementById(name + '-form');
	      if (!form) return;
      var card = document.querySelector('.card');
      if (card) card.classList.remove('verifying');
      tabs.forEach(function(x) { x.classList.remove('active'); });
      forms.forEach(function(x) { x.classList.remove('active'); });
    var btn = document.querySelector('.tab[data-tab="' + name + '"]');
    if (btn) btn.classList.add('active');
    form.classList.add('active');
    __anSetAuthView(name);
      if (opts && opts.persist) {
        try { localStorage.setItem(TAB_STORAGE_KEY, name); } catch (e) {}
      }
    }
    function showVerificationStep(email, password) {
      pendingSignupEmail = email || '';
      pendingSignupPassword = password || '';
      tabs.forEach(function(x) { x.classList.remove('active'); });
      forms.forEach(function(x) { x.classList.remove('active'); });
      var card = document.querySelector('.card');
      if (card) card.classList.add('verifying');
      var step = document.getElementById('verification-step');
      if (step) step.classList.add('active');
      var emailNode = document.getElementById('verify-email');
      if (emailNode) emailNode.textContent = pendingSignupEmail;
      __anSetAuthView('verification');
      var msg = document.getElementById('verify-msg');
      if (msg) {
        msg.classList.remove('show', 'error', 'success');
        msg.textContent = '';
      }
      try { localStorage.setItem(TAB_STORAGE_KEY, 'signup'); } catch (e) {}
    }
    function getVerificationMessageNode() {
      var verifyStep = document.getElementById('verification-step');
      if (verifyStep && verifyStep.classList.contains('active')) {
        return document.getElementById('verify-msg');
      }
      return document.getElementById('l-msg') || document.getElementById('verify-msg');
    }
    function isVerificationStepActive() {
      var verifyStep = document.getElementById('verification-step');
      return !!(verifyStep && verifyStep.classList.contains('active'));
    }
    function getPendingSignupEmail() {
      var signupEmail = document.getElementById('s-email');
      var loginEmail = document.getElementById('l-email');
      return (pendingSignupEmail || (signupEmail && signupEmail.value) || (loginEmail && loginEmail.value) || '').trim();
    }
    function getPendingSignupPassword() {
      var signupPassword = document.getElementById('s-pass');
      return pendingSignupPassword || (signupPassword && signupPassword.value) || '';
    }
    function __anNormalizeAuthEmail(value) {
      return String(value || '').trim().toLowerCase();
    }
	    function __anIsValidAuthEmail(value) {
	      return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(__anNormalizeAuthEmail(value));
	    }
	    function __anIsVerifiedRedirectSuccess() {
	      try {
	        var params = new URLSearchParams(location.search);
	        return params.has('verified') && !params.has('error');
	      } catch (e) {
	        return false;
	      }
	    }
	    function __anShowEmailValidationError(input, msg) {
	      if (msg) {
	        msg.textContent = __anT('invalidEmail');
	        msg.classList.add('show', 'error');
      }
      if (input && typeof input.focus === 'function') input.focus();
    }
    function movePendingSignupToLogin(message) {
      var email = getPendingSignupEmail();
      setActiveTab('login', { persist: true });
      var loginEmail = document.getElementById('l-email');
      var loginPassword = document.getElementById('l-pass');
      var msg = document.getElementById('l-msg');
      if (loginEmail && email) loginEmail.value = email;
      if (msg) {
        msg.textContent = message || __anT('signInToContinue');
        msg.classList.remove('error');
        msg.classList.add('show', 'success');
      }
      setTimeout(function() { if (loginPassword) loginPassword.focus(); }, 0);
    }
    async function signInWithPendingSignup() {
      var email = getPendingSignupEmail();
      var password = getPendingSignupPassword();
      if (!email || !password) {
        return { ok: false, needsManualSignIn: true };
      }
      var res = await fetch(__anPath('/_agent-native/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: password }),
      });
      if (res.ok) {
        __anRedirectToSignedInApp();
        return { ok: true };
      }
      var data = await res.json().catch(function() { return {}; });
      var error = (data && (data.error || data.message)) || __anT('finishSignInFailed');
      return {
        ok: false,
        error: error,
        isWaitingForVerification: /not verified|verification/i.test(error),
      };
    }
    async function checkVerificationSession(fallbackText, opts) {
      opts = opts || {};
      if (verificationCheckInFlight) return;
      verificationCheckInFlight = true;
      var msg = getVerificationMessageNode();
      var continueBtn = document.getElementById('verify-continue');
      if (continueBtn && !opts.silent) {
        continueBtn.disabled = true;
        continueBtn.textContent = __anT('checking');
      }
      if (msg && !opts.silent) {
        msg.textContent = __anT('checkingVerification');
        msg.classList.remove('error');
        msg.classList.add('show', 'success');
      }
      try {
        var res = await fetch(__anPath('/_agent-native/auth/session'), {
          headers: { 'Accept': 'application/json' },
        });
        var data = await res.json().catch(function() { return {}; });
        if (res.ok && data && data.email && !data.error) {
          __anRedirectToSignedInApp();
          return;
        }
        var loginResult = await signInWithPendingSignup();
        if (loginResult.ok) return;
        if (loginResult.needsManualSignIn) {
          if (!opts.silent) {
            movePendingSignupToLogin(fallbackText || __anT('enterPasswordAfterVerification'));
          }
          return;
        }
        if (loginResult.error && !loginResult.isWaitingForVerification) {
          if (!opts.silent) {
            movePendingSignupToLogin(__anT('finishSignInManually'));
          }
          return;
        }
        if (msg && !opts.silent) {
          msg.textContent = fallbackText || __anT('stillWaitingVerification');
          msg.classList.remove('success');
          msg.classList.add('show', 'error');
        }
      } catch (err) {
        if (msg && !opts.silent) {
          msg.textContent = __anT('checkVerificationFailed');
          msg.classList.remove('success');
          msg.classList.add('show', 'error');
        }
      } finally {
        verificationCheckInFlight = false;
        if (continueBtn && !opts.silent) {
          continueBtn.disabled = false;
          continueBtn.textContent = __anT('continue');
        }
      }
    }
	    function maybeCompleteVerificationAfterReturn() {
	      if (!isVerificationStepActive()) return;
	      checkVerificationSession(null, { silent: true });
	    }
	    function updateResendVerificationCooldown() {
	      var btn = document.getElementById('resend-verification');
	      if (!btn) return;
	      var remaining = Math.ceil((resendVerificationCooldownUntil - Date.now()) / 1000);
	      if (remaining > 0) {
	        btn.disabled = true;
	        btn.textContent = __anT('resendEmail') + ' (' + remaining + 's)';
	        return;
	      }
	      if (resendVerificationCooldownTimer) {
	        clearInterval(resendVerificationCooldownTimer);
	        resendVerificationCooldownTimer = null;
	      }
	      resendVerificationCooldownUntil = 0;
	      btn.disabled = false;
	      btn.textContent = __anT('resendEmail');
	    }
	    function startResendVerificationCooldown(seconds) {
	      resendVerificationCooldownUntil = Date.now() + seconds * 1000;
	      updateResendVerificationCooldown();
	      if (resendVerificationCooldownTimer) clearInterval(resendVerificationCooldownTimer);
	      resendVerificationCooldownTimer = setInterval(updateResendVerificationCooldown, 1000);
	    }
	    async function resendVerificationEmail() {
	      var btn = document.getElementById('resend-verification');
	      var msg = document.getElementById('verify-msg');
	      var email = pendingSignupEmail || document.getElementById('s-email').value;
	      if (!email) return;
	      if (resendVerificationCooldownUntil > Date.now()) {
	        updateResendVerificationCooldown();
	        return;
	      }
	      var original = btn ? btn.textContent : '';
	      if (btn) {
	        btn.disabled = true;
	        btn.textContent = __anT('sending');
      }
      if (msg) msg.classList.remove('show', 'error', 'success');
      try {
        var res = await fetch(__anPath('/_agent-native/auth/ba/send-verification-email'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, callbackURL: __anGetReturnPath() }),
        });
        if (res.ok) {
	          if (msg) {
	            msg.textContent = __anT('sentVerification');
	            msg.classList.add('show', 'success');
	          }
	          startResendVerificationCooldown(RESEND_VERIFICATION_COOLDOWN_SECONDS);
	          return;
	        }
	        var data = await res.json().catch(function() { return {}; });
	        if (msg) {
          msg.textContent = (data && (data.message || data.error)) || __anT('resendVerificationFailed');
          msg.classList.add('show', 'error');
        }
        if (btn) {
          btn.disabled = false;
          btn.textContent = original;
        }
      } catch (err) {
        if (msg) {
          msg.textContent = __anT('networkErrorRetry');
          msg.classList.add('show', 'error');
        }
        if (btn) {
          btn.disabled = false;
          btn.textContent = original;
        }
      }
    }
    (function initActiveTab() {
    var initial = 'signup';
    try {
      var params = new URLSearchParams(location.search);
      var qp = params.get('tab');
      var path = location.pathname;
      while (path.length > 1 && path.charAt(path.length - 1) === '/') path = path.slice(0, -1);
      if (qp === 'login' || qp === 'signup') {
        initial = qp;
	      } else if (__anIsVerifiedRedirectSuccess()) {
	        initial = 'login';
	      } else if (path === '/login' || path.endsWith('/login')) {
        initial = 'login';
      } else if (path === '/signup' || path.endsWith('/signup')) {
        initial = 'signup';
      } else {
        var stored = localStorage.getItem(TAB_STORAGE_KEY);
        if (stored === 'login' || stored === 'signup') initial = stored;
      }
    } catch (e) {}
    setActiveTab(initial, { persist: false });
	      try {
	        if (__anIsVerifiedRedirectSuccess()) {
	          var msg = document.getElementById('l-msg');
          if (msg) {
            msg.textContent = __anT('emailVerifiedFinishing');
            msg.classList.remove('error');
            msg.classList.add('show', 'success');
          }
          checkVerificationSession(__anT('emailVerifiedSignIn'));
        }
      } catch (e) {}
    })();
  tabs.forEach(function(t) { t.addEventListener('click', function() {
    setActiveTab(t.dataset.tab, { persist: true });
  }); });

  document.getElementById('signup-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    var form = e.currentTarget;
    var btn = form.querySelector('button[type="submit"]');
    var msg = document.getElementById('s-msg');
    msg.classList.remove('show', 'error', 'success');
    var pass = document.getElementById('s-pass').value;
    var pass2 = document.getElementById('s-pass2').value;
    if (pass !== pass2) {
      msg.textContent = __anT('passwordsMismatch');
      msg.classList.add('show', 'error');
      return;
    }
    var originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = __anT('creatingAccount');
    try {
      var emailInput = document.getElementById('s-email');
      var email = __anNormalizeAuthEmail(emailInput && emailInput.value);
      if (!__anIsValidAuthEmail(email)) {
        btn.disabled = false;
        btn.textContent = originalLabel;
        __anShowEmailValidationError(emailInput, msg);
        return;
      }
      var res = await fetch(__anPath('/_agent-native/auth/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email,
            password: pass,
            callbackURL: __anGetReturnPath(),
          }),
        });
      var data = await res.json().catch(function() { return {}; });
      if (res.ok) {
        // If email verification is required, the server won't return a session.
        // Try logging in — if it fails (unverified), show a "check your email" message.
        var loginRes = await fetch(__anPath('/_agent-native/auth/login'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, password: pass }),
        });
        if (loginRes.ok) {
          msg.textContent = __anT('accountCreatedSigningIn');
          msg.classList.add('show', 'success');
          __anRedirectToSignedInApp();
          return;
        }
          btn.disabled = false;
          btn.textContent = originalLabel;
          showVerificationStep(email, pass);
          return;
        }
      msg.textContent = data.error || __anT('registrationFailed');
      msg.classList.add('show', 'error');
      btn.disabled = false;
      btn.textContent = originalLabel;
    } catch (err) {
      msg.textContent = __anT('networkErrorDashRetry');
      msg.classList.add('show', 'error');
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
    });

    var verifyContinue = document.getElementById('verify-continue');
    if (verifyContinue) verifyContinue.addEventListener('click', function(e) {
      e.preventDefault();
      checkVerificationSession();
    });
    window.addEventListener('focus', maybeCompleteVerificationAfterReturn);
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') maybeCompleteVerificationAfterReturn();
    });
    var resendBtn = document.getElementById('resend-verification');
    if (resendBtn) resendBtn.addEventListener('click', function(e) {
      e.preventDefault();
      resendVerificationEmail();
    });
    var backToSignup = document.getElementById('back-to-signup');
    if (backToSignup) backToSignup.addEventListener('click', function(e) {
      e.preventDefault();
      setActiveTab('signup', { persist: true });
      var email = document.getElementById('s-email');
      setTimeout(function() { if (email) email.focus(); }, 0);
    });

    var forgotLink = document.getElementById('forgot-link');
  var backToLogin = document.getElementById('back-to-login');
  if (forgotLink) forgotLink.addEventListener('click', function(e) {
    e.preventDefault();
    document.getElementById('login-form').classList.remove('active');
    document.getElementById('forgot-form').classList.add('active');
    __anSetAuthView('forgot');
    var fEmail = document.getElementById('f-email');
    var lEmail = document.getElementById('l-email');
    if (lEmail && lEmail.value) fEmail.value = lEmail.value;
    setTimeout(function() { fEmail.focus(); }, 0);
  });
  if (backToLogin) backToLogin.addEventListener('click', function(e) {
    e.preventDefault();
    document.getElementById('forgot-form').classList.remove('active');
    document.getElementById('login-form').classList.add('active');
    __anSetAuthView('login');
  });

  var forgotForm = document.getElementById('forgot-form');
  if (forgotForm) forgotForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    var btn = e.currentTarget.querySelector('button[type="submit"]');
    var msg = document.getElementById('f-msg');
    msg.classList.remove('show', 'error', 'success');
    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = __anT('sending');
    try {
      var emailInput = document.getElementById('f-email');
      var email = __anNormalizeAuthEmail(emailInput && emailInput.value);
      if (!__anIsValidAuthEmail(email)) {
        btn.disabled = false;
        btn.textContent = original;
        __anShowEmailValidationError(emailInput, msg);
        return;
      }
      var res = await fetch(__anPath('/_agent-native/auth/ba/request-password-reset'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email }),
      });
      if (res.ok) {
        msg.textContent = __anT('resetEmailSent');
        msg.classList.add('show', 'success');
        btn.textContent = __anT('sent');
        return;
      }
      var data = await res.json().catch(function() { return {}; });
      msg.textContent = (data && (data.message || data.error)) || __anT('resetEmailFailed');
      msg.classList.add('show', 'error');
      btn.disabled = false;
      btn.textContent = original;
    } catch (err) {
      msg.textContent = __anT('networkErrorDashRetry');
      msg.classList.add('show', 'error');
      btn.disabled = false;
      btn.textContent = original;
    }
  });

    document.getElementById('login-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    var form = e.currentTarget;
      var btn = form.querySelector('button[type="submit"]');
      var msg = document.getElementById('l-msg');
      msg.classList.remove('show', 'success');
      msg.classList.add('error');
    var originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = __anT('signingIn');
    try {
      var emailInput = document.getElementById('l-email');
      var email = __anNormalizeAuthEmail(emailInput && emailInput.value);
      if (!__anIsValidAuthEmail(email)) {
        btn.disabled = false;
        btn.textContent = originalLabel;
        __anShowEmailValidationError(emailInput, msg);
        return;
      }
      var res = await fetch(__anPath('/_agent-native/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          password: document.getElementById('l-pass').value,
        }),
      });
      if (res.ok) {
        __anRedirectToSignedInApp();
        return;
      }
      var data = await res.json().catch(function() { return {}; });
      msg.textContent = data.error || __anT('invalidLogin');
      msg.classList.add('show');
      btn.disabled = false;
      btn.textContent = originalLabel;
    } catch (err) {
      msg.textContent = __anT('networkErrorDashRetry');
      msg.classList.add('show');
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });
`
}
${
  renderGoogleButton
    ? `
    async function signInWithGoogle() {
    if (__anShouldShowGoogleNotice()) {
      __anShowGoogleNotice();
      return;
    }
    return __anStartGoogleSignIn();
  }
    async function __anStartGoogleSignIn() {
    var btn = document.getElementById('google-btn');
    var err = document.getElementById('google-err');
    var ret = __anGetReturnPath();
    btn.disabled = true;
    __anGoogleSignInInFlight = true;
    __anBindGoogleRecover();
    err.classList.remove('show');
    if (__anResolveAuthFlow() === 'popup') {
      __anStartPopupOAuth(ret, btn, err);
      return;
    }
    if (__anIsAgentNativeDesktop()) {
      __anStartNativeDesktopOAuth(ret, btn, err);
      return;
    }
    if (__anIsBuilderPreview()) {
      var flowId = __anNewOAuthFlowId();
      __anStartRedirectOAuth(ret, btn, err, flowId, 'Opening Google sign-in redirect from Builder preview');
      return;
    }
    try {
      var authUrl = __anGoogleAuthUrlPath() + '?return=' + encodeURIComponent(ret);
      var res = await fetch(authUrl);
      var data = await res.json();
      if (data.url) {
        __anOpenOAuthUrl(data.url);
      } else {
        err.textContent = data.message || __anT('googleNotConfigured');
        err.classList.add('show');
        btn.disabled = false;
        __anGoogleSignInInFlight = false;
      }
    } catch (e) {
      err.textContent = __anT('failedToConnect');
      err.classList.add('show');
      btn.disabled = false;
      __anGoogleSignInInFlight = false;
    }
  }`
    : ""
}
${
  googleSignInNotice
    ? `
  window.__anGoogleNoticeAccepted = false;
  function __anShouldShowGoogleNotice() {
    var notice = document.getElementById('google-preflight');
    if (!notice || window.__anGoogleNoticeAccepted) return false;
    var host = notice.getAttribute('data-host');
    return !host || window.location.hostname === host;
  }
  function __anSetGoogleNoticeOpen(open) {
    var notice = document.getElementById('google-preflight');
    var trigger = document.getElementById('google-btn');
    if (!notice) return;
    if (open) {
      notice.classList.add('show');
      if (trigger) trigger.setAttribute('aria-expanded', 'true');
    } else {
      notice.classList.remove('show');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }
  }
  function __anShowGoogleNotice() {
    var notice = document.getElementById('google-preflight');
    if (!notice) return;
    __anSetGoogleNoticeOpen(true);
    var continueBtn = document.getElementById('google-preflight-continue');
    if (continueBtn) continueBtn.focus();
  }
  function __anHideGoogleNotice() {
    __anSetGoogleNoticeOpen(false);
  }
  function __anChooseRunLocalFromGoogleNotice() {
    var panel = document.getElementById('google-preflight-run-local-panel');
    if (!panel) {
      __anHideGoogleNotice();
      return;
    }
    panel.removeAttribute('hidden');
    var copy = document.getElementById('copy-google-preflight-run-local');
    if (copy) copy.focus();
  }
  function __anAcceptGoogleNotice() {
    window.__anGoogleNoticeAccepted = true;
    __anHideGoogleNotice();
    __anStartGoogleSignIn();
  }
  (function __anInstallGoogleNoticeDismissal() {
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') __anHideGoogleNotice();
    });
    document.addEventListener('click', function(event) {
      var notice = document.getElementById('google-preflight');
      if (!notice || !notice.classList.contains('show')) return;
      var wrapper = document.getElementById('google-signin');
      if (wrapper && wrapper.contains(event.target)) return;
      __anHideGoogleNotice();
    });
  })();`
    : `
  function __anShouldShowGoogleNotice() { return false; }`
}
${starfieldScript}
${
  runLocalCommand || signupLocalModeNote
    ? `
  function __anSetRunLocalCommandOpen(open) {
    var panel = document.getElementById('run-local-panel');
    var button = document.getElementById('run-local-button');
    if (!panel || !button) return;
    if (open) {
      panel.removeAttribute('hidden');
    } else {
      panel.setAttribute('hidden', '');
    }
    button.setAttribute('aria-expanded', String(open));
  }
  function __anToggleRunLocalCommand() {
    var panel = document.getElementById('run-local-panel');
    if (!panel) return;
    __anSetRunLocalCommandOpen(panel.hasAttribute('hidden'));
  }
  function __anCopyCommandFromPanel(panelId, buttonId) {
    var panel = document.getElementById(panelId);
    var button = document.getElementById(buttonId);
    if (!panel || !button) return;
    var command = panel.getAttribute('data-command') || '';
    var original = button.textContent || __anT('copyCommand');
    function markCopied() {
      button.textContent = __anT('copied');
      setTimeout(function() { button.textContent = original; }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(command).then(markCopied).catch(function() {});
    }
  }
  function __anCopyRunLocalCommand() {
    __anCopyCommandFromPanel('run-local-panel', 'copy-run-local');
  }
  function __anCopySignupLocalModeCommand() {
    __anCopyCommandFromPanel('signup-local-mode-note', 'copy-signup-local-mode');
  }
  function __anCopyGoogleNoticeRunLocalCommand() {
    __anCopyCommandFromPanel('google-preflight-run-local-panel', 'copy-google-preflight-run-local');
  }`
    : ""
}
</script>
</body>
</html>`;
}

/** @deprecated Use getOnboardingHtml() instead */
export const ONBOARDING_HTML = getOnboardingHtml();

/**
 * HTML for the password reset page — shown when the user clicks the link in
 * their reset email. Posts `{ newPassword, token }` to Better Auth's
 * `/reset-password` endpoint, then redirects to the login page.
 */
export function getResetPasswordHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>Reset password</title>
<link rel="icon" type="image/svg+xml" href="${withAppBasePath("/favicon.svg")}">
<link rel="apple-touch-icon" href="${withAppBasePath("/icon-180.svg")}">
<style>
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
</style>
</head>
<body>
<div class="card">
  <h1>Choose a new password</h1>
  <p class="subtitle">Set a new password for your account.</p>
  <form id="reset-form">
    <label for="p1">New password</label>
    <input id="p1" type="password" autocomplete="new-password" autofocus placeholder="At least 8 characters" required minlength="8" />
    <label for="p2">Confirm password</label>
    <input id="p2" type="password" autocomplete="new-password" placeholder="Confirm password" required minlength="8" />
    <button type="submit">Save new password</button>
    <p class="msg" id="msg"></p>
  </form>
  <a class="back" id="back-link" href="/">Back to sign in</a>
</div>
<script>
  (function() {
    // Derive the app's base path so apps mounted under a prefix
    // (e.g. /mail, /calendar) get sent home instead of to the root domain.
    var RESET_PATH = '/_agent-native/auth/reset';
    var pathname = window.location.pathname;
    var idx = pathname.indexOf(RESET_PATH);
    var basePath = (idx >= 0 ? pathname.slice(0, idx) : '') || '';
    var homeHref = basePath + '/';
    var backLink = document.getElementById('back-link');
    if (backLink) backLink.setAttribute('href', homeHref);
    var params = new URLSearchParams(location.search);
    var token = params.get('token') || '';
    var msg = document.getElementById('msg');
    if (!token) {
      msg.textContent = 'Missing or invalid reset token. Request a new reset link.';
      msg.classList.add('show', 'error');
      document.getElementById('reset-form').style.display = 'none';
      return;
    }
    document.getElementById('reset-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      var btn = e.currentTarget.querySelector('button[type="submit"]');
      var p1 = document.getElementById('p1').value;
      var p2 = document.getElementById('p2').value;
      msg.classList.remove('show', 'error', 'success');
      if (p1 !== p2) {
        msg.textContent = 'Passwords do not match';
        msg.classList.add('show', 'error');
        return;
      }
      var original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        var res = await fetch(basePath + '/_agent-native/auth/ba/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newPassword: p1, token: token }),
        });
        if (res.ok) {
          msg.textContent = 'Password updated — redirecting to sign in…';
          msg.classList.add('show', 'success');
          setTimeout(function() { window.location.href = homeHref; }, 1200);
          return;
        }
        var data = await res.json().catch(function() { return {}; });
        msg.textContent = (data && (data.message || data.error)) || 'Reset failed. The link may have expired — request a new one.';
        msg.classList.add('show', 'error');
        btn.disabled = false;
        btn.textContent = original;
      } catch (err) {
        msg.textContent = 'Network error — please try again';
        msg.classList.add('show', 'error');
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  })();
</script>
</body>
</html>`;
}
