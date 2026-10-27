const messages = {
  composer: {
    removeAttachment: "{{name}} を削除",
    removeReference: "{{name}} の参照を削除",
  },
  settings: {
    title: "設定",
    workspaceTitle: "ワークスペース",
    workspaceDescription:
      "チームメンバー、組織アクセス、共有ワークスペース設定を管理します。",
    openTeamSettings: "チーム設定を開く",
    openResourceSettings: "リソース設定を開く",
    agentTitle: "エージェントを管理",
    agentDescription:
      "エージェントのモデル、API キー、自動化、音声などを管理します。",
    openAgentSettings: "エージェントを管理",
  },
  chat: {
    archiveChat: "チャットをアーカイブ",
    archiveFailed: "チャットをアーカイブできませんでした。",
    chats: "チャット",
    composerPlaceholder: "何でも聞いてください",
    emptyState: "何でも聞いてください",
    heroDescription: "このアプリの確認、説明、変更をエージェントに依頼します。",
    heroTitle: "どのようにお手伝いできますか？",
    inspectEmptyState: "このアプリについて何でも聞いてください",
    inspectSuggestionAction: "利用可能なアクションを表示",
    inspectSuggestionCapabilities: "このアプリで何ができますか？",
    inspectSuggestionHello: "使い始めを手伝って",
    newChat: "新しいチャット",
    optionsFor: "{{title}} のチャットオプション",
    pinChat: "チャットをピン留め",
    pinned: "ピン留め",
    recents: "最近",
    retryPreviousRequest:
      "モデルプロバイダーに接続できたので、前のリクエストを再試行してください。",
    invalidHandoffOptions:
      "プロンプトは下書きとして保存されましたが、チャット設定を復元できませんでした。再送信する前に、プロンプト、コンテキスト、モデルを確認してください。",
    recoveryDraftUnsaved:
      "下書きの変更は保存されていません。このチャットを再読み込みすると失われる可能性があります。",
    retryAttachmentUnavailable:
      "Chat ではこの添付ファイルを再試行のために開けません。アクセス可能なファイル URL を追加して、もう一度お試しください。",
    renameChat: "チャット名を変更",
    renameFailed: "チャット名を変更できませんでした。",
    renameThread: "{{title}} の名前を変更",
    suggestionActions: "利用可能なアクションを表示して",
    suggestionCapabilities: "このアプリで何ができますか？",
    suggestionCustomize: "このアプリのカスタマイズを手伝って",
    unpinChat: "チャットのピン留めを解除",
    untitledChat: "無題のチャット",
  },
  home: {
    communityTitle: "コミュニティ",
    docsAddAction: "アクションを追加",
    docsAddPage: "ページを追加",
    docsGettingStarted: "はじめに",
    docsKeyConcepts: "主要な概念",
    docsTitle: "ドキュメント",
    title: "はじめに",
  },
  navigation: {
    chat: "チャット",
    collapseSidebar: "サイドバーを折りたたむ",
    database: "データベース",
    expandSidebar: "サイドバーを展開",
    extensions: "拡張機能",
    home: "ホーム",
    navigation: "ナビゲーション",
    navigationDescription: "メインナビゲーション",
    observability: "可観測性",
    openNavigation: "ナビゲーションを開く",
    settings: "設定",
    team: "チーム",
  },
  pages: {
    databaseTitle: "データベース",
    observabilityPageTitle: "エージェント可観測性",
    teamTitle: "チーム",
    teamCreateOrgDescription:
      "チームメイトを招待してこのアプリを共有するための組織を作成します。",
  },
  root: {
    commandActions: "操作",
    commandAppearance: "外観",
    commandSearch: "検索",
    toggleTheme: "テーマを切り替え",
  },
};

export default messages;
