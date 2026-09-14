import { createParser } from "eventsource-parser";

// Shared framing for the authenticated browser channel and the OpenCode adapter.
export async function readAnswerEvents(response, onEvent, onActivity = () => {}) {
  if (!response.ok || !response.body) throw new Error(`Event stream HTTP ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pendingBytes = 0;
  const parser = createParser({
    onComment() { pendingBytes = 0; },
    onEvent(event) { pendingBytes = 0; if (event.data === "[DONE]") onEvent("end", null); else if (event.data) onEvent(event.event || "message", JSON.parse(event.data)); }
  });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pendingBytes += value.byteLength;
      if (pendingBytes > 4 * 1024 * 1024) throw new Error("Event stream frame exceeded the size limit");
      onActivity();
      parser.feed(decoder.decode(value, { stream: true }));
    }
    parser.feed(decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
