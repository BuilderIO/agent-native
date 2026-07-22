const messages = {
  intelligence: {
    title: "인텔리전스",
    description:
      "제한된 통화 증거에서 CRM이 알아차려야 할 순간을 선택하세요. 스마트 추적기는 Ask CRM을 통해 평가되며 이 설정 화면에서 직접 실행되지 않습니다.",
    loading: "추적기를 불러오는 중…",
    kindKeyword: "키워드",
    kindSmart: "스마트",
    enable: "사용",
    disable: "사용 안 함",
    toggleTracker: "{{name}} {{action}}",
    emptyTitle: "신호 추적기가 아직 없습니다",
    emptyDescription:
      "결정론적 일치를 위한 키워드나 Ask CRM이 검토할 스마트 기준을 추가하세요.",
    trackerDeleted: "추적기가 삭제되었습니다.",
    trackerEnabled: "추적기가 사용 설정되었습니다.",
    trackerDisabled: "추적기가 사용 중지되었습니다.",
    trackerUpdateFailed: "추적기를 업데이트하지 못했습니다.",
    trackerCreated: "추적기가 생성되었습니다.",
    trackerCreationFailed: "추적기를 생성하지 못했습니다.",
    newTracker: "새 추적기",
    createTitle: "신호 추적기 만들기",
    createDescription:
      "결정론적 키워드를 추적하거나 Ask CRM이 통화 증거에 대해 평가할 제한된 스마트 기준을 정의하세요.",
    name: "이름",
    trackerDescription: "설명",
    detector: "감지기",
    keywords: "키워드",
    keywordsPlaceholder: "가격, 갱신, 보안 검토",
    keywordsHelp: "최대 40개의 키워드를 쉼표로 구분하세요.",
    classificationCriterion: "분류 기준",
    criterionPlaceholder: "구현 일정에 대한 명확한 우려를 찾아냅니다.",
    creating: "만드는 중…",
    create: "추적기 만들기",
    deleteTrackerAria: "{{name}} 삭제",
    deleteTrackerTitle: "{{name}}을(를) 삭제할까요?",
    deleteTrackerDescription:
      "이 추적기는 이후 신호 실행에서 사용되지 않습니다. 기존에 검토한 신호는 변경되지 않습니다.",
    cancel: "취소",
    deleteTracker: "추적기 삭제",
    keywordsSummary: "키워드: {{keywords}}",
    noKeywordsConfigured: "구성된 키워드가 없습니다.",
    evaluatedThroughAsk: "Ask CRM을 통해 평가됩니다.",
  },
  recordActions: {
    evidenceAttached: "통화 증거가 첨부되었습니다.",
    evidenceAttachFailed: "증거를 첨부하지 못했습니다.",
    addEvidence: "증거 추가",
    attachEvidenceTitle: "Clips 증거 첨부",
    attachEvidenceDescription:
      "지속 가능한 Clips 페이지 링크를 사용하세요. CRM은 아티팩트 참조, 페이지 URL, 제한된 발췌문만 저장하며 미디어나 녹취는 저장하지 않습니다.",
    artifactId: "아티팩트 ID",
    clipsUrl: "Clips URL 주소",
    summary: "요약",
    shortExcerpt: "짧은 발췌문",
    attachEvidence: "증거 첨부",
    automate: "자동화",
    reviewNewClipsCalls: "새 Clips 통화 검토",
    reviewDescription:
      "Clips 미디어나 녹취를 복사하지 않고 이 CRM 레코드의 검토 레시피를 준비합니다.",
    disabledAutomationDescription:
      "이 작업은 사용 중지 상태로 시작하며 {{name}}에 연결된 상태를 유지합니다. 명시적으로 활성화되면 각 새 클립은 액세스 확인을 거친 녹화 페이지 참조만 이 레코드에 첨부할 수 있습니다.",
    handoffDescription:
      "전달에는 불투명한 클립 ID, 지속 가능한 {{path}} 페이지 URL 및 캡처 시간만 남습니다. 이벤트 URL, 미디어, 액세스 토큰, 녹취, 추론된 레코드 및 공급자 쓰기는 거부됩니다.",
    manageAutomations: "자동화 관리",
    configureWithAgent: "에이전트로 구성",
  },
  dashboard: {
    metaTitle: "파이프라인 · CRM",
    pipeline: "파이프라인",
    ready: "파이프라인 대시보드가 준비되었습니다.",
    installFailed: "파이프라인 대시보드를 설치하지 못했습니다.",
    loadingDescription: "접근 범위가 적용된 파이프라인 대시보드를 불러오는 중…",
    emptyDescription:
      "단계별 기회 가치를 실시간으로 보여 주는 권한 인식 보기입니다.",
    installTitle: "파이프라인 대시보드 설치",
    installDescription:
      "현재 작업 공간에 CRM 소유 데이터 프로그램과 비공개 대시보드를 만듭니다.",
    installAction: "파이프라인 대시보드 설치",
    liveDescription:
      "실시간 기회 합계는 현재 뷰어의 CRM 접근 권한을 사용하며 캐시된 데이터 프로그램에서 새로 고쳐집니다.",
    updating: "업데이트 중…",
    updatePack: "팩 업데이트",
  },
};

export default messages;
