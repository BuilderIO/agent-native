import { useState, useRef, useCallback, useEffect } from "react";
import {
  IconMicrophone,
  IconMicrophoneOff,
  IconLoader2,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  sendToAgentChat,
  useAgentChatGenerating,
} from "@agent-native/core/client";

interface VoiceDictationProps {
  currentDate: Date;
}

type VoiceState = "idle" | "listening" | "processing";

export function VoiceDictation({ currentDate }: VoiceDictationProps) {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef<any>(null);
  const isProcessingRef = useRef(false);

  const isSupported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window ||
      "webkitSpeechRecognition" in (window as any));

  const [isGenerating] = useAgentChatGenerating();

  // When agent finishes processing a voice command, go back to idle
  useEffect(() => {
    if (state === "processing" && !isGenerating) {
      setState("idle");
      setTranscript("");
    }
  }, [isGenerating, state]);

  // Track sidebar open state to shift mic button out of the way
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useEffect(() => {
    const check = () => {
      // Small delay so the sidebar has time to render/unmount
      requestAnimationFrame(() => {
        const panel = document.querySelector(".agent-sidebar-panel");
        setSidebarOpen(!!panel && panel.getBoundingClientRect().width > 0);
      });
    };
    check();
    window.addEventListener("agent-panel:toggle", check);
    window.addEventListener("agent-panel:open", check);
    return () => {
      window.removeEventListener("agent-panel:toggle", check);
      window.removeEventListener("agent-panel:open", check);
    };
  }, []);

  const processCommand = useCallback((text: string) => {
    setState("processing");
    sendToAgentChat({ message: text, submit: true });
    // Timeout fallback in case the chatRunning event never fires
    setTimeout(() => {
      setState((s) => (s === "processing" ? "idle" : s));
      setTranscript("");
    }, 30000);
  }, []);

  const startListening = useCallback(() => {
    if (!isSupported) {
      toast.error("Voice dictation is not supported in your browser");
      return;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
      recognitionRef.current = null;
    }

    isProcessingRef.current = false;
    setState("listening");
    setTranscript("");

    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    const recognition: any = new SpeechRecognitionCtor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setState("listening");

    recognition.onresult = (event: any) => {
      const current = event.resultIndex;
      const result = event.results[current];
      const transcriptText = result[0].transcript;
      setTranscript(transcriptText);

      if (result.isFinal && !isProcessingRef.current) {
        isProcessingRef.current = true;
        try {
          recognition.stop();
        } catch {}
        processCommand(transcriptText);
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      if (!isProcessingRef.current) {
        setState("idle");
        setTranscript("");
      }
      if (event.error === "not-allowed") {
        toast.error("Microphone access denied", {
          description: "Please allow microphone access",
        });
      } else if (event.error === "no-speech") {
        toast.error("No speech detected", {
          description: "Please try again",
        });
      } else if (event.error !== "aborted") {
        toast.error("Could not capture audio");
      }
    };

    recognition.onend = () => {
      if (!isProcessingRef.current) setState("idle");
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setState("idle");
      toast.error("Could not start voice recognition");
    }
  }, [isSupported, processCommand]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
    setState("idle");
  }, []);

  const handleClick = useCallback(() => {
    if (state === "idle") startListening();
    else if (state === "listening") stopListening();
  }, [state, startListening, stopListening]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) recognitionRef.current.abort();
    };
  }, []);

  if (!isSupported) return null;

  return (
    <div
      className={cn(
        "fixed bottom-6 left-1/2 -translate-x-1/2 md:left-auto md:translate-x-0 z-50 flex flex-col items-center gap-2 transition-[right] duration-300",
        sidebarOpen ? "md:right-[400px]" : "md:right-6",
      )}
    >
      {(state === "listening" || state === "processing") && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="bg-card/95 backdrop-blur-xl border border-white/10 rounded-2xl px-4 py-3 shadow-2xl max-w-[300px] md:max-w-[250px]">
            <div className="flex items-center gap-2">
              {state === "listening" ? (
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse delay-75" />
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse delay-150" />
                </div>
              ) : (
                <IconLoader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
              )}
              <span className="text-sm text-muted-foreground truncate">
                {state === "processing"
                  ? `"${transcript}"`
                  : transcript || "Listening..."}
              </span>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={handleClick}
        disabled={state === "processing"}
        className={cn(
          "relative flex items-center justify-center",
          "w-16 h-16 md:w-12 md:h-12 rounded-full",
          "shadow-2xl shadow-black/50",
          "transition-all duration-300 ease-out",
          "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background",
          state === "idle" &&
            "bg-gradient-to-br from-primary to-primary/80 hover:scale-105 active:scale-95",
          state === "listening" &&
            "bg-gradient-to-br from-red-500 to-red-600 scale-110",
          state === "processing" &&
            "bg-gradient-to-br from-primary/50 to-primary/30 cursor-wait",
        )}
      >
        {state === "listening" && (
          <>
            <span className="absolute inset-0 rounded-full bg-red-500/30 animate-ping" />
            <span className="absolute inset-[-4px] rounded-full border-2 border-red-500/50 animate-pulse" />
          </>
        )}
        {state === "idle" && (
          <IconMicrophone className="h-7 w-7 md:h-5 md:w-5 text-primary-foreground" />
        )}
        {state === "listening" && (
          <IconMicrophoneOff className="h-7 w-7 md:h-5 md:w-5 text-white" />
        )}
        {state === "processing" && (
          <IconLoader2 className="h-7 w-7 md:h-5 md:w-5 text-primary-foreground animate-spin" />
        )}
      </button>

      {state === "idle" && (
        <p className="text-xs text-muted-foreground/60 text-center animate-in fade-in duration-500 md:hidden">
          Tap to speak
        </p>
      )}
    </div>
  );
}
