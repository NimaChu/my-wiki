export const ANSWER_STREAM_MAX_TEXT = 2 * 1024 * 1024;
const phases = new Set(["starting", "thinking", "reading", "searching", "generating", "retrying"]);

export function createAnswerStream() {
  let state = { text: "", phase: "starting", revision: 0, sources: [], images: [] };
  let terminal = null;
  const clients = new Set();
  const frame = (type, data) => `id: ${state.revision}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  const write = (res, type, data) => {
    if (res.destroyed || res.writableLength > ANSWER_STREAM_MAX_TEXT * 2) return res.destroy();
    res.write(frame(type, data));
  };
  const broadcast = (type, data) => { for (const res of clients) write(res, type, data); };
  return {
    snapshot: () => ({ ...state }),
    publish(event) {
      if (terminal) return;
      if (event.type === "status" && phases.has(event.phase)) {
        if (state.phase === event.phase) return;
        state = { ...state, phase: event.phase, revision: state.revision + 1 };
        broadcast("status", { phase: state.phase, revision: state.revision });
      } else if (event.type === "text" && typeof event.text === "string") {
        const text = event.text.slice(0, ANSWER_STREAM_MAX_TEXT);
        if (text === state.text) return;
        const append = text.startsWith(state.text);
        const delta = text.slice(state.text.length);
        state = { ...state, text, revision: state.revision + 1 };
        broadcast(append ? "delta" : "reset", append ? { delta, revision: state.revision } : state);
      } else if (event.type === "metadata" && Array.isArray(event.sources) && Array.isArray(event.images)) {
        state = { ...state, sources: event.sources, images: event.images, revision: state.revision + 1 };
        broadcast("metadata", { sources: state.sources, images: state.images, revision: state.revision });
      }
    },
    finish(job) {
      if (terminal) return;
      terminal = job;
      state = { ...state, revision: state.revision + 1 };
      broadcast("done", terminal);
      for (const res of clients) res.end();
      clients.clear();
    },
    subscribe(res) {
      if (clients.size >= 16) {
        res.writeHead(429, { "retry-after": "3" });
        res.end();
        return;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no"
      });
      res.flushHeaders();
      write(res, "snapshot", state);
      if (terminal) { write(res, "done", terminal); res.end(); return; }
      clients.add(res);
      const heartbeat = setInterval(() => {
        if (res.writableLength > ANSWER_STREAM_MAX_TEXT * 2) res.destroy();
        else res.write(": heartbeat\n\n");
      }, 15000);
      heartbeat.unref?.();
      const cleanup = () => { clearInterval(heartbeat); clients.delete(res); };
      res.once("close", cleanup);
      res.once("error", cleanup);
    }
  };
}
