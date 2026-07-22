const messages = {
  intelligence: {
    title: "インテリジェンス",
    description:
      "制限された通話証拠の中で CRM が注目すべき場面を選択します。スマートトラッカーは Ask CRM を通じて評価され、この設定画面で直接実行されることはありません。",
    loading: "トラッカーを読み込んでいます…",
    kindKeyword: "キーワード",
    kindSmart: "スマート",
    enable: "有効にする",
    disable: "無効にする",
    toggleTracker: "{{name}}を{{action}}",
    emptyTitle: "シグナルトラッカーはまだありません",
    emptyDescription:
      "決定的な一致用のキーワード、または Ask CRM に確認させるスマート条件を追加します。",
    trackerDeleted: "トラッカーを削除しました。",
    trackerEnabled: "トラッカーを有効にしました。",
    trackerDisabled: "トラッカーを無効にしました。",
    trackerUpdateFailed: "トラッカーを更新できませんでした。",
    trackerCreated: "トラッカーを作成しました。",
    trackerCreationFailed: "トラッカーを作成できませんでした。",
    newTracker: "新しいトラッカー",
    createTitle: "シグナルトラッカーを作成",
    createDescription:
      "決定的なキーワードを追跡するか、Ask CRM が通話証拠に対して評価する制限付きスマート条件を定義します。",
    name: "名前",
    trackerDescription: "説明",
    detector: "検出器",
    keywords: "キーワード",
    keywordsPlaceholder: "価格、更新、セキュリティレビュー",
    keywordsHelp: "最大 40 個のキーワードをカンマで区切ります。",
    classificationCriterion: "分類条件",
    criterionPlaceholder: "導入時期に関する明確な懸念を検出します。",
    creating: "作成中…",
    create: "トラッカーを作成",
    deleteTrackerAria: "{{name}}を削除",
    deleteTrackerTitle: "{{name}}を削除しますか？",
    deleteTrackerDescription:
      "今後のシグナル実行ではこのトラッカーを使用しなくなります。既存の確認済みシグナルは変更されません。",
    cancel: "キャンセル",
    deleteTracker: "トラッカーを削除",
    keywordsSummary: "キーワード: {{keywords}}",
    noKeywordsConfigured: "キーワードが設定されていません。",
    evaluatedThroughAsk: "Ask CRM を通じて評価されます。",
  },
  recordActions: {
    evidenceAttached: "通話証拠を添付しました。",
    evidenceAttachFailed: "証拠を添付できませんでした。",
    addEvidence: "証拠を追加",
    attachEvidenceTitle: "Clips の証拠を添付",
    attachEvidenceDescription:
      "永続的な Clips ページリンクを使用してください。CRM に保存されるのはアーティファクト参照、ページ URL、制限付きの抜粋のみで、メディアや文字起こしは保存されません。",
    artifactId: "アーティファクト ID",
    clipsUrl: "Clips の URL",
    summary: "要約",
    shortExcerpt: "短い抜粋",
    attachEvidence: "証拠を添付",
    automate: "自動化",
    reviewNewClipsCalls: "新しい Clips 通話を確認",
    reviewDescription:
      "Clips のメディアや文字起こしをコピーせず、この CRM レコードの確認レシピを準備します。",
    disabledAutomationDescription:
      "これは無効な状態で開始し、{{name}} に紐付きます。明示的に有効にすると、新しいクリップはアクセス確認済みの録画ページ参照だけをこのレコードに添付できます。",
    handoffDescription:
      "引き継ぎで保持するのは不透明なクリップ ID、永続的な {{path}} ページ URL、キャプチャ時刻だけです。イベント URL、メディア、アクセストークン、文字起こし、推測されたレコード、プロバイダーへの書き込みは拒否されます。",
    manageAutomations: "自動化を管理",
    configureWithAgent: "エージェントで設定",
  },
  dashboard: {
    metaTitle: "パイプライン · CRM",
    pipeline: "パイプライン",
    ready: "パイプラインダッシュボードの準備ができました。",
    installFailed: "パイプラインダッシュボードをインストールできませんでした。",
    loadingDescription:
      "アクセス範囲に応じたパイプラインダッシュボードを読み込んでいます…",
    emptyDescription:
      "ステージ別の商談価値を、権限を考慮してリアルタイムに表示します。",
    installTitle: "パイプラインダッシュボードをインストール",
    installDescription:
      "現在のワークスペース用に CRM 所有のデータプログラムと非公開ダッシュボードを作成します。",
    installAction: "パイプラインダッシュボードをインストール",
    liveDescription:
      "ライブの商談合計は現在の閲覧者の CRM アクセス権を使用し、キャッシュされたデータプログラムから更新されます。",
    updating: "更新中…",
    updatePack: "パックを更新",
  },
};

export default messages;
