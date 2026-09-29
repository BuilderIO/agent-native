import type { EnvironmentBadgeMessages } from "../../environment-badge-messages.js";
import type {
  McpConnectMessages,
  McpSettingsMessages,
} from "../../mcp-settings-messages.js";
import type { PrivacySettingsMessages } from "../../privacy-settings-messages.js";

export const environmentBadgeMessages: EnvironmentBadgeMessages = {
  betaLabel: "베타",
  betaTitle: "Agent-Native {{label}}를 사용 중입니다",
  productionTitle: "Agent-Native 프로덕션을 사용 중입니다",
  activeDevelopment: "활발히 개발 중",
  feedbackPrompt:
    "이 템플릿은 활발히 개발 중입니다. 만들어 가는 과정에서 의견을 들려주세요.",
  continuePrompt: "계속할 환경을 선택하세요.",
  switchToProduction: "프로덕션으로 전환",
  goToBeta: "베타로 이동",
  hideBadge: "배지 숨기기",
  openSwitcher: "{{title}} 전환기 열기",
  localDevelopment: "로컬 개발 환경",
  development: "개발 환경",
};

export const mcpConnectMessages: McpConnectMessages = {
  pageTitle: "{appName} 연결",
  authorizeLabel: "{appName} 승인",
  terminalTitle: "터미널에서 {appName}을(를) 승인하시겠습니까?",
  assistantTitle: "AI 도우미에서 {appName} 사용",
  signedInAs: "로그인 계정",
  deviceCode: "기기 코드",
  guidesLabel: "MCP URL 안내",
  advancedOptions: "고급 옵션",
  labelOptional: "라벨(선택사항)",
  labelPlaceholder: "예: 내 노트북의 Claude Code",
  expiresInDays: "만료 기간(일, 1–365)",
  terminalAlternative: "터미널 대안",
  existingConnections: "기존 연결",
  checkingConnections: "연결 확인 중...",
  unavailable: "사용할 수 없음",
  couldNotLoadConnections: "연결을 불러올 수 없습니다.",
  emptyConnections: "생성된 연결이 나중에 취소할 수 있도록 여기에 표시됩니다.",
  unlabeled: "(라벨 없음)",
  lastUsed: "마지막 사용",
  revoked: "취소됨",
  created: "생성됨",
  revoke: "취소",
  couldNotRevoke: "토큰을 취소할 수 없습니다.",
  authorizeDevice: "기기 승인",
  fullCatalogRequested:
    "이 기기는 전체 작업 카탈로그에 대한 액세스를 요청하고 있습니다.",
  createToken: "연결 토큰 생성",
  authorizingDevice: "기기 승인 중...",
  creatingToken: "토큰 생성 중...",
  couldNotAuthorize: "이 기기 코드를 승인할 수 없습니다.",
  unknownDeviceCode:
    "이 기기 코드를 인식할 수 없습니다. 터미널에서 연결을 다시 시작하세요.",
  expiredDeviceCode:
    "이 기기 코드가 만료되었습니다. 터미널에서 연결을 다시 시작하세요.",
  alreadyUsedDeviceCode:
    "이 기기 코드는 이미 사용되었습니다. 터미널에서 연결을 다시 시작하세요.",
  finishingConnection: "연결을 완료하는 중… 터미널로 돌아가도 됩니다.",
  deviceAuthorized: "기기 승인됨",
  connected: "연결됨",
  connectedDescription:
    "이 기기는 이제 사용자를 대신해 작업할 수 있습니다. 아래에서 관리하거나 취소하세요.",
  couldNotCreate: "토큰을 생성할 수 없습니다.",
  networkError: "네트워크 오류입니다. 다시 시도하세요.",
  urlTitle: "MCP URL",
};

export const mcpSettingsMessages: McpSettingsMessages = {
  mcpTitle: "MCP",
  mcpDescription:
    "이 앱을 Claude, ChatGPT, Cursor, Codex 또는 다른 MCP 호스트에 연결합니다.",
  mcpUrlLabel: "MCP 서버 URL",
  mcpUrlHint: "사용할 AI 호스트에 이 URL을 복사하세요. 표준 경로는 /mcp입니다.",
  mcpOpenDocs: "MCP 연결 문서 열기",
  a2aAgentCard: "A2A 에이전트 카드",
  a2aOpenDocs: "A2A 문서 열기",
  mcpClientSetup: "AI 호스트 연결",
  mcpClientSetupDescription:
    "호스트를 선택하면 단계별 설정을 확인할 수 있고, 모든 MCP 호환 클라이언트에 URL을 붙여 넣을 수도 있습니다.",
  mcpChooseAssistant: "AI 도우미 선택",
  mcpCommand: "명령",
  mcpConfig: "MCP 구성",
  mcpCopy: "복사",
  mcpCopied: "복사됨",
  mcpStaticTokenDescription:
    "전체 연결 페이지를 열어 OAuth를 완료할 수 없는 클라이언트용 토큰을 만드세요.",
  mcpOpenConnectPage: "전체 연결 페이지 열기",
  mcpConnect: mcpConnectMessages,
};

export const privacySettingsMessages: PrivacySettingsMessages = {
  privacyTitle: "개인정보 및 데이터",
  privacyDescription: "데이터 사본을 요청하거나 개인 데이터 삭제를 요청하세요.",
  privacyManage: "관리",
  privacyRightsTitle: "데이터 권리",
  privacyRightsDescription:
    "요청은 워크스페이스 관리자가 검토하고 신원을 확인한 후 후속 조치를 할 수 있도록 기록됩니다.",
  privacyRequestCopy: "사본 요청",
  privacyRequestDeletion: "삭제 요청",
  privacyRequesting: "요청 기록 중...",
  privacyRequestRecorded: "요청이 기록되었습니다. 관리자가 연락드릴 것입니다.",
  privacyRequestRecordedShort: "요청 기록됨",
  privacyRequestError: "요청을 기록할 수 없습니다. 다시 시도하세요.",
  privacyDeletionTitle: "데이터를 삭제하도록 요청하시겠습니까?",
  privacyDeletionDescription:
    "삭제 요청을 기록합니다. 데이터가 즉시 삭제되지는 않습니다. 관리자가 신원을 확인하고 이 배포의 보존 및 법적 의무에 따라 요청을 처리합니다.",
  privacyDocsLink: "개인정보 및 데이터 권리 읽기",
};
