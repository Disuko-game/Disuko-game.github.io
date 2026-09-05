/** Small local-only breadcrumb log: survives a page crash, contains no game/account data. */
export function recordRollDiagnostic(stage: string, details: Record<string, string | number | boolean> = {}) {
  try {
    const key = "disuko-roll-diagnostics";
    const previous = JSON.parse(localStorage.getItem(key) || "[]");
    const entries = Array.isArray(previous) ? previous.slice(-19) : [];
    entries.push({ time: new Date().toISOString(), stage, ...details });
    localStorage.setItem(key, JSON.stringify(entries));
    if (typeof document !== "undefined" && document.body &&
        (new URLSearchParams(location.search).has("diagnostics") || stage.includes("failed") || stage === "webgl-context-lost")) {
      let panel = document.getElementById("roll-diagnostic-panel") as HTMLDetailsElement | null;
      if (!panel) {
        panel = document.createElement("details");
        panel.id = "roll-diagnostic-panel";
        panel.style.cssText = "position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;background:#241a13;color:white;padding:8px;border:1px solid #e4c18e;border-radius:8px;font:12px monospace;max-height:40vh;overflow:auto";
        const summary = document.createElement("summary");
        summary.textContent = "3D diagnostics — tap for details";
        panel.append(summary, document.createElement("pre"));
        document.body.append(panel);
      }
      const output = panel.querySelector("pre")!;
      output.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere";
      output.textContent = JSON.stringify(entries.slice(-10), null, 2);
    }
  } catch { /* Storage may be disabled; diagnostics must never break gameplay. */ }
}
