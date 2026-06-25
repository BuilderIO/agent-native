const messages = {
  root: {
    commandActions: "操作",
    search: "検索",
    appearance: "表示",
    toggleTheme: "テーマを切り替え",
  },
  header: {
    entry: "記録",
    analytics: "分析",
    settings: "設定",
    extensions: "拡張機能",
    macros: "Macros",
  },
  navigation: {
    brand: "Macros",
    entry: "記録",
    analytics: "分析",
    settings: "設定",
  },
  settings: {
    title: "設定",
    description: "このアプリの言語とワークスペース設定。",
    languageTitle: "言語",
    languageDescription:
      "インターフェース言語を選択します。この設定はアカウントに保存されます。",
    languageLabel: "インターフェース言語",
    workspaceTitle: "ワークスペース",
    workspaceDescription:
      "チームメンバー、組織アクセス、共有ワークスペース設定を管理します。",
    openTeamSettings: "チーム設定を開く",
    openResourceSettings: "リソース設定を開く",
    agentTitle: "エージェント設定",
    agentDescription:
      "右サイドバーのエージェント設定を開き、モデル、API キー、自動化、音声などを管理します。",
    openAgentSettings: "エージェント設定を開く",
  },
  agent: {
    emptyState: "食べたものを教えてください。マクロを見積もります",
    suggestionLunch: "昼食にチキンブリトーボウル",
    suggestionMacros: "今日のマクロは？",
    suggestionRun: "今朝 30 分走りました",
  },
  sidebar: {
    openMenu: "メニューを開く",
    navigation: "ナビゲーション",
    expandLeftSidebar: "左サイドバーを展開",
    collapseLeftSidebar: "左サイドバーを折りたたむ",
    expand: "サイドバーを展開",
    collapse: "サイドバーを折りたたむ",
    syncing: "同期中…",
  },
  analytics: {
    selectRange: "範囲を選択",
    lastDays: "過去{{count}}日",
    allTime: "全期間",
    average: "平均",
    lowest: "最低",
    highest: "最高",
    daysTracked: "記録日数",
    daysUnit: "日",
    net: "差し引き",
    consumed: "摂取",
    burned: "消費",
    noData: "まだデータがありません",
    current: "現在",
    change: "変化",
    trendView: "トレンド表示",
    actualWeight: "実測体重",
    trendDescription:
      "青いトレンド線は日々の変動をならし、全体の進捗を示します。",
    noWeightData: "まだ体重データがありません",
    noWeightDescription: "体重を記録し始めるとトレンドが表示されます",
  },
};

export default messages;
