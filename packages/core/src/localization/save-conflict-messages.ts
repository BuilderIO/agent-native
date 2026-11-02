import {
  DEFAULT_LOCALE,
  isLocaleCode,
  type BuiltinLocaleCode,
  type LocaleCode,
} from "./shared.js";

export interface SaveConflictMessages {
  title: string;
  description: string;
  changedByBoth: string;
  keepMine: string;
  useTheirs: string;
  keptMine: string;
  usedTheirs: string;
  getOtherBack: string;
  dismiss: string;
  notSaved: string;
}

export const SAVE_CONFLICT_MESSAGES: Record<
  BuiltinLocaleCode,
  SaveConflictMessages
> = {
  "en-US": {
    title: "Someone else changed this too",
    description:
      "You and another editor changed the same thing. Everything else is already combined. Choose which version to keep. You can get the other one back right after.",
    changedByBoth: "Changed by both: {{fields}}",
    keepMine: "Keep mine",
    useTheirs: "Use theirs",
    keptMine: "Kept your version.",
    usedTheirs: "Using the other version.",
    getOtherBack: "Get the other version back",
    dismiss: "Dismiss",
    notSaved:
      "Your last change wasn't saved because someone else changed the same thing. Open it again to redo it.",
  },
  "es-ES": {
    title: "Otra persona también ha cambiado esto",
    description:
      "Tú y otro editor habéis cambiado lo mismo. Todo lo demás ya está combinado. Elige qué versión conservar. Justo después podrás recuperar la otra.",
    changedByBoth: "Cambiado por ambos: {{fields}}",
    keepMine: "Conservar la mía",
    useTheirs: "Usar la suya",
    keptMine: "Se ha conservado tu versión.",
    usedTheirs: "Se está usando la otra versión.",
    getOtherBack: "Recuperar la otra versión",
    dismiss: "Descartar",
    notSaved:
      "Tu último cambio no se ha guardado porque otra persona ha cambiado lo mismo. Vuelve a abrirlo para rehacerlo.",
  },
  "fr-FR": {
    title: "Quelqu'un d'autre a aussi modifié ceci",
    description:
      "Un autre éditeur et vous avez modifié le même élément. Tout le reste est déjà combiné. Choisissez la version à conserver. Vous pourrez récupérer l'autre juste après.",
    changedByBoth: "Modifié par les deux : {{fields}}",
    keepMine: "Garder la mienne",
    useTheirs: "Utiliser la sienne",
    keptMine: "Votre version a été conservée.",
    usedTheirs: "L'autre version est utilisée.",
    getOtherBack: "Récupérer l'autre version",
    dismiss: "Ignorer",
    notSaved:
      "Votre dernière modification n'a pas été enregistrée, car quelqu'un d'autre a modifié le même élément. Rouvrez-le pour la refaire.",
  },
  "de-DE": {
    title: "Jemand anderes hat dies ebenfalls geändert",
    description:
      "Du und eine andere bearbeitende Person habt dasselbe geändert. Alles andere ist bereits zusammengeführt. Wähle, welche Version du behalten möchtest. Die andere kannst du direkt danach zurückholen.",
    changedByBoth: "Von beiden geändert: {{fields}}",
    keepMine: "Meine behalten",
    useTheirs: "Die andere verwenden",
    keptMine: "Deine Version wurde behalten.",
    usedTheirs: "Die andere Version wird verwendet.",
    getOtherBack: "Andere Version zurückholen",
    dismiss: "Schließen",
    notSaved:
      "Deine letzte Änderung wurde nicht gespeichert, weil jemand anderes dasselbe geändert hat. Öffne es erneut, um sie zu wiederholen.",
  },
  "pt-BR": {
    title: "Outra pessoa também alterou isto",
    description:
      "Você e outro editor alteraram a mesma coisa. Todo o resto já foi combinado. Escolha qual versão manter. Você pode recuperar a outra logo em seguida.",
    changedByBoth: "Alterado por ambos: {{fields}}",
    keepMine: "Manter a minha",
    useTheirs: "Usar a outra",
    keptMine: "Sua versão foi mantida.",
    usedTheirs: "Usando a outra versão.",
    getOtherBack: "Recuperar a outra versão",
    dismiss: "Dispensar",
    notSaved:
      "Sua última alteração não foi salva porque outra pessoa alterou a mesma coisa. Abra novamente para refazê-la.",
  },
  "zh-CN": {
    title: "其他人也更改了此内容",
    description:
      "你和另一位编辑者更改了同一处内容。其余内容已合并。请选择要保留的版本。之后你可以立即找回另一个版本。",
    changedByBoth: "双方都更改了：{{fields}}",
    keepMine: "保留我的",
    useTheirs: "使用对方的",
    keptMine: "已保留你的版本。",
    usedTheirs: "正在使用另一个版本。",
    getOtherBack: "找回另一个版本",
    dismiss: "关闭",
    notSaved:
      "你的上一次更改未保存,因为其他人更改了同一处内容。请重新打开后再改一次。",
  },
  "zh-TW": {
    title: "其他人也變更了此內容",
    description:
      "你和另一位編輯者變更了同一處內容。其餘內容已合併。請選擇要保留的版本。之後你可以立即取回另一個版本。",
    changedByBoth: "雙方都變更了：{{fields}}",
    keepMine: "保留我的",
    useTheirs: "使用對方的",
    keptMine: "已保留你的版本。",
    usedTheirs: "正在使用另一個版本。",
    getOtherBack: "取回另一個版本",
    dismiss: "關閉",
    notSaved:
      "你上一次的變更未儲存,因為其他人變更了同一處內容。請重新開啟後再改一次。",
  },
  "ja-JP": {
    title: "他の人もこの内容を変更しました",
    description:
      "あなたと別の編集者が同じ箇所を変更しました。それ以外はすでに統合されています。残すバージョンを選んでください。もう一方はこの直後に元に戻せます。",
    changedByBoth: "両方が変更: {{fields}}",
    keepMine: "自分の変更を残す",
    useTheirs: "相手の変更を使う",
    keptMine: "あなたのバージョンを残しました。",
    usedTheirs: "もう一方のバージョンを使用しています。",
    getOtherBack: "もう一方のバージョンに戻す",
    dismiss: "閉じる",
    notSaved:
      "他の人が同じ箇所を変更したため、直前の変更は保存されませんでした。もう一度開いてやり直してください。",
  },
  "ko-KR": {
    title: "다른 사람도 이 내용을 변경했습니다",
    description:
      "회원님과 다른 편집자가 같은 부분을 변경했습니다. 나머지는 이미 합쳐졌습니다. 유지할 버전을 선택하세요. 다른 버전은 바로 이어서 되돌릴 수 있습니다.",
    changedByBoth: "양쪽 모두 변경: {{fields}}",
    keepMine: "내 버전 유지",
    useTheirs: "상대 버전 사용",
    keptMine: "회원님의 버전을 유지했습니다.",
    usedTheirs: "다른 버전을 사용 중입니다.",
    getOtherBack: "다른 버전 되돌리기",
    dismiss: "닫기",
    notSaved:
      "다른 사람이 같은 항목을 변경해 마지막 변경 내용이 저장되지 않았습니다. 다시 열어 변경해 주세요.",
  },
  "hi-IN": {
    title: "किसी और ने भी इसे बदला है",
    description:
      "आपने और किसी अन्य संपादक ने एक ही चीज़ बदली है। बाकी सब पहले ही जोड़ दिया गया है। चुनें कि कौन-सा संस्करण रखना है। दूसरा संस्करण आप उसके तुरंत बाद वापस पा सकते हैं।",
    changedByBoth: "दोनों ने बदला: {{fields}}",
    keepMine: "मेरा रखें",
    useTheirs: "उनका उपयोग करें",
    keptMine: "आपका संस्करण रखा गया।",
    usedTheirs: "दूसरे संस्करण का उपयोग हो रहा है।",
    getOtherBack: "दूसरा संस्करण वापस पाएँ",
    dismiss: "खारिज करें",
    notSaved:
      "आपका पिछला बदलाव सहेजा नहीं गया, क्योंकि किसी और ने वही चीज़ बदली है। इसे फिर से खोलकर दोबारा बदलें।",
  },
  "ar-SA": {
    title: "غيّر شخص آخر هذا أيضًا",
    description:
      "لقد غيّرت أنت ومحرر آخر الشيء نفسه. تم دمج كل ما عدا ذلك. اختر النسخة التي تريد الاحتفاظ بها. يمكنك استعادة النسخة الأخرى بعد ذلك مباشرة.",
    changedByBoth: "غيّره الطرفان: {{fields}}",
    keepMine: "الاحتفاظ بنسختي",
    useTheirs: "استخدام نسختهم",
    keptMine: "تم الاحتفاظ بنسختك.",
    usedTheirs: "يتم استخدام النسخة الأخرى.",
    getOtherBack: "استعادة النسخة الأخرى",
    dismiss: "إغلاق",
    notSaved:
      "لم يتم حفظ تغييرك الأخير لأن شخصًا آخر غيّر الشيء نفسه. افتحه مرة أخرى لإعادة التغيير.",
  },
};

export function saveConflictMessagesForLocale(
  locale: LocaleCode,
): SaveConflictMessages {
  return SAVE_CONFLICT_MESSAGES[isLocaleCode(locale) ? locale : DEFAULT_LOCALE];
}
