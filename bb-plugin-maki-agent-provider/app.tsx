// bb-plugin-maki-agent-provider — a BB plugin frontend entry.
//
// A Settings section for the maki provider plugin: the installed maki version
// and path per machine, and the one-click port of OpenCode providers into
// maki config, with per-machine results.
import { useCallback, useEffect, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type {
  rpcContract,
  MakiStatusOutput,
  PortOpencodeOutput,
} from "./src/contract";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { MakiBrandIcon } from "./src/brand-icon";

type MachineResult = PortOpencodeOutput["machines"][number];
type MachineStatus = MakiStatusOutput["machines"][number];

function MachineResultRow({ result }: { result: MachineResult }) {
  if (!result.ok || result.report === null) {
    return (
      <li className="rounded-md border border-border bg-card px-3 py-2 text-sm">
        <span className="font-medium">{result.hostName}</span>
        <span className="text-destructive"> — {result.message}</span>
      </li>
    );
  }
  const { report } = result;
  return (
    <li className="rounded-md border border-border bg-card px-3 py-2 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{result.hostName}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {report.makiConfigPath}
        </span>
      </div>
      {report.added.length === 0 &&
      report.builtinKeySlugs.length === 0 ? (
        <p className="mt-1 text-muted-foreground">
          {report.opencodeFound
            ? "Nothing new to add — maki already has everything opencode defines."
            : `No opencode config found on this machine.`}
        </p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {report.added.map((entry) => (
            <li key={entry.slug} className="text-muted-foreground">
              <span className="font-mono text-foreground">{entry.slug}</span>
              {" — "}
              {entry.models === 0
                ? "models discovered from the endpoint"
                : `${entry.models} model${entry.models === 1 ? "" : "s"}`}
              {entry.portedApiKey ? ", API key ported" : ""}
            </li>
          ))}
          {report.builtinKeySlugs.map((slug) => (
            <li key={slug} className="text-muted-foreground">
              <span className="font-mono text-foreground">{slug}</span>
              {" — API key written for maki's built-in provider"}
            </li>
          ))}
        </ul>
      )}
      {report.skipped.length > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Skipped:{" "}
          {report.skipped
            .map((skip) => `${skip.slug} (${skip.reason})`)
            .join("; ")}
        </p>
      ) : null}
      {report.warnings.length > 0 ? (
        <ul className="mt-1 text-xs text-muted-foreground">
          {report.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function MakiStatusRow({ machine }: { machine: MachineStatus }) {
  const status = machine.ok ? machine.status : null;
  return (
    <li className="text-sm text-muted-foreground">
      <span className="font-medium text-foreground">{machine.hostName}</span>
      {status === null ? (
        <span className="text-muted-foreground">
          {" — "}
          {machine.ok ? "not installed" : machine.message}
        </span>
      ) : (
        <>
          {" — "}
          {status.installed ? (
            <>
              <span className="font-mono text-xs">maki {status.version}</span>
              {status.executablePath === null ? null : (
                <>
                  {" · "}
                  <span className="font-mono text-xs">
                    {status.executablePath}
                  </span>
                </>
              )}
            </>
          ) : (
            <span>not installed</span>
          )}
        </>
      )}
    </li>
  );
}

function PortSection() {
  const rpc = useRpc<typeof rpcContract>();
  const [status, setStatus] = useState<MakiStatusOutput | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<PortOpencodeOutput | null>(null);

  useEffect(() => {
    let cancelled = false;
    rpc.call("maki_status", null).then(
      (result) => {
        if (!cancelled) setStatus(result);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  const runPort = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      setOutput(await rpc.call("opencode_port", null));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }, [rpc]);

  return (
    <div className="space-y-3">
      <div>
        <Button onClick={runPort} disabled={pending}>
          <Icon name="ArrowRightLeft" className="size-4" />
          {pending ? "Porting…" : "Add OpenCode Providers to maki"}
        </Button>
      </div>
      <p className="max-w-prose text-sm text-muted-foreground">
        Reads each connected machine's opencode config (custom entries in{" "}
        <code>opencode.json</code>, plus stored API keys) and appends them to{" "}
        <code>~/.config/maki/providers.toml</code>. Existing maki entries are
        never touched. Restart maki or run <code>/reload</code> to pick up the
        new providers.
      </p>
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {output === null ? null : output.machines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No connected machines right now. Connect one and try again.
        </p>
      ) : (
        <ul className="space-y-2">
          {output.machines.map((machine) => (
            <MachineResultRow key={machine.hostId} result={machine} />
          ))}
        </ul>
      )}
      {status === null ? null : status.machines.length === 0 ? null : (
        <ul className="space-y-1 border-t border-border pt-2">
          {status.machines.map((machine) => (
            <MakiStatusRow key={machine.hostId} machine={machine} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  // Provider selector and agent pickers draw the full-color maki mark. The
  // declaration's icon/logo assets are currentColor masks, so the mark has to
  // come through this slot (see src/brand-icon.tsx for why it is inline data).
  app.slots.experimental_providerIcon({
    providerKind: "agent",
    providerId: "maki",
    icon: MakiBrandIcon,
  });
  app.slots.settingsSection({
    id: "opencode-port",
    title: "Port providers to maki",
    component: PortSection,
  });
});
