import type { EnvironmentBadgeMessages } from "../../environment-badge-messages.js";
import type {
  McpConnectMessages,
  McpSettingsMessages,
} from "../../mcp-settings-messages.js";
import type { PrivacySettingsMessages } from "../../privacy-settings-messages.js";

export const environmentBadgeMessages: EnvironmentBadgeMessages = {
  betaLabel: "ベータ",
  betaTitle: "Agent-Native {{label}}を使用中です",
  productionTitle: "Agent-Native 本番環境を使用中です",
  activeDevelopment: "積極的に開発中",
  feedbackPrompt:
    "このテンプレートは積極的に開発中です。開発を進めるため、ぜひフィードバックをお寄せください。",
  continuePrompt: "続行する環境を選択してください。",
  switchToProduction: "本番環境に切り替え",
  goToBeta: "ベータ版へ移動",
  hideBadge: "バッジを非表示",
  openSwitcher: "{{title}}切り替えを開く",
  localDevelopment: "ローカル開発環境",
  development: "開発環境",
};

export const mcpConnectMessages: McpConnectMessages = {
  pageTitle: "{appName} に接続",
  authorizeLabel: "{appName} を承認",
  terminalTitle: "ターミナルから {appName} を承認しますか？",
  assistantTitle: "AI アシスタントで {appName} を使う",
  signedInAs: "ログイン中のアカウント:",
  deviceCode: "デバイスコード",
  guidesLabel: "MCP URL ガイド",
  advancedOptions: "詳細設定",
  labelOptional: "ラベル（任意）",
  labelPlaceholder: "例: ノートパソコンの Claude Code",
  expiresInDays: "有効期限（日数、1–365）",
  terminalAlternative: "ターミナルでの代替方法",
  existingConnections: "既存の接続",
  checkingConnections: "接続を確認中...",
  unavailable: "利用できません",
  couldNotLoadConnections: "接続を読み込めませんでした。",
  emptyConnections: "作成した接続は、後で取り消せるようここに表示されます。",
  unlabeled: "（ラベルなし）",
  lastUsed: "最終使用",
  revoked: "取り消し済み",
  created: "作成済み",
  revoke: "取り消す",
  couldNotRevoke: "トークンを取り消せませんでした。",
  authorizeDevice: "デバイスを承認",
  fullCatalogRequested:
    "このデバイスは、すべてのアクションカタログへのアクセスを要求しています。",
  createToken: "接続トークンを作成",
  authorizingDevice: "デバイスを承認中...",
  creatingToken: "トークンを作成中...",
  couldNotAuthorize: "このデバイスコードを承認できませんでした。",
  unknownDeviceCode:
    "このデバイスコードは認識されません。ターミナルから接続をやり直してください。",
  expiredDeviceCode:
    "このデバイスコードは期限切れです。ターミナルから接続をやり直してください。",
  alreadyUsedDeviceCode:
    "このデバイスコードはすでに使用されています。ターミナルから接続をやり直してください。",
  finishingConnection: "接続を完了しています…ターミナルに戻ることができます。",
  deviceAuthorized: "デバイスを承認しました",
  connected: "接続済み",
  connectedDescription:
    "このデバイスはあなたの代わりに操作できます。下で管理または取り消しができます。",
  couldNotCreate: "トークンを作成できませんでした。",
  networkError: "ネットワークエラーです。もう一度お試しください。",
  urlTitle: "MCP URL",
};

export const mcpSettingsMessages: McpSettingsMessages = {
  mcpTitle: "MCP",
  mcpDescription:
    "このアプリを Claude、ChatGPT、Cursor、Codex、その他の MCP ホストに接続します。",
  mcpUrlLabel: "MCP サーバー URL",
  mcpUrlHint:
    "この URL を使用する AI ホストにコピーします。標準パスは /mcp です。",
  mcpOpenDocs: "MCP 接続ドキュメントを開く",
  a2aAgentCard: "A2A エージェントカード",
  a2aOpenDocs: "A2A ドキュメントを開く",
  mcpClientSetup: "AI ホストを接続",
  mcpClientSetupDescription:
    "ホストを選ぶと手順に沿って設定できます。または、MCP 対応クライアントに URL を貼り付けます。",
  mcpChooseAssistant: "AI アシスタントを選択",
  mcpCommand: "コマンド",
  mcpConfig: "MCP 設定",
  mcpCopy: "コピー",
  mcpCopied: "コピーしました",
  mcpStaticTokenDescription:
    "完全な接続ページを開いて、OAuth を完了できないクライアント用のトークンを作成します。",
  mcpOpenConnectPage: "完全な接続ページを開く",
  mcpConnect: mcpConnectMessages,
};

export const privacySettingsMessages: PrivacySettingsMessages = {
  privacyTitle: "プライバシーとデータ",
  privacyDescription:
    "データのコピーを請求するか、個人データの削除を依頼できます。",
  privacyManage: "管理",
  privacyRightsTitle: "データに関する権利",
  privacyRightsDescription:
    "リクエストはワークスペース管理者が確認できるよう記録され、本人確認後に連絡します。",
  privacyRequestCopy: "コピーを請求",
  privacyRequestDeletion: "削除を依頼",
  privacyRequesting: "リクエストを記録中...",
  privacyRequestRecorded: "リクエストを記録しました。管理者から連絡します。",
  privacyRequestRecordedShort: "リクエストを記録済み",
  privacyRequestError:
    "リクエストを記録できませんでした。もう一度お試しください。",
  privacyDeletionTitle: "データの削除を依頼しますか？",
  privacyDeletionDescription:
    "削除リクエストを記録します。データはすぐには削除されません。管理者が本人確認を行い、このデプロイの保持義務と法的義務に従って対応します。",
  privacyDocsLink: "プライバシーとデータに関する権利を読む",
};
