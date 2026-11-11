// bb-plugin-drawio — the embed bridge.
//
// One iframe pointed at the user's draw.io instance, plus the JSON
// postMessage protocol around it. Every inbound message is checked for
// `event.origin` against the configured instance origin before anything is
// parsed; outbound messages carry that origin as the target, so a spoofed
// instance (wrong origin) receives nothing and sends nothing.
//
// Protocol (draw.io embed mode, proto=json):
//   instance → {event:"init"}                    editor chrome is up
//   host   →   {action:"load", xml, autosave:1}  hand the diagram over
//   instance → {event:"load"}                    diagram loaded
//   instance → {event:"save"|"autosave", xml}    current XML (dirty marker)
//   host   →   {action:"export", format, …}
//   instance → {event:"export", data?|xml?}      export result
//   instance → {event:"exit"}                    user closed the editor chrome
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { ExportFormat, ExportResult } from "./drawio.js";
import { embedOrigin, embedUrl, isMixedContent } from "./drawio.js";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/** Outbound messages to the editor. */
type EditorAction =
  | { action: "load"; xml: string; autosave: number }
  | { action: "export"; format: ExportFormat; transparent?: boolean; scale?: number }
  | { action: "exit" };

interface InboundMessage {
  event: string;
  xml?: unknown;
  data?: unknown;
  format?: unknown;
  message?: unknown;
}

/** What a parent can drive on the mounted editor. */
export interface DrawioEditorHandle {
  /** Requests an export; rejects on timeout or when the editor is not ready. */
  exportDiagram(format: ExportFormat): Promise<ExportResult>;
  /** True once the editor confirmed the load ({event:"load"}). */
  isReady(): boolean;
}

export interface DrawioEditorProps {
  instanceUrl: string;
  uiTheme: "min" | "sketch" | "atlas";
  /** The XML handed over on init. */
  xml: string;
  /** Current editor XML (autosave/save events). */
  onXml: (xml: string) => void;
  onReady: () => void;
  onExit?: () => void;
  className?: string;
}

const EXPORT_TIMEOUT_MS = 30_000;
const READY_TIMEOUT_MS = 20_000;

export const DrawioEditor = forwardRef<DrawioEditorHandle, DrawioEditorProps>(
  function DrawioEditor({ instanceUrl, uiTheme, xml, onXml, onReady, onExit, className }, ref) {
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    // The load payload is captured by ref so the message listener never
    // re-subscribes because the document changed.
    const loadXmlRef = useRef(xml);
    loadXmlRef.current = xml;
    // Callbacks ride refs too: the listener must always call the newest one.
    const onXmlRef = useRef(onXml);
    onXmlRef.current = onXml;
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;
    const onExitRef = useRef(onExit);
    onExitRef.current = onExit;
    const readyRef = useRef(false);
    const pendingExportRef = useRef<{
      resolve: (result: ExportResult) => void;
      reject: (cause: Error) => void;
    } | null>(null);
    const [status, setStatus] = useState<"connecting" | "ready" | "error">("connecting");
    const [statusDetail, setStatusDetail] = useState<string | null>(null);
    const [reloadNonce, setReloadNonce] = useState(0);

    const src = embedUrl({ instanceUrl, uiTheme });
    const origin = embedOrigin(instanceUrl);

    const post = useCallback(
      (message: EditorAction): boolean => {
        const frame = iframeRef.current;
        if (frame === null || frame.contentWindow === null || origin === null) return false;
        // JSON strings are what every draw.io embed build parses.
        frame.contentWindow.postMessage(JSON.stringify(message), origin);
        return true;
      },
      [origin],
    );

    useEffect(() => {
      if (src === null || origin === null) {
        setStatus("error");
        setStatusDetail("The draw.io instance URL is not configured.");
        return;
      }
      readyRef.current = false;
      setStatus("connecting");
      setStatusDetail(null);
      loadXmlRef.current = xml;

      let readyTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        if (!readyRef.current) {
          setStatus("error");
          setStatusDetail(
            "No response from the draw.io instance. Check the URL, and that the instance allows framing.",
          );
        }
      }, READY_TIMEOUT_MS);

      function finishExport(message: InboundMessage): void {
        const pending = pendingExportRef.current;
        if (pending === null) return;
        pendingExportRef.current = null;
        const dataUri = typeof message.data === "string" ? message.data : null;
        const xmlResult = typeof message.xml === "string" ? message.xml : null;
        if (dataUri === null && xmlResult === null) {
          pending.reject(new Error("The editor returned an empty export."));
          return;
        }
        pending.resolve({ dataUri, xml: xmlResult });
      }

      function onMessage(event: MessageEvent): void {
        if (event.source !== iframeRef.current?.contentWindow) return;
        if (event.origin !== origin) return; // spoofed or foreign frame: ignore
        let message: InboundMessage | null = null;
        if (typeof event.data === "string") {
          try {
            message = JSON.parse(event.data) as InboundMessage;
          } catch {
            return;
          }
        } else if (typeof event.data === "object" && event.data !== null) {
          message = event.data as InboundMessage;
        }
        if (message === null || typeof message.event !== "string") return;

        switch (message.event) {
          case "init": {
            post({ action: "load", xml: loadXmlRef.current, autosave: 1 });
            break;
          }
          case "load": {
            if (readyRef.current) break;
            readyRef.current = true;
            if (readyTimer !== null) {
              clearTimeout(readyTimer);
              readyTimer = null;
            }
            setStatus("ready");
            onReadyRef.current();
            break;
          }
          case "save":
          case "autosave": {
            if (typeof message.xml === "string") onXmlRef.current(message.xml);
            break;
          }
          case "export": {
            finishExport(message);
            break;
          }
          case "exit": {
            onExitRef.current?.();
            break;
          }
          default:
            break;
        }
      }

      window.addEventListener("message", onMessage);
      return () => {
        window.removeEventListener("message", onMessage);
        if (readyTimer !== null) clearTimeout(readyTimer);
        pendingExportRef.current?.reject(new Error("The editor was closed."));
        pendingExportRef.current = null;
      };
      // The bridge binds once per iframe mount; xml/onXml/onReady ride refs.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [src, origin, reloadNonce]);

    useImperativeHandle(
      ref,
      (): DrawioEditorHandle => ({
        exportDiagram: (format) => {
          if (!readyRef.current) {
            return Promise.reject(new Error("The editor is still loading."));
          }
          const pending = pendingExportRef.current;
          if (pending !== null) {
            pending.reject(new Error("Another export is already in flight."));
          }
          return new Promise<ExportResult>((resolve, reject) => {
            pendingExportRef.current = { resolve, reject };
            const sent = post({
              action: "export",
              format,
              ...(format === "png" || format === "jpeg" ? { transparent: false, scale: 1 } : {}),
            });
            if (!sent) {
              pendingExportRef.current = null;
              reject(new Error("The editor frame is not mounted."));
              return;
            }
            setTimeout(() => {
              if (pendingExportRef.current !== null && pendingExportRef.current.resolve === resolve) {
                pendingExportRef.current = null;
                reject(
                  new Error(
                    format === "pdf"
                      ? "No PDF export arrived — this draw.io build may not support client-side PDF."
                      : "The export timed out.",
                  ),
                );
              }
            }, EXPORT_TIMEOUT_MS);
          });
        },
        isReady: () => readyRef.current,
      }),
      [post],
    );

    if (src === null || origin === null) {
      return <EditorFallback detail="The draw.io instance URL is not configured." />;
    }

    return (
      <div className={cn("relative flex min-h-0 flex-1 flex-col", className)}>
        {isMixedContent(instanceUrl) ? (
          <div className="flex items-start gap-2 border-b border-border bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
            <Icon name="AlertTriangle" className="mt-0.5 size-3.5 shrink-0" />
            <span>
              This page is served over HTTPS but the draw.io instance is HTTP, so the browser blocks
              the embedded editor. Serve the instance over HTTPS.
            </span>
          </div>
        ) : null}
        <iframe
          key={reloadNonce}
          ref={iframeRef}
          src={src}
          title="draw.io diagram editor"
          className={cn(
            "min-h-0 w-full flex-1 border-0 bg-background",
            status === "connecting" && "opacity-60",
          )}
          allow="clipboard-write"
        />
        {status !== "ready" ? (
          <div className="absolute inset-x-0 bottom-0 top-0 flex items-center justify-center bg-background/70 backdrop-blur-[2px]">
            <EditorFallback
              loading={status === "connecting"}
              detail={status === "error" ? (statusDetail ?? "The editor did not load.") : null}
              onRetry={status === "error" ? () => setReloadNonce((nonce) => nonce + 1) : undefined}
            />
          </div>
        ) : null}
      </div>
    );
  },
);

function EditorFallback({
  loading,
  detail,
  onRetry,
}: {
  loading?: boolean;
  detail: string | null;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 p-6 text-center text-sm text-muted-foreground">
      {loading ? (
        <>
          <Icon name="Loading" className="size-5 animate-spin" />
          <p>Connecting to the draw.io instance…</p>
        </>
      ) : (
        <>
          <Icon name="AlertCircle" className="size-5 text-destructive" />
          <p className="max-w-md">{detail ?? "The editor did not load."}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
            >
              Retry
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
