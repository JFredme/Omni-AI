"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, SkipForward, X } from "lucide-react";
import { apiRequest, ClientApiError, isAbortError, streamTurn } from "@/lib/client/api";
import { SpeechDetector, VOICE_SYSTEM_PROMPT, encodeWav, takeSentences, toBase64, toSpeakable } from "@/lib/voice/speech";
import { cn } from "@/lib/utils";

type Phase = "starting" | "listening" | "hearing" | "thinking" | "speaking";
interface Line {
  who: "you" | "ai";
  text: string;
}
interface VoiceModelsResponse {
  tts: { id: string; voices: string[]; price: number; free: boolean }[];
  defaults: { stt: string | null; tts: string | null; voice: string | null };
}

const VOICE_KEY = "omni.voice.voice";
const PHASE_LABEL: Record<Phase, string> = { starting: "Getting ready…", listening: "Listening", hearing: "Listening…", thinking: "Thinking…", speaking: "Speaking" };

/** Plays the reply sentence by sentence while it is still being written. */
class Speaker {
  private tail: Promise<void> = Promise.resolve();
  private current: AudioBufferSourceNode | null = null;
  private stopped = false;
  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
    private readonly voice: () => string,
    private readonly signal: AbortSignal,
    private readonly callbacks: { onStart: () => void; onError: (message: string) => void },
  ) {}

  say(sentence: string) {
    const text = toSpeakable(sentence);
    if (!text || this.stopped) return;
    // Start fetching right away so the next sentence is ready by the time this one ends.
    const audio = fetch("/api/voice/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text.slice(0, 1400), voice: this.voice() || undefined }), signal: this.signal })
      .then(async (response) => {
        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(data?.error?.message ?? "Couldn't turn that into speech.");
        }
        return this.ctx.decodeAudioData(await response.arrayBuffer());
      })
      .catch((error: unknown) => {
        if (!isAbortError(error) && !this.stopped) this.callbacks.onError(error instanceof Error ? error.message : "Couldn't speak that.");
        return null;
      });
    this.tail = this.tail.then(async () => {
      const buffer = await audio;
      if (!buffer || this.stopped) return;
      await new Promise<void>((resolve) => {
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.out);
        source.onended = () => {
          if (this.current === source) this.current = null;
          resolve();
        };
        this.current = source;
        this.callbacks.onStart();
        source.start();
      });
    });
  }

  finished(): Promise<void> {
    return this.tail;
  }

  stop() {
    this.stopped = true;
    try {
      this.current?.stop();
    } catch {
      // Already finished.
    }
  }
}

function microphoneMessage(error: unknown): string {
  const name = (error as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "Omni can't use the microphone. Allow microphone access for this app in your system or browser settings, then try again.";
  if (name === "NotFoundError") return "No microphone was found.";
  return "Couldn't start the microphone.";
}

/** The full-screen voice conversation: it listens, replies out loud, and can be interrupted. */
export function VoiceMode({ modelId, onClose }: { modelId: string | null; onClose: (conversationId: string | null) => void }) {
  const [phase, setPhaseState] = useState<Phase>("starting");
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);
  const [voices, setVoices] = useState<string[]>([]);
  const [voice, setVoiceState] = useState("");
  const [models, setModels] = useState<{ stt: string | null; tts: string | null }>({ stt: null, tts: null });

  const phaseRef = useRef<Phase>("starting");
  const mutedRef = useRef(false);
  const voiceRef = useRef("");
  const orbRef = useRef<HTMLDivElement | null>(null);
  const conversationRef = useRef<string | null>(null);
  const turnRef = useRef<AbortController | null>(null);
  const speakerRef = useRef<Speaker | null>(null);
  const closeRef = useRef(onClose);
  const stopRef = useRef<() => void>(() => undefined);
  const skipRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    closeRef.current = onClose;
  });

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  useEffect(() => {
    let disposed = false;
    let ctx: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let processor: ScriptProcessorNode | null = null;
    let raf = 0;
    const vad = new SpeechDetector();
    const barge = new SpeechDetector({ minLevel: 0.07, startMs: 320, endMs: 900, ratio: 4 });
    let chunks: Float32Array[] = [];
    const preroll: Float32Array[] = [];
    let micLevel = 0;
    let outAnalyser: AnalyserNode | null = null;
    const outData = new Uint8Array(1024);

    const listen = () => {
      if (disposed) return;
      vad.reset();
      barge.reset();
      chunks = [];
      setPhase("listening");
    };

    async function ensureConversation(): Promise<string> {
      if (conversationRef.current) return conversationRef.current;
      const created = await apiRequest<{ conversation: { id: string } }>("/api/conversations", { json: { modelId: modelId ?? undefined } });
      conversationRef.current = created.conversation.id;
      await apiRequest(`/api/conversations/${created.conversation.id}`, { method: "PATCH", json: { systemPrompt: VOICE_SYSTEM_PROMPT } });
      return created.conversation.id;
    }

    function interrupt() {
      turnRef.current?.abort();
      speakerRef.current?.stop();
      speakerRef.current = null;
    }

    async function handleUtterance(recorded: Float32Array[], sampleRate: number) {
      const { bytes, seconds } = encodeWav(recorded, sampleRate);
      if (seconds < 0.45) return listen();
      const controller = new AbortController();
      turnRef.current = controller;
      setPhase("thinking");
      setError(null);
      try {
        const heard = await apiRequest<{ text: string }>("/api/voice/transcribe", { json: { audio: toBase64(bytes), format: "wav", seconds: Math.ceil(seconds) }, signal: controller.signal });
        const said = heard.text.trim();
        if (!said || /^[\s\W_]+$/.test(said)) return listen();
        setLines((prev) => [...prev, { who: "you" as const, text: said }, { who: "ai" as const, text: "" }].slice(-6));
        const id = await ensureConversation();
        const speaker = new Speaker(ctx as AudioContext, outAnalyser as AudioNode, () => voiceRef.current, controller.signal, {
          onStart: () => {
            if (!controller.signal.aborted) setPhase("speaking");
          },
          onError: (message) => setError(message),
        });
        speakerRef.current = speaker;
        let buffer = "";
        let reply = "";
        let first = true;
        const flush = (final: boolean) => {
          const { sentences, rest } = takeSentences(buffer, { first, final });
          buffer = rest;
          for (const sentence of sentences) {
            first = false;
            speaker.say(sentence);
          }
        };
        await streamTurn(`/api/conversations/${id}/messages`, { content: said, web: "auto" }, {
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === "delta") {
              reply += event.text;
              buffer += event.text;
              setLines((prev) => (prev.length ? [...prev.slice(0, -1), { who: "ai" as const, text: reply }] : prev));
              flush(false);
            } else if (event.type === "error") {
              setError(event.message);
            }
          },
        });
        flush(true);
        await speaker.finished();
        if (!controller.signal.aborted) listen();
      } catch (caught) {
        if (isAbortError(caught) || controller.signal.aborted) return;
        setError(caught instanceof ClientApiError ? caught.message : "Something went wrong. Try again.");
        listen();
      }
    }

    function onAudio(event: AudioProcessingEvent) {
      if (!ctx) return;
      const input = event.inputBuffer.getChannelData(0);
      const frame = new Float32Array(input);
      let sum = 0;
      for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i];
      const level = Math.sqrt(sum / frame.length);
      micLevel = level;
      if (mutedRef.current) return;
      const ms = (frame.length / ctx.sampleRate) * 1000;
      const phase = phaseRef.current;

      if (phase === "listening" || phase === "hearing") {
        const change = vad.push(level, ms);
        if (phase === "listening") {
          preroll.push(frame);
          if (preroll.length > 7) preroll.shift();
        }
        if (change === "start") {
          chunks = [...preroll];
          setPhase("hearing");
        } else if (phase === "hearing") {
          chunks.push(frame);
          if (change === "end" || chunks.length * ms > 60_000) {
            const recorded = chunks;
            chunks = [];
            preroll.length = 0;
            void handleUtterance(recorded, ctx.sampleRate);
          }
        }
      } else if (phase === "speaking" || phase === "thinking") {
        // Talking over the assistant: stop it and start listening. This needs louder, longer sound than a normal start, so
        // the assistant's own voice coming back through the microphone doesn't count.
        preroll.push(frame);
        if (preroll.length > 7) preroll.shift();
        if (barge.push(level, ms) === "start") {
          interrupt();
          vad.reset();
          vad.push(level, 200);
          chunks = [...preroll];
          setPhase("hearing");
        }
      }
    }

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError("Voice needs a secure connection. Use the Omni app on your computer, or open an address that starts with https.");
          return;
        }
        const fetched = await apiRequest<VoiceModelsResponse>("/api/voice/models").catch(() => null);
        if (fetched && !disposed) {
          const model = fetched.tts.find((candidate) => candidate.id === fetched.defaults.tts) ?? fetched.tts[0];
          setModels({ stt: fetched.defaults.stt, tts: fetched.defaults.tts });
          setVoices(model?.voices ?? []);
          let saved = "";
          try {
            saved = window.localStorage.getItem(VOICE_KEY) ?? "";
          } catch {
            // Storage can be blocked.
          }
          const chosen = model?.voices.includes(saved) ? saved : (fetched.defaults.voice ?? "");
          voiceRef.current = chosen;
          setVoiceState(chosen);
        }
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
        if (disposed) return stream.getTracks().forEach((track) => track.stop());
        const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new AudioContextClass();
        await ctx.resume();
        const source = ctx.createMediaStreamSource(stream);
        processor = ctx.createScriptProcessor(2048, 1, 1);
        processor.onaudioprocess = onAudio;
        const silent = ctx.createGain();
        silent.gain.value = 0; // The processor only runs while it is connected; nothing is played back from the microphone.
        source.connect(processor);
        processor.connect(silent);
        silent.connect(ctx.destination);
        outAnalyser = ctx.createAnalyser();
        outAnalyser.fftSize = 1024;
        outAnalyser.connect(ctx.destination);
        const loop = () => {
          let level = micLevel;
          if (phaseRef.current === "speaking" && outAnalyser) {
            outAnalyser.getByteTimeDomainData(outData);
            let sum = 0;
            for (const value of outData) sum += ((value - 128) / 128) ** 2;
            level = Math.sqrt(sum / outData.length) * 1.6;
          }
          orbRef.current?.style.setProperty("--level", String(Math.min(1, level * 5).toFixed(3)));
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        listen();
      } catch (caught) {
        setError(microphoneMessage(caught));
      }
    }

    stopRef.current = () => {
      interrupt();
      listen();
    };
    skipRef.current = () => {
      interrupt();
      listen();
    };
    void start();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current(conversationRef.current);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      disposed = true;
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
      interrupt();
      if (processor) processor.onaudioprocess = null;
      processor?.disconnect();
      stream?.getTracks().forEach((track) => track.stop());
      void ctx?.close();
    };
  }, [modelId, setPhase]);

  function toggleMute() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMutedState(next);
    if (next) stopRef.current();
  }

  function chooseVoice(next: string) {
    voiceRef.current = next;
    setVoiceState(next);
    try {
      window.localStorage.setItem(VOICE_KEY, next);
    } catch {
      // Not remembered, still applied.
    }
  }

  const busy = phase === "speaking" || phase === "thinking";

  return (
    <div role="dialog" aria-modal="true" aria-label="Voice mode" className="fixed inset-0 z-[80] flex flex-col bg-background/97 backdrop-blur-md">
      <div className="flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <p className="eyebrow">Voice</p>
        <button type="button" onClick={() => onClose(conversationRef.current)} aria-label="End voice mode" className="grid size-10 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="size-5" aria-hidden />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-6">
        <div ref={orbRef} className="voice-orb" data-phase={muted ? "muted" : phase} aria-hidden>
          <span className="voice-orb-core" />
        </div>
        <p role="status" aria-live="polite" className="font-display text-2xl">
          {muted ? "Muted" : PHASE_LABEL[phase]}
        </p>

        <div className="w-full max-w-lg space-y-3" aria-label="Conversation so far">
          {lines.slice(-4).map((line, index) => (
            <p key={index} className={cn("rounded-2xl px-4 py-2.5 text-[15px] leading-6", line.who === "you" ? "ml-auto w-fit max-w-[85%] bg-muted text-foreground" : "text-foreground/90")}>
              {line.text || <span className="text-muted-foreground">…</span>}
            </p>
          ))}
        </div>

        {error ? (
          <p role="alert" className="max-w-md rounded-xl border border-danger/40 bg-danger/10 px-4 py-2.5 text-center text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col items-center gap-3 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleMute}
            aria-pressed={muted}
            aria-label={muted ? "Unmute microphone" : "Mute microphone"}
            className={cn("grid size-14 place-items-center rounded-full border transition-colors", muted ? "border-danger/50 bg-danger/10 text-danger" : "border-border bg-card hover:bg-accent")}
          >
            {muted ? <MicOff className="size-6" aria-hidden /> : <Mic className="size-6" aria-hidden />}
          </button>
          {busy ? (
            <button type="button" onClick={() => skipRef.current()} aria-label="Stop talking and listen" className="inline-flex h-14 items-center gap-2 rounded-full border border-border bg-card px-5 text-sm font-medium hover:bg-accent">
              <SkipForward className="size-5" aria-hidden /> Interrupt
            </button>
          ) : null}
          {voices.length > 1 ? (
            <select value={voice} onChange={(event) => chooseVoice(event.target.value)} aria-label="Voice" className="h-14 max-w-40 rounded-full border border-border bg-card px-4 text-sm">
              {voices.map((name) => (
                <option key={name} value={name}>
                  {name.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Just talk, and talk over it any time to interrupt.{models.stt && models.tts ? ` Hearing: ${models.stt.split("/").pop()} · Speaking: ${models.tts.split("/").pop()}` : ""}
        </p>
      </div>
    </div>
  );
}
