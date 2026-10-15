// Pure helpers for voice mode (safe in the browser and in tests).

/** The instructions a voice conversation gets, because everything the model writes is read aloud. */
export const VOICE_SYSTEM_PROMPT =
  "You are in a live spoken conversation, and everything you write is read aloud. Answer in one to three short, natural sentences unless the person asks for more detail. " +
  "Never use markdown, lists, headings, tables, code blocks, links or emoji. Say numbers, dates and symbols the way a person would say them out loud. " +
  "If you looked something up, just say what you found in plain words. Be warm and direct, and ask a short follow-up question only when it helps.";

/** Strips what shouldn't be read aloud: code, markdown marks, links, emoji. */
export function toSpeakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+•]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/[*_~|]{1,3}/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Takes the complete sentences off the front of streamed text so they can be spoken while the rest is still being written.
 * A first short chunk is released early so speech starts quickly.
 */
export function takeSentences(buffer: string, options: { first?: boolean; final?: boolean } = {}): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let rest = buffer;
  const pattern = /^([\s\S]*?[.!?…]+["')\]]*)(\s+|$)/;
  for (;;) {
    const match = pattern.exec(rest);
    // A sentence end at the very end of the buffer might be mid-number ("3.") or an abbreviation, so wait for more text unless final.
    if (!match || (match[2] === "" && !options.final)) break;
    const sentence = match[1].trim();
    rest = rest.slice(match[0].length);
    if (sentence) sentences.push(sentence);
  }
  const newline = rest.indexOf("\n");
  if (newline > 0 && !options.final) {
    sentences.push(rest.slice(0, newline).trim());
    rest = rest.slice(newline + 1);
  }
  // Very long run without a full stop: speak up to the last comma so the voice doesn't wait.
  if (rest.length > 240) {
    const cut = Math.max(rest.lastIndexOf(", ", 200), rest.lastIndexOf("; ", 200));
    if (cut > 40) {
      sentences.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 2);
    }
  }
  // Start talking early: if nothing has been spoken yet, release a first clause as soon as it is long enough.
  if (options.first && sentences.length === 0 && rest.length > 60) {
    const cut = rest.search(/[,;:]\s/);
    if (cut > 25) {
      sentences.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 2);
    }
  }
  if (options.final && rest.trim()) {
    sentences.push(rest.trim());
    rest = "";
  }
  return { sentences: sentences.filter(Boolean), rest };
}

/** Voice activity: does this stretch of the microphone sound like speech? Tracks the room's background level. */
export class SpeechDetector {
  private floor = 0.008;
  private loudMs = 0;
  private quietMs = 0;
  private speaking = false;
  constructor(private readonly options: { minLevel?: number; startMs?: number; endMs?: number; ratio?: number } = {}) {}

  /** Feed one slice of audio (its loudness 0..1 and length in ms). Returns what happened. */
  push(level: number, ms: number): "start" | "end" | null {
    const minLevel = this.options.minLevel ?? 0.022;
    const threshold = Math.max(minLevel, this.floor * (this.options.ratio ?? 3.2));
    const loud = level > threshold;
    if (!this.speaking && !loud) this.floor = this.floor * 0.97 + level * 0.03; // learn the background while nobody talks
    if (loud) {
      this.loudMs += ms;
      this.quietMs = 0;
    } else {
      this.quietMs += ms;
      if (!this.speaking) this.loudMs = 0;
    }
    if (!this.speaking && this.loudMs >= (this.options.startMs ?? 140)) {
      this.speaking = true;
      return "start";
    }
    if (this.speaking && this.quietMs >= (this.options.endMs ?? 950)) {
      this.speaking = false;
      this.loudMs = 0;
      this.quietMs = 0;
      return "end";
    }
    return null;
  }

  get active(): boolean {
    return this.speaking;
  }

  reset() {
    this.speaking = false;
    this.loudMs = 0;
    this.quietMs = 0;
  }
}

/** Joins recorded audio and turns it into a 16 kHz, 16-bit mono WAV, which every speech model accepts. */
export function encodeWav(chunks: Float32Array[], sampleRate: number): { bytes: Uint8Array; seconds: number } {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const target = 16_000;
  const ratio = sampleRate / target;
  const length = Math.max(0, Math.floor(total / ratio));
  const flat = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    flat.set(chunk, offset);
    offset += chunk.length;
  }
  const pcm = new Int16Array(length);
  for (let i = 0; i < length; i += 1) {
    // Average the source samples this output sample covers (a simple low-pass before dropping to 16 kHz).
    const start = Math.floor(i * ratio);
    const end = Math.min(total, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += flat[j];
    const sample = Math.max(-1, Math.min(1, sum / (end - start)));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => [...value].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, target, true);
  view.setUint32(28, target * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i += 1) view.setInt16(44 + i * 2, pcm[i], true);
  return { bytes, seconds: pcm.length / target };
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
