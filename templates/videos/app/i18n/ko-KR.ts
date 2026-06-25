const messages = {
  root: {
    commandVideos: "동영상",
    searchCompositions: "컴포지션 검색",
    commandAppearance: "모양",
    toggleTheme: "테마 전환",
  },
  header: {
    videos: "동영상",
    components: "컴포넌트",
    designSystems: "디자인 시스템",
    team: "팀",
    settings: "설정",
    extensions: "확장",
    newComposition: "새 컴포지션",
    studio: "스튜디오",
  },
  navigation: {
    settings: "설정",
    brand: "Videos",
    animations: "애니메이션",
    components: "컴포넌트",
    designSystems: "디자인 시스템",
    team: "팀",
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
    emptyState: "동영상에 대해 무엇이든 물어보세요",
    suggestionLogo: "Acme 로고 리빌 만들기",
    suggestionZoom: "이 장면에 카메라 줌 추가",
    suggestionSlow: "인트로 애니메이션 느리게 하기",
  },
  sidebar: {
    navigation: "탐색",
    openNavigation: "탐색 열기",
  },
  studio: {
    closeSidebar: "사이드바 닫기",
    openSidebar: "사이드바 열기",
    share: "공유",
    shareVideos: "동영상 공유",
    shareVideosDescription:
      "동영상을 공유하거나 내보내려면 클라우드 데이터베이스를 연결해 어디서든 컴포지션에 접근할 수 있게 하세요.",
    compositions: "컴포지션",
    properties: "속성",
  },
  newComposition: {
    runFailed: "컴포지션을 만들기 전에 에이전트 실행이 실패했습니다.",
    readFailed: "첨부 파일을 읽을 수 없습니다.",
    startFailed: "컴포지션 요청을 시작할 수 없습니다.",
    button: "새 컴포지션",
    title: "새 컴포지션",
    description: "만들고 싶은 동영상을 설명하세요",
    placeholder: "만들고 싶은 동영상을 설명하세요...",
    timedOut:
      "컴포지션 요청 시간이 초과되었습니다. 사이드바에서 다시 시도하세요.",
    generating: "생성 중...",
  },
  notFound: {
    message: "이 페이지는 아직 없습니다. 계속 요청하면 만들어집니다.",
    backToStudio: "Studio로 돌아가기",
  },
  designSystems: {
    new: "새 디자인 시스템",
    setupBrand: "브랜드 설정",
    emptyTitle: "브랜드 아이덴티티 설정",
    emptyDescription:
      "브랜드 색상, 타이포그래피, 로고로 디자인 시스템을 만드세요. 새 컴포지션은 모두 이 시각적 정체성을 따릅니다.",
  },
};

export default messages;
