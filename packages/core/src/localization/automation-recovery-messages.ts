import {
  DEFAULT_LOCALE,
  isLocaleCode,
  type BuiltinLocaleCode,
  type LocaleCode,
} from "./shared.js";

interface AutomationRecoveryMessages {
  disabled: string;
  deliveryUnknown: string;
  leaseLost: string;
  stopped: string;
  confirmed: string;
  unknown: string;
  unreadable: string;
  missingPrompt: string;
  historyUnavailable: string;
}

export const AUTOMATION_RECOVERY_MESSAGES: Record<
  BuiltinLocaleCode,
  AutomationRecoveryMessages
> = {
  "en-US": {
    disabled: "Recovery stopped because this automation is disabled.",
    historyUnavailable:
      "The interrupted automation’s run history is missing or no longer matches this automation. Recovery stopped to avoid repeating completed steps.",
    deliveryUnknown:
      "The agent finished, but response delivery is unknown. The response was not resent to avoid duplicate delivery.",
    leaseLost:
      "The automation scheduler lost its execution lease. Unfinished work remains recoverable.",
    missingPrompt:
      "The interrupted automation’s original instructions could not be read. Recovery stopped to avoid repeating completed steps.",
    stopped: "Worker stopped before the automation finished.",
    confirmed:
      "Completed steps confirmed by the run journal: {{tools}}. Unfinished steps were not confirmed.",
    unknown:
      "Delivery outcome is unknown; no completed side effect was recorded in the run journal.",
    unreadable:
      "Delivery outcome is unknown because the run journal could not be read.",
  },
  "zh-CN": {
    disabled: "此自动化已禁用，因此恢复已停止。",
    historyUnavailable:
      "中断的自动化的运行历史缺失或已不再与此自动化匹配。为避免重复已完成的步骤，恢复已停止。",
    deliveryUnknown:
      "代理已完成，但响应的交付结果未知。为避免重复交付，未重新发送响应。",
    leaseLost: "自动化调度器失去了执行租约。未完成的工作仍可恢复。",
    missingPrompt:
      "无法读取中断的自动化的原始指令。为避免重复已完成的步骤，恢复已停止。",
    stopped: "工作进程在自动化完成前停止。",
    confirmed: "运行日志已确认完成的步骤：{{tools}}。未完成的步骤尚未确认。",
    unknown: "交付结果未知；运行日志中没有已完成副作用的记录。",
    unreadable: "无法读取运行日志，因此交付结果未知。",
  },
  "zh-TW": {
    disabled: "此自動化已停用，因此復原已停止。",
    historyUnavailable:
      "中斷的自動化執行歷史遺失或已不再與此自動化相符。為避免重複已完成的步驟，復原已停止。",
    deliveryUnknown:
      "代理已完成，但回應的交付結果未知。為避免重複交付，未重新傳送回應。",
    leaseLost: "自動化排程器失去了執行租約。未完成的工作仍可復原。",
    missingPrompt:
      "無法讀取中斷的自動化的原始指令。為避免重複已完成的步驟，復原已停止。",
    stopped: "工作程序在自動化完成前停止。",
    confirmed: "執行日誌已確認完成的步驟：{{tools}}。未完成的步驟尚未確認。",
    unknown: "交付結果未知；執行日誌中沒有已完成副作用的紀錄。",
    unreadable: "無法讀取執行日誌，因此交付結果未知。",
  },
  "es-ES": {
    disabled:
      "La recuperación se detuvo porque esta automatización está desactivada.",
    historyUnavailable:
      "El historial de ejecución de la automatización interrumpida no está disponible o ya no corresponde a esta automatización. La recuperación se detuvo para evitar repetir los pasos completados.",
    deliveryUnknown:
      "El agente terminó, pero se desconoce si se entregó la respuesta. No se volvió a enviar para evitar una entrega duplicada.",
    leaseLost:
      "El programador de automatizaciones perdió su permiso temporal de ejecución. El trabajo pendiente aún se puede recuperar.",
    missingPrompt:
      "No se pudieron leer las instrucciones originales de la automatización interrumpida. La recuperación se detuvo para evitar repetir los pasos completados.",
    stopped: "El proceso se detuvo antes de que terminara la automatización.",
    confirmed:
      "Pasos completados confirmados por el registro de ejecución: {{tools}}. Los pasos pendientes no se confirmaron.",
    unknown:
      "El resultado de la entrega es desconocido; el registro de ejecución no contiene efectos completados.",
    unreadable:
      "El resultado de la entrega es desconocido porque no se pudo leer el registro de ejecución.",
  },
  "fr-FR": {
    disabled:
      "La reprise s’est arrêtée car cette automatisation est désactivée.",
    historyUnavailable:
      "L’historique d’exécution de l’automatisation interrompue est manquant ou ne correspond plus à cette automatisation. La reprise s’est arrêtée pour éviter de répéter les étapes terminées.",
    deliveryUnknown:
      "L’agent a terminé, mais la livraison de la réponse est inconnue. La réponse n’a pas été renvoyée afin d’éviter une livraison en double.",
    leaseLost:
      "Le planificateur d’automatisations a perdu son bail d’exécution. Le travail inachevé reste récupérable.",
    missingPrompt:
      "Les instructions originales de l’automatisation interrompue n’ont pas pu être lues. La reprise s’est arrêtée pour éviter de répéter les étapes terminées.",
    stopped: "Le processus s’est arrêté avant la fin de l’automatisation.",
    confirmed:
      "Étapes terminées confirmées par le journal d’exécution : {{tools}}. Les étapes inachevées n’ont pas été confirmées.",
    unknown:
      "Le résultat de la livraison est inconnu ; aucun effet terminé n’a été enregistré dans le journal d’exécution.",
    unreadable:
      "Le résultat de la livraison est inconnu car le journal d’exécution n’a pas pu être lu.",
  },
  "de-DE": {
    disabled:
      "Die Wiederaufnahme wurde beendet, weil diese Automatisierung deaktiviert ist.",
    historyUnavailable:
      "Der Ausführungsverlauf der unterbrochenen Automatisierung fehlt oder passt nicht mehr zu dieser Automatisierung. Die Wiederherstellung wurde gestoppt, um abgeschlossene Schritte nicht zu wiederholen.",
    deliveryUnknown:
      "Der Agent ist fertig, aber die Zustellung der Antwort ist unbekannt. Die Antwort wurde nicht erneut gesendet, um eine doppelte Zustellung zu vermeiden.",
    leaseLost:
      "Der Automatisierungsplaner hat seine Ausführungsberechtigung verloren. Unvollständige Arbeit kann weiterhin wiederhergestellt werden.",
    missingPrompt:
      "Die ursprünglichen Anweisungen der unterbrochenen Automatisierung konnten nicht gelesen werden. Die Wiederherstellung wurde gestoppt, um abgeschlossene Schritte nicht zu wiederholen.",
    stopped:
      "Der Prozess wurde gestoppt, bevor die Automatisierung abgeschlossen war.",
    confirmed:
      "Vom Ausführungsprotokoll bestätigte abgeschlossene Schritte: {{tools}}. Unvollständige Schritte wurden nicht bestätigt.",
    unknown:
      "Das Zustellungsergebnis ist unbekannt; im Ausführungsprotokoll wurde keine abgeschlossene Wirkung erfasst.",
    unreadable:
      "Das Zustellungsergebnis ist unbekannt, weil das Ausführungsprotokoll nicht gelesen werden konnte.",
  },
  "pt-BR": {
    disabled:
      "A recuperação foi interrompida porque esta automação está desativada.",
    historyUnavailable:
      "O histórico de execução da automação interrompida está ausente ou não corresponde mais a esta automação. A recuperação parou para evitar repetir etapas concluídas.",
    deliveryUnknown:
      "O agente terminou, mas não se sabe se a resposta foi entregue. A resposta não foi reenviada para evitar uma entrega duplicada.",
    leaseLost:
      "O agendador de automações perdeu sua permissão temporária de execução. O trabalho pendente ainda pode ser recuperado.",
    missingPrompt:
      "Não foi possível ler as instruções originais da automação interrompida. A recuperação parou para evitar repetir etapas concluídas.",
    stopped: "O processo parou antes de a automação terminar.",
    confirmed:
      "Etapas concluídas confirmadas pelo registro de execução: {{tools}}. As etapas pendentes não foram confirmadas.",
    unknown:
      "O resultado da entrega é desconhecido; nenhum efeito concluído foi registrado no registro de execução.",
    unreadable:
      "O resultado da entrega é desconhecido porque não foi possível ler o registro de execução.",
  },
  "ja-JP": {
    disabled: "この自動化が無効になっているため、復旧を停止しました。",
    historyUnavailable:
      "中断された自動化の実行履歴が見つからないか、この自動化と一致しなくなっています。完了した手順を繰り返さないよう、復旧を停止しました。",
    deliveryUnknown:
      "エージェントは完了しましたが、応答の配信結果は不明です。重複配信を避けるため、応答は再送していません。",
    leaseLost:
      "自動化スケジューラーの実行リースが失われました。未完了の作業は引き続き復旧できます。",
    missingPrompt:
      "中断された自動化の元の指示を読み取れませんでした。完了した手順を繰り返さないよう、復旧を停止しました。",
    stopped: "自動化が完了する前にワーカーが停止しました。",
    confirmed:
      "実行ログで完了が確認された手順：{{tools}}。未完了の手順は確認されていません。",
    unknown: "配信結果は不明です。実行ログに完了した副作用の記録がありません。",
    unreadable: "実行ログを読み取れなかったため、配信結果は不明です。",
  },
  "ko-KR": {
    disabled: "이 자동화가 비활성화되어 복구가 중지되었습니다.",
    historyUnavailable:
      "중단된 자동화의 실행 기록이 없거나 더 이상 이 자동화와 일치하지 않습니다. 완료된 단계를 반복하지 않도록 복구를 중지했습니다.",
    deliveryUnknown:
      "에이전트가 작업을 완료했지만 응답 전달 결과는 알 수 없습니다. 중복 전달을 피하기 위해 응답을 다시 보내지 않았습니다.",
    leaseLost:
      "자동화 스케줄러의 실행 임대가 만료되었습니다. 미완료 작업은 계속 복구할 수 있습니다.",
    missingPrompt:
      "중단된 자동화의 원래 지침을 읽을 수 없습니다. 완료된 단계를 반복하지 않도록 복구를 중지했습니다.",
    stopped: "자동화가 완료되기 전에 작업 프로세스가 중지되었습니다.",
    confirmed:
      "실행 기록에서 완료가 확인된 단계: {{tools}}. 미완료 단계는 확인되지 않았습니다.",
    unknown:
      "전달 결과를 알 수 없습니다. 실행 기록에 완료된 부수 효과가 기록되지 않았습니다.",
    unreadable: "실행 기록을 읽을 수 없어 전달 결과를 알 수 없습니다.",
  },
  "hi-IN": {
    disabled: "यह ऑटोमेशन अक्षम है, इसलिए पुनर्प्राप्ति रोक दी गई।",
    historyUnavailable:
      "रुके हुए ऑटोमेशन का रन इतिहास गायब है या अब इस ऑटोमेशन से मेल नहीं खाता। पूरे हो चुके चरण दोहराने से बचने के लिए रिकवरी रोक दी गई।",
    deliveryUnknown:
      "एजेंट का काम पूरा हो गया, लेकिन उत्तर की डिलीवरी का परिणाम अज्ञात है। दोहरी डिलीवरी से बचने के लिए उत्तर दोबारा नहीं भेजा गया।",
    leaseLost:
      "ऑटोमेशन शेड्यूलर की अस्थायी निष्पादन अनुमति समाप्त हो गई। अधूरा काम अब भी पुनर्प्राप्त किया जा सकता है।",
    missingPrompt:
      "रुके हुए ऑटोमेशन के मूल निर्देश पढ़े नहीं जा सके। पूरे हो चुके चरण दोहराने से बचने के लिए रिकवरी रोक दी गई।",
    stopped: "ऑटोमेशन पूरा होने से पहले वर्कर बंद हो गया।",
    confirmed:
      "रन जर्नल में पुष्टि किए गए पूरे चरण: {{tools}}। अधूरे चरणों की पुष्टि नहीं हुई।",
    unknown: "डिलीवरी का परिणाम अज्ञात है; रन जर्नल में कोई पूरा हुआ प्रभाव दर्ज नहीं है।",
    unreadable: "रन जर्नल पढ़ा नहीं जा सका, इसलिए डिलीवरी का परिणाम अज्ञात है।",
  },
  "ar-SA": {
    disabled: "توقفت الاستعادة لأن هذا التشغيل الآلي معطل.",
    historyUnavailable:
      "سجل تشغيل الأتمتة المتوقفة مفقود أو لم يعد مطابقًا لهذه الأتمتة. توقفت الاستعادة لتجنب تكرار الخطوات المكتملة.",
    deliveryUnknown:
      "انتهى الوكيل، لكن نتيجة تسليم الرد غير معروفة. لم يُعد إرسال الرد لتجنب التسليم المكرر.",
    leaseLost:
      "فقد مجدول الأتمتة إذن التنفيذ المؤقت. لا يزال العمل غير المكتمل قابلاً للاستعادة.",
    missingPrompt:
      "تعذرت قراءة التعليمات الأصلية للأتمتة المتوقفة. توقفت الاستعادة لتجنب تكرار الخطوات المكتملة.",
    stopped: "توقف العامل قبل اكتمال الأتمتة.",
    confirmed:
      "الخطوات المكتملة التي أكدها سجل التشغيل: {{tools}}. لم يتم تأكيد الخطوات غير المكتملة.",
    unknown: "نتيجة التسليم غير معروفة؛ لم يُسجَّل أي أثر مكتمل في سجل التشغيل.",
    unreadable: "نتيجة التسليم غير معروفة لأن سجل التشغيل تعذرت قراءته.",
  },
};

export function automationRecoveryMessagesForLocale(
  locale: LocaleCode = DEFAULT_LOCALE,
): AutomationRecoveryMessages {
  return AUTOMATION_RECOVERY_MESSAGES[
    isLocaleCode(locale) ? locale : DEFAULT_LOCALE
  ];
}
