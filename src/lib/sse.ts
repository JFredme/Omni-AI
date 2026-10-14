export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Incremental parser for text/event-stream bodies. Accepts arbitrary chunk boundaries
 * and LF or CRLF line endings. Comment lines (starting with ":") are ignored.
 */
export class SseParser {
  private buffer = "";
  private eventName: string | undefined;
  private dataLines: string[] = [];

  feed(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      let line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      this.handleLine(line, events);
      newline = this.buffer.indexOf("\n");
    }
    return events;
  }

  /** Call once the stream has ended to emit a final event that lacked a trailing blank line. */
  flush(): SseEvent[] {
    const events: SseEvent[] = [];
    if (this.buffer.length > 0) {
      const line = this.buffer.endsWith("\r") ? this.buffer.slice(0, -1) : this.buffer;
      this.buffer = "";
      this.handleLine(line, events);
    }
    this.dispatch(events);
    return events;
  }

  private handleLine(line: string, events: SseEvent[]) {
    if (line === "") {
      this.dispatch(events);
      return;
    }
    if (line.startsWith(":")) return;

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "data") {
      this.dataLines.push(value);
    } else if (field === "event") {
      this.eventName = value;
    }
  }

  private dispatch(events: SseEvent[]) {
    if (this.dataLines.length > 0) {
      events.push({ event: this.eventName || "message", data: this.dataLines.join("\n") });
    }
    this.dataLines = [];
    this.eventName = undefined;
  }
}

export function encodeSseEvent(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}
