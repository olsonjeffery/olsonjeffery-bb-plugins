// Plugin health, Thread Tags card — the settings-page integration readout
// for bb-plugin-thread-tags. Same content the Personas settings page shows
// for this plugin: a green check when Thread Tags is installed and enabled,
// a red X when it is not, a status detail line (state + version), and —
// while missing — a one-click Install button pinned to the plugin's
// community source (bare URL fallback), so no detour to a plugin page.
//
// The installed-plugin list is never cached: the card re-reads on mount, on
// bb's `plugins-changed` realtime signal, and on the app reconnecting.
import { useCallback, useEffect, useState } from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  PLUGINS_CHANGED_CHANNEL,
  THREAD_TAGS_PLUGIN_SOURCE,
  THREAD_TAGS_PLUGIN_URL,
  threadTagsHealthOf,
  threadTagsHealthDetail,
  type PluginRow,
  type ThreadTagsHealth,
} from "./threadTags";

/**
 * The sdk surface this card touches. Tests inject a fake; production takes
 * the runtime client from useSdk().
 */
export interface HealthSdk {
  plugins: {
    list(): Promise<{ plugins: readonly PluginRow[] }>;
    install(args: { source: string }): Promise<unknown>;
  };
}

interface ThreadTagsHealthCardProps {
  /** Injected for tests; the settings page lets it default to useSdk(). */
  sdk?: HealthSdk | null;
}

export function ThreadTagsHealthCard({ sdk: sdkProp }: ThreadTagsHealthCardProps) {
  const runtimeSdk = useSdk() as unknown as Partial<HealthSdk> | null;
  const sdk = (sdkProp ?? runtimeSdk) as HealthSdk | null;

  const [state, setState] = useState<
    { kind: "checking" } | { kind: "error"; message: string } | { kind: "health"; health: ThreadTagsHealth }
  >({ kind: "checking" });
  const [installing, setInstalling] = useState(false);

  const reload = useCallback(() => {
    void (async () => {
      try {
        if (!sdk?.plugins?.list) {
          // An sdk without a plugins area (safe mode, isolated fakes) is
          // simply an unhealthy read, not a crash.
          throw new Error("The plugin list is unavailable.");
        }
        const listed = await sdk.plugins.list();
        setState({ kind: "health", health: threadTagsHealthOf(listed.plugins) });
      } catch (cause) {
        setState({
          kind: "error",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    })();
  }, [sdk]);

  useEffect(() => {
    reload();
  }, [reload]);

  // bb republishes `plugins-changed` whenever the set changes (install,
  // enable, disable, remove) and after a reconnect.
  useRealtime(PLUGINS_CHANGED_CHANNEL, reload);
  const connection = useRealtimeConnectionState();
  useEffect(() => {
    // Reconcile once on every transition TO connected: a signal missed
    // while offline must not stale-paint until the next install happens.
    if (connection === "connected") reload();
  }, [connection, reload]);

  const install = useCallback(async () => {
    if (installing || !sdk?.plugins?.install) return;
    setInstalling(true);
    try {
      try {
        await sdk.plugins.install({ source: THREAD_TAGS_PLUGIN_SOURCE });
      } catch {
        // Range-suffixed git sources can be rejected (older hosts, pinned
        // offline environments): retry the bare repository URL, exactly the
        // fallback the plugin guide documents.
        await sdk.plugins.install({ source: THREAD_TAGS_PLUGIN_URL });
      }
      toast.success("Thread Tags installed");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setInstalling(false);
      // The install changes the plugin list this card reads — the
      // `plugins-changed` signal covers it, but read eagerly so a slow
      // publish still turns the row over within the same interaction.
      reload();
    }
  }, [installing, reload, sdk]);

  return (
    <div className="spooler-settings-health" data-testid="spooler-settings-thread-tags">
      <div className="spooler-settings-health-copy">
        <p className="spooler-settings-health-title">Thread Tags</p>
        <p className="spooler-settings-health-sub">
          Sidebar badges threads wear; this list shows them on rows and rolls
          them up onto spool cards.
        </p>
      </div>
      {state.kind === "checking" ? (
        <p className="spooler-settings-muted">Checking plugin health…</p>
      ) : state.kind === "error" ? (
        <p className="spooler-settings-muted" role="alert">
          {state.message}
        </p>
      ) : (
        <div className="spooler-settings-health-row">
          <Icon
            name={state.health.available ? "CircleCheck" : "CircleX"}
            aria-label={state.health.available ? "Installed and enabled" : "Not available"}
            className={cn(
              "spooler-settings-health-status",
              !state.health.available && "spooler-settings-health-status-down",
            )}
          />
          <span className="spooler-settings-health-detail">
            {threadTagsHealthDetail(state.health)}
          </span>
          {!state.health.installed ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={installing}
              data-testid="spooler-settings-thread-tags-install"
              onClick={() => void install()}
            >
              {installing ? "Installing…" : "Install This Plugin"}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
