import type { BuiltinLocaleCode } from "@agent-native/core/client/i18n";

const en = {
  autoDelete: "Pages in Trash for over {{days}} days are deleted automatically",
  autoDeleteStarting:
    "Starting {{date}}, Pages in Trash for over {{days}} days are deleted automatically",
} as const;

type TrashRetentionMessages = Record<keyof typeof en, string>;

const translations: Record<
  Exclude<BuiltinLocaleCode, "en-US">,
  TrashRetentionMessages
> = {
  "es-ES": {
    autoDelete:
      "Las páginas que llevan más de {{days}} días en la papelera se eliminan automáticamente",
    autoDeleteStarting:
      "A partir del {{date}}, las páginas que llevan más de {{days}} días en la papelera se eliminan automáticamente",
  },
  "fr-FR": {
    autoDelete:
      "Les pages dans la corbeille depuis plus de {{days}} jours sont supprimées automatiquement",
    autoDeleteStarting:
      "À partir du {{date}}, les pages dans la corbeille depuis plus de {{days}} jours sont supprimées automatiquement",
  },
  "de-DE": {
    autoDelete:
      "Seiten, die länger als {{days}} Tage im Papierkorb liegen, werden automatisch gelöscht",
    autoDeleteStarting:
      "Ab dem {{date}} werden Seiten, die länger als {{days}} Tage im Papierkorb liegen, automatisch gelöscht",
  },
  "pt-BR": {
    autoDelete:
      "Páginas na lixeira há mais de {{days}} dias são excluídas automaticamente",
    autoDeleteStarting:
      "A partir de {{date}}, páginas na lixeira há mais de {{days}} dias são excluídas automaticamente",
  },
  "zh-CN": {
    autoDelete: "在回收站中超过 {{days}} 天的页面会被自动删除",
    autoDeleteStarting:
      "自 {{date}} 起，在回收站中超过 {{days}} 天的页面会被自动删除",
  },
  "zh-TW": {
    autoDelete: "在垃圾桶中超過 {{days}} 天的頁面會自動刪除",
    autoDeleteStarting:
      "自 {{date}} 起，在垃圾桶中超過 {{days}} 天的頁面會自動刪除",
  },
  "ja-JP": {
    autoDelete:
      "ゴミ箱に入れてから {{days}} 日を過ぎたページは自動的に削除されます",
    autoDeleteStarting:
      "{{date}} 以降、ゴミ箱に入れてから {{days}} 日を過ぎたページは自動的に削除されます",
  },
  "ko-KR": {
    autoDelete: "휴지통에 {{days}}일 넘게 있던 페이지는 자동으로 삭제됩니다",
    autoDeleteStarting:
      "{{date}}부터 휴지통에 {{days}}일 넘게 있던 페이지는 자동으로 삭제됩니다",
  },
  "hi-IN": {
    autoDelete: "ट्रैश में {{days}} दिन से ज़्यादा समय से रखे पेज अपने आप हटा दिए जाते हैं",
    autoDeleteStarting:
      "{{date}} से, ट्रैश में {{days}} दिन से ज़्यादा समय से रखे पेज अपने आप हटा दिए जाएँगे",
  },
  "ar-SA": {
    autoDelete:
      "تُحذف الصفحات الموجودة في المهملات منذ أكثر من {{days}} يومًا تلقائيًا",
    autoDeleteStarting:
      "بدءًا من {{date}}، تُحذف الصفحات الموجودة في المهملات منذ أكثر من {{days}} يومًا تلقائيًا",
  },
};

export const trashRetentionMessagesByLocale: Record<
  BuiltinLocaleCode,
  TrashRetentionMessages
> = {
  "en-US": en,
  ...translations,
};
