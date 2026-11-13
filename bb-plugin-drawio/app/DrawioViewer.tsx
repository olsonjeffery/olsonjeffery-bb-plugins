// bb-plugin-drawio — the read-only diagram viewer.
//
// Diagrams opened outside the dashboard (thread tabs, the fileOpener) render
// through draw.io's static viewer bundle instead of the embed editor: the
// viewer has no editing surface at all, so a sidebar open can never change
// the file — not even inside the frame (the embed editor's load action has no
// read-only flag; its `editable: 0` is silently ignored by every draw.io
// release). The frame is a srcdoc document that loads `viewer.min.js` from
// the configured instance and fits the diagram into the frame; the viewer's
// own floating toolbar provides zoom and page navigation.
//
// Readiness is detected by polling the same-origin frame for the rendered
// graph; a frame that never renders (instance down, script blocked) becomes
// an explicit error with retry instead of a silent blank frame.
import { useEffect, useRef, useState } from "react";
import { isMixedContent, viewerSrcDoc } from "./drawio.js";
import { FrameFallback, MixedContentBanner } from "./FrameFallback.js";
import { cn } from "@/lib/utils";

const VIEWER_READY_POLL_MS = 250;
const VIEWER_READY_TIMEOUT_MS = 12_000;

export interface DrawioViewerProps {
  instanceUrl: string;
  xml: string;
  className?: string;
}

export function DrawioViewer({ instanceUrl, xml, className }: DrawioViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [status, setStatus] = useState<"connecting" | "ready" | "error">("connecting");
  const [reloadNonce, setReloadNonce] = useState(0);

  const srcDoc = viewerSrcDoc(instanceUrl, xml);

  useEffect(() => {
    if (srcDoc === null) return;
    setStatus("connecting");
    let attempts = Math.ceil(VIEWER_READY_TIMEOUT_MS / VIEWER_READY_POLL_MS);
    const timer = setInterval(() => {
      attempts -= 1;
      let div: Element | null = null;
      try {
        div = iframeRef.current?.contentDocument?.querySelector("div.mxgraph") ?? null;
      } catch {
        div = null; // opaque frame: treat as not ready
      }
      if (div !== null && (div.childElementCount > 0 || (div.textContent ?? "").trim() !== "")) {
        clearInterval(timer);
        setStatus("ready");
        return;
      }
      if (attempts <= 0) {
        clearInterval(timer);
        setStatus("error");
      }
    }, VIEWER_READY_POLL_MS);
    return () => clearInterval(timer);
    // The frame reloads whenever the document or the retry nonce changes.
  }, [srcDoc, reloadNonce]);

  if (srcDoc === null) {
    return (
      <div className={cn("relative flex min-h-0 flex-1 flex-col", className)}>
        <MixedContentBanner instanceUrl={instanceUrl} />
        <FrameFallback detail="The draw.io instance URL is not configured." />
      </div>
    );
  }

  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col", className)}>
      {isMixedContent(instanceUrl) ? <MixedContentBanner instanceUrl={instanceUrl} /> : null}
      <iframe
        key={reloadNonce}
        ref={iframeRef}
        srcDoc={srcDoc}
        title="draw.io diagram viewer"
        className={cn(
          "min-h-0 w-full flex-1 border-0 bg-background",
          status === "connecting" && "opacity-60",
        )}
      />
      {status !== "ready" ? (
        <div className="absolute inset-x-0 bottom-0 top-0 flex items-center justify-center bg-background/70 backdrop-blur-[2px]">
          <FrameFallback
            loading={status === "connecting"}
            detail={
              status === "error"
                ? "The diagram viewer did not load. Check the draw.io instance URL."
                : null
            }
            onRetry={status === "error" ? () => setReloadNonce((nonce) => nonce + 1) : undefined}
          />
        </div>
      ) : null}
    </div>
  );
}
