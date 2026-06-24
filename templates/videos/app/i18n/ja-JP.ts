const messages = {
  root: {
    commandVideos: "動画",
    searchCompositions: "コンポジションを検索",
    commandAppearance: "外観",
    toggleTheme: "テーマを切り替え",
  },
  header: {
    videos: "動画",
    components: "コンポーネント",
    designSystems: "デザインシステム",
    team: "チーム",
    settings: "設定",
    extensions: "拡張機能",
    newComposition: "新しいコンポジション",
    studio: "スタジオ",
  },
  navigation: {
    settings: "設定",
    brand: "Videos",
    animations: "アニメーション",
    components: "コンポーネント",
    designSystems: "デザインシステム",
    team: "チーム",
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
    emptyState: "動画について何でも聞いてください",
    suggestionLogo: "Acme のロゴリビールを作成",
    suggestionZoom: "このシーンにカメラズームを追加",
    suggestionSlow: "イントロアニメーションを遅くする",
  },
  sidebar: {
    navigation: "ナビゲーション",
    openNavigation: "ナビゲーションを開く",
  },
  studio: {
    closeSidebar: "サイドバーを閉じる",
    openSidebar: "サイドバーを開く",
    share: "共有",
    shareVideos: "動画を共有",
    shareVideosDescription:
      "動画を共有またはエクスポートするには、クラウドデータベースを接続して、どこからでもコンポジションにアクセスできるようにします。",
    compositions: "コンポジション",
    properties: "プロパティ",
  },
  newComposition: {
    runFailed: "コンポジション作成前にエージェント実行が失敗しました。",
    readFailed: "添付ファイルを読み取れませんでした。",
    startFailed: "コンポジションリクエストを開始できませんでした。",
    button: "新しいコンポジション",
    title: "新しいコンポジション",
    description: "作成したい動画を説明してください",
    placeholder: "作成したい動画を説明してください...",
    timedOut:
      "The composition request timed out. Please try again from the sidebar.",
    generating: "Generating...",
  },
  notFound: {
    message: "This page doesn't exist yet. Continue prompting to build it out.",
    backToStudio: "Back to Studio",
  },
  designSystems: {
    new: "New Design System",
    setupBrand: "Set up your brand",
    emptyTitle: "Set up your brand identity",
    emptyDescription:
      "Create a design system with your brand colors, typography, and logos. Every new composition will follow your visual identity.",
  },
};

export default messages;
