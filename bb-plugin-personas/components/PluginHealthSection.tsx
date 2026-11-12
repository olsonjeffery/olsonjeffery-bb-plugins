// The Plugin health box on the Personas settings page (app.slots.
// settingsSection). A leading row shows where this install came from (a
// local in-progress path checkout vs a managed git/catalog install), then
// one row per cooperating plugin the Personas plugin can use — today that is
// Floating Notes, Thread Tags, and BB's built-in Docs — with a green check
// when the plugin is installed and enabled, a red X when it is not, and,
// while missing, a one-click install button (Thread Tags), an inline link to
// its bb plugin page (Floating Notes, which is a bigger install that keeps
// its own page), or nothing (Docs, which ships with BB and can only be
// re-enabled in settings).
import { useState } from "react";
import { toast } from "sonner";
import { usePersonasRpc, useQuery } from "@/components/use-query";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { THREAD_TAGS_PLUGIN_ID } from "@/plugin-health";

/** One getPluginHealth RPC row (server.ts ToolHealthSchema). */
interface ToolHealthView {
  id: string;
  label: string;
  installed: boolean;
  enabled: boolean;
  status: string | null;
  version: string | null;
  installUrl: string | null;
  available: boolean;
}

/** The getPluginHealth RPC's `self` field (server.ts). */
interface SelfInstallView {
  version: string | null;
  source: string | null;
  managed: boolean;
  sourceLabel: string | null;
}

function toolDetail(tool: ToolHealthView): string {
  if (!tool.installed) return "Not installed";
  if (!tool.enabled) return "Installed — disabled";
  const status =
    tool.status === null
      ? "Installed"
      : tool.status === "running"
        ? "Running"
        : `Installed — ${tool.status}`;
  return tool.version === null ? status : `${status} · v${tool.version}`;
}

export function PluginHealthSection() {
  const rpc = usePersonasRpc();
  const { data, error, isLoading, reload } = useQuery(
    () => rpc.call("getPluginHealth", null),
    "plugin-health",
  );
  // Which row's install is in flight, if any — the button holds the row's
  // spinner and every other install button stays disabled meanwhile.
  const [installingId, setInstallingId] = useState<string | null>(null);

  async function install(tool: ToolHealthView): Promise<void> {
    setInstallingId(tool.id);
    try {
      await rpc.call("installThreadTags", null);
      toast.success("Thread Tags installed");
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : String(cause),
      );
    } finally {
      setInstallingId(null);
      // Installing changes the plugin list, which is what this whole box
      // reads — re-check on the spot instead of waiting for a revisit.
      reload();
    }
  }

  if (isLoading) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        Checking plugin health…
      </p>
    );
  }
  if (error !== null || data === null) {
    return (
      <p className="py-2 text-sm text-destructive">
        {error ?? "Plugin health is unavailable."}
      </p>
    );
  }

  const self = data.self;

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border bg-card px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Icon
            name={self.managed ? "PackageReceive" : "Code"}
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              Personas
              {self.version === null ? "" : ` · v${self.version}`}
              {self.managed ? "" : " — in-progress build"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {self.sourceLabel ?? "Install source unknown"}
            </p>
          </div>
        </div>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {data.tools.map((tool) => (
          <li
            key={tool.id}
            className="flex items-center justify-between gap-3 px-3 py-2.5"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <Icon
                name={tool.available ? "CircleCheck" : "CircleX"}
                aria-label={tool.available ? "Installed and enabled" : "Not available"}
                className={
                  tool.available
                    ? "size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                    : "size-4 shrink-0 text-destructive"
                }
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{tool.label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {toolDetail(tool)}
                </p>
              </div>
            </div>
            {tool.installed ? null :
              tool.id === THREAD_TAGS_PLUGIN_ID ? (
                // One-click install: the RPC hands the plugin's pinned source
                // straight to bb's own installer, so no detour to a plugin
                // page — and the row flips to its running state on its own.
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={installingId !== null}
                  onClick={() => void install(tool)}
                >
                  {installingId === tool.id ? (
                    <Icon name="Spinner" aria-hidden className="animate-spin" />
                  ) : null}
                  {installingId === tool.id ? "Installing…" : "Install This Plugin"}
                </Button>
              ) : tool.installUrl === null ? null : (
                <a
                  href={tool.installUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
                >
                  Install
                  <Icon name="ExternalLink" aria-hidden className="size-3.5" />
                </a>
              )}
          </li>
        ))}
      </ul>
    </div>
  );
}
