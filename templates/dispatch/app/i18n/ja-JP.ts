import { messagesByLocale } from "../i18n-data";

const messages = messagesByLocale["ja-JP"];

export default {
  ...messages,
  dispatch: {
    ...messages.dispatch,
    pages: {
      ...messages.dispatch.pages,
      suggestionCreateAppOperation: "このワークスペースにアプリを作成",
      suggestionCustomizeOperation: "カスタマイズ",
      reviewActionSuggestionLabel: "「{{label}}」を確認",
      dismissActionSuggestion: "「{{label}}」を閉じる",
      reviewActionSuggestionTitle: "提案された操作を確認",
      cancelActionSuggestion: "キャンセル",
      runActionSuggestion: "操作を実行",
      suggestionNullValue: "なし",
      suggestionYesValue: "はい",
      suggestionNoValue: "いいえ",
      suggestionActionLabel: "アクション",
      suggestionAppLabel: "アプリ",
      openExistingApp: "アプリを開く",
      openInBuilder: "Builder で開く",
      actionSuggestionAccepted: "提案を受け付けました。",
      actionSuggestionContinueInCode: "Code で続行してください。",
      reviewActionSuggestionApproval: "承認リクエストを確認",
      actionSuggestionApprovalRequired: "この操作には承認が必要です。",
      actionSuggestionUnconfirmed:
        "提案された操作の結果を確認できませんでした。再試行する前にアプリを確認してください。",
    },
  },
};
