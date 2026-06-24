const messages = {
  root: {
    commandActions: "작업",
    askPlan: "Plan에 질문",
    openPlans: "계획 열기",
    openRecaps: "요약 열기",
    commandAppearance: "모양",
    toggleTheme: "테마 전환",
  },
  header: {
    plan: "Plan",
    settings: "설정",
    team: "팀",
    extensions: "확장",
  },
  navigation: {
    settings: "설정",
    ask: "질문",
    plan: "계획",
  },
  settings: {
    title: "설정",
    description: "이 앱의 언어 및 워크스페이스 환경설정입니다.",
    languageTitle: "언어",
    languageDescription:
      "인터페이스 언어를 선택하세요. 이 기본 설정은 계정에 저장됩니다.",
    languageLabel: "인터페이스 언어",
    workspaceTitle: "워크스페이스",
    workspaceDescription:
      "팀원, 조직 접근 권한, 공유 워크스페이스 환경설정을 관리합니다.",
    openTeamSettings: "팀 설정 열기",
    openResourceSettings: "리소스 설정 열기",
    agentTitle: "에이전트 설정",
    agentDescription:
      "오른쪽 사이드바의 에이전트 설정을 열어 모델, API 키, 자동화, 음성 및 기타 제어를 관리합니다.",
    openAgentSettings: "에이전트 설정 열기",
  },
  agent: {
    emptyState:
      "Plan 에이전트에게 병합된 PR 요약 검색, 문서 검토, 다이어그램 추가, 코드 질문에 대한 시각적 계획 답변을 요청하세요.",
    suggestionShipped: "지난주에 무엇이 출시되었나요?",
    suggestionUi: "이 UI는 어떻게 보이나요?",
    suggestionApi: "이 API의 구조는 무엇인가요?",
  },
  sidebar: {
    openNavigation: "탐색 열기",
    navigation: "탐색",
    navigationDescription: "앱 탐색 링크",
    chats: "채팅",
    newPlanChat: "새 Plan 채팅",
    newChat: "새 채팅",
    renameChat: "채팅 이름 변경",
    unpinChat: "채팅 고정 해제",
    pinChat: "채팅 고정",
    archiveChat: "채팅 보관",
    planSection: "계획",
    newPlan: "새 계획",
    signInCreatePlan: "계획을 만들려면 로그인",
    signInToCreate: "만들려면 로그인",
    signInKeepPlans: "로그인하면 계획을 만들고 보관할 수 있습니다.",
    noPlans: "아직 계획이 없습니다.",
    recapBadge: "요약",
    viewAllPlans: "모든 계획 보기...",
    brandingSentLocal: "브랜딩 요청을 로컬 코드 에이전트에 보냈습니다",
    brandingSent: "브랜딩 요청을 코드 에이전트에 보냈습니다",
    customizePlanBranding: "Plan 브랜딩 사용자 지정",
    customizeBranding: "브랜딩 사용자 지정",
    customizeBrandingDescription:
      "Plan 전체에 적용할 브랜드 변경을 설명하세요.",
    customizeBrandingPlaceholder: "로고 사용, 앱 이름 변경, 색상 업데이트...",
    expandSidebar: "사이드바 펼치기",
    collapseSidebar: "사이드바 접기",
    signIn: "로그인",
  },
  chat: {
    suggestionShipped: "What shipped in the last week?",
    suggestionUi: "What does the new checkout UI look like?",
    suggestionAuth: "When did the auth API change?",
    suggestionApi: "What is the shape of the billing API?",
    emptyState: "Ask Plan",
    placeholder:
      "Ask what shipped, what changed, or what the current code shows...",
    heading: "Ask Plan",
    description:
      "Search merged PR recaps, inspect visual blocks, and publish code answers as diagrams, wireframes, API specs, and data models.",
  },
  guest: {
    banner:
      "You're browsing as a guest. Sign in to create plans, leave comments, and keep your work.",
    signIn: "Sign in",
  },
};

export default messages;
