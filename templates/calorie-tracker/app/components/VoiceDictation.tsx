import { useState, useRef, useCallback, useEffect } from "react";
import {
  IconMicrophone,
  IconMicrophoneOff,
  IconLoader2,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAgentChatGenerating } from "@agent-native/core/client";

interface VoiceDictationProps {
  currentDate: Date;
}

type VoiceState = "idle" | "listening" | "processing";

export function VoiceDictation({ currentDate }: VoiceDictationProps) {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef<any>(null);
  const isProcessingRef = useRef(false);
  const [isGenerating, sendToAgent] = useAgentChatGenerating();

  const isSupported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window ||
      "webkitSpeechRecognition" in (window as any));

  // Track sidebar width to shift mic button out of the way
  const [sidebarWidth, setSidebarWidth] = useState(0);
  useEffect(() => {
    const measure = () => {
      const panel = document.querySelector(".agent-sidebar-panel");
      const w = panel ? panel.getBoundingClientRect().width : 0;
      setSidebarWidth(w);
    };
    // Use ResizeObserver to react to sidebar resize drags
    const observer = new ResizeObserver(measure);
    const startObserving = () => {
      const panel = document.querySelector(".agent-sidebar-panel");
      if (panel) observer.observe(panel);
      else setSidebarWidth(0);
    };
    // Re-attach observer when sidebar opens/closes
    const onToggle = () => setTimeout(startObserving, 100);
    startObserving();
    window.addEventListener("agent-panel:toggle", onToggle);
    window.addEventListener("agent-panel:open", onToggle);
    return () => {
      observer.disconnect();
      window.removeEventListener("agent-panel:toggle", onToggle);
      window.removeEventListener("agent-panel:open", onToggle);
    };
  }, []);

  // When agent finishes generating, transition back to idle
  useEffect(() => {
    if (!isGenerating && state === "processing") {
      setState("idle");
      setTranscript("");
      toast.success("Done");
    }
  }, [isGenerating, state]);

  const processCommand = useCallback(
    (text: string) => {
      setState("processing");
      try {
        sendToAgent({ message: text, submit: true });
        // Timeout fallback: if sidebar is closed or event never fires,
        // don't leave the mic stuck in processing forever
        setTimeout(() => {
          setState((s) => (s === "processing" ? "idle" : s));
          setTranscript((t) => (t ? "" : t));
        }, 15000);
      } catch (error) {
        console.error("Error sending voice command:", error);
        toast.error("Failed to process voice command");
        setState("idle");
        setTranscript("");
      }
    },
    [sendToAgent],
  );

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

    recognition.onresult = (event) => {
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

    recognition.onerror = (event) => {
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
      className="fixed bottom-6 left-1/2 -translate-x-1/2 md:left-auto md:right-6 md:translate-x-0 z-50 flex flex-col items-center gap-2 transition-[right] duration-200"
      style={sidebarWidth > 0 ? { right: `${sidebarWidth + 24}px` } : undefined}
    >
      {(state === "listening" || state === "processing") && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="bg-card/95 backdrop-blur-xl border border-white/10 rounded-2xl px-4 py-3 shadow-2xl max-w-[300px] md:max-w-[250px]">
            {state === "listening" && (
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse delay-75" />
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse delay-150" />
                </div>
                <span className="text-sm text-muted-foreground">
                  {transcript || "Listening..."}
                </span>
              </div>
            )}
            {state === "processing" && (
              <div className="flex items-center gap-2">
                <IconLoader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">
                  Processing: &quot;{transcript}&quot;
                </span>
              </div>
            )}
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
            "bg-gradient-to-br from-muted to-muted/80 cursor-not-allowed",
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
          <IconLoader2 className="h-7 w-7 md:h-5 md:w-5 text-muted-foreground animate-spin" />
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
