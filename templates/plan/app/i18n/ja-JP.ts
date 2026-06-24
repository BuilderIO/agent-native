const messages = {
  root: {
    commandActions: "アクション",
    askPlan: "Plan に質問",
    openPlans: "計画を開く",
    openRecaps: "要約を開く",
    commandAppearance: "外観",
    toggleTheme: "テーマを切り替え",
  },
  header: {
    plan: "Plan",
    settings: "設定",
    team: "チーム",
    extensions: "拡張機能",
  },
  navigation: {
    settings: "設定",
    ask: "質問",
    plan: "計画",
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
    emptyState:
      "Plan エージェントに、マージ済み PR の要約検索、このドキュメントの確認、図の追加、コード質問へのビジュアルプランでの回答を依頼できます。",
    suggestionShipped: "先週リリースされた内容は？",
    suggestionUi: "この UI はどのように見えますか？",
    suggestionApi: "この API の形は？",
  },
  sidebar: {
    openNavigation: "ナビゲーションを開く",
    navigation: "ナビゲーション",
    navigationDescription: "アプリのナビゲーションリンク",
    chats: "チャット",
    newPlanChat: "新しい Plan チャット",
    newChat: "新しいチャット",
    renameChat: "チャット名を変更",
    unpinChat: "チャットの固定を解除",
    pinChat: "チャットを固定",
    archiveChat: "チャットをアーカイブ",
    planSection: "計画",
    newPlan: "新しい計画",
    signInCreatePlan: "計画を作成するにはサインイン",
    signInToCreate: "作成するにはサインイン",
    signInKeepPlans: "サインインすると計画を作成して保存できます。",
    noPlans: "まだ計画はありません。",
    recapBadge: "要約",
    viewAllPlans: "すべての計画を表示...",
    brandingSentLocal:
      "ブランド変更リクエストをローカルコードエージェントに送信しました",
    brandingSent: "ブランド変更リクエストをコードエージェントに送信しました",
    customizePlanBranding: "Plan のブランドをカスタマイズ",
    customizeBranding: "ブランドをカスタマイズ",
    customizeBrandingDescription:
      "Plan 全体に反映するブランド変更を説明します。",
    customizeBrandingPlaceholder:
      "ロゴを使う、アプリ名を変える、色を更新する...",
    expandSidebar: "サイドバーを展開",
    collapseSidebar: "サイドバーを折りたたむ",
    signIn: "サインイン",
  },
  chat: {
    suggestionShipped: "この1週間で何がリリースされましたか？",
    suggestionUi: "新しいチェックアウトUIはどのような見た目ですか？",
    suggestionAuth: "認証APIはいつ変更されましたか？",
    suggestionApi: "課金APIの構造はどうなっていますか？",
    emptyState: "Plan に質問",
    placeholder: "出荷内容、変更点、現在のコードの状態を質問...",
    heading: "Plan に質問",
    description:
      "マージ済み PR の要約を検索し、ビジュアルブロックを確認し、コード回答を図、ワイヤーフレーム、API 仕様、データモデルとして公開します。",
  },
  guest: {
    banner:
      "ゲストとして閲覧しています。サインインすると、プランの作成、コメント、作業の保存ができます。",
    signIn: "サインイン",
  },
};

export default messages;
