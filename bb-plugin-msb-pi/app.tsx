// bb-plugin-msb-pi — the page.
//
// One nav panel over the shared RPC query read: a card per machine
// (pi + msb versions, origins, release lists) and the change history.
// Background probe cycles announce themselves over realtime, so the
// page refetches without a manual trigger; a completed refresh also
// refetches through tag invalidation.
import {
  definePluginApp,
  experimental_Icon as Icon,
  experimental_useRpcMutation,
  experimental_useRpcQuery,
  useRealtime,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import { formatAgo } from "./lib/ago";
import { rpcContract, REALTIME_CHANNEL } from "./contract";
import type { MachineState, ToolStatus, WatchOutput } from "./snapshot";
import "./app.css";

const INTERVAL = { min: 1, max: 720, fallback: 15 } as const;

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "watch",
    title: "MSB + pi",
    icon: "Activity",
    path: "msb-pi",
    component: MsbPiPage,
  });
});

function MsbPiPage() {
  const watch = experimental_useRpcQuery({ contract: rpcContract, method: "watch", input: null });
  const refreshAll = experimental_useRpcMutation({ contract: rpcContract, method: "refresh" });
  const settings = useSettings();

  const interval = readInterval(settings.values);
  const state = watch.data;
  const generating = watch.isLoading && !state;

  return (
    <div className="msp-page">
      <div className="msp-header">
        <div className="msp-sub">
          {state
            ? describeWatch(state, interval)
            : "Installed microsandbox (msb) and pi versions, watched per machine."}
        </div>
        <div className="msp-actions">
          <button
            type="button"
            className="msp-btn"
            disabled={refreshAll.isPending}
            onClick={() => void refreshAll.mutate({})}
          >
            <IconSpin name="RotateCw" spin={refreshAll.isPending} />
            Refresh all
          </button>
        </div>
      </div>

      {generating ? <Skeleton /> : watch.error ? (
        <div className="msp-fatal" role="alert">
          Couldn't load the watch state: {watch.error.message}
          <button type="button" className="msp-btn" onClick={() => void watch.refetch()}>
            Retry
          </button>
        </div>
      ) : state ? (
        <>
          {state.machines.length === 0 ? <EmptyMachines /> : (
            <div className="msp-machines">
              {state.machines.map((machine) => (
                <MachineCard
                  key={machine.hostId}
                  machine={machine}
                  refreshing={refreshAll.isPending}
                  onRefresh={() => void refreshAll.mutate({ hostIds: [machine.hostId] })}
                />
              ))}
            </div>
          )}
          <HistoryList history={state.history} />
        </>
      ) : null}
    </div>
  );
}

function readInterval(values: Record<string, string | number | boolean> | undefined): number {
  const raw = typeof values?.intervalMinutes === "number" ? values.intervalMinutes : INTERVAL.fallback;
  return Math.max(INTERVAL.min, Math.min(INTERVAL.max, Math.round(raw)));
}

function describeWatch(state: WatchOutput, interval: number): string {
  const connected = state.machines.filter((machine) => machine.connected).length;
  const parts = [
    `${state.machines.length} machine(s), ${connected} connected`,
    `re-probes every ${interval}m`,
  ];
  const latest = state.machines.reduce<number | null>((acc, machine) => {
    const at = machine.snapshot?.checkedAt ?? null;
    return at && (acc === null || at > acc) ? at : acc;
  }, null);
  if (latest !== null) parts.push(`newest probe ${formatAgo(latest)}`);
  return parts.join("  ·  ");
}

function MachineCard({ machine, refreshing, onRefresh }: { machine: MachineState; refreshing: boolean; onRefresh: () => void }) {
  return (
    <section className="msp-card">
      <header className="msp-card-head">
        <span className={`msp-dot${machine.connected ? " on" : ""}`} aria-hidden="true" />
        <span className="msp-name">{machine.hostName || machine.hostId}</span>
        <span className="msp-meta">
          {machine.connected ? (machine.snapshot?.platform ?? "—") : "disconnected"}
          {machine.snapshot ? ` · checked ${formatAgo(machine.snapshot.checkedAt)}` : " · no probe yet"}
        </span>
        <button type="button" className="msp-mini" title={`Refresh ${machine.hostName}`} disabled={refreshing} onClick={onRefresh}>
          <IconSpin name="RotateCw" spin={refreshing} />
        </button>
      </header>
      <ToolBlock label="pi" status={machine.snapshot?.pi ?? null} />
      <ToolBlock label="msb" status={machine.snapshot?.msb ?? null} />
      {machine.lastError ? (
        <div className="msp-machine-error">
          Last refresh attempt failed {machine.lastErrorAt ? formatAgo(machine.lastErrorAt) : ""}: {machine.lastError}
        </div>
      ) : null}
    </section>
  );
}

function ToolBlock({ label, status }: { label: "pi" | "msb"; status: ToolStatus | null }) {
  if (!status) {
    return (
      <div className="msp-tool">
        <span className="msp-tool-label">{label}</span>
        <span className="msp-dead">no probe yet</span>
      </div>
    );
  }
  const state = status.version
    ? "found"
    : status.error
      ? "failed"
      : "absent";
  return (
    <div className={`msp-tool msp-${state}`}>
      <div className="msp-tool-line">
        <span className="msp-tool-label">{label}</span>
        {status.version ? (
          <span className="msp-ver">{status.version}</span>
        ) : state === "failed" ? (
          <span className="msp-ver msp-ver-bad">probe failed</span>
        ) : (
          <span className="msp-ver msp-ver-none">not found</span>
        )}
        {status.origin ? <span className="msp-chip">{status.origin}</span> : null}
      </div>
      {status.path ? <div className="msp-tool-sub">{status.path}</div> : null}
      {status.installedVersions && status.installedVersions.length > 1 ? (
        <div className="msp-tool-sub">
          installed:
          {status.installedVersions.map((version, index) => (
            <span
              key={version}
              className={`msp-release${index === 0 ? " active" : ""}`}
              title={index === 0 ? "newest install" : undefined}
            >
              {version}
            </span>
          ))}
        </div>
      ) : null}
      {status.detail ? <div className="msp-tool-sub">{status.detail}</div> : null}
      {status.error ? <div className="msp-tool-sub msp-err">error: {status.error}</div> : null}
    </div>
  );
}

function HistoryList({ history }: { history: WatchOutput["history"] }) {
  return (
    <section className="msp-history">
      <div className="msp-section-title">Version history</div>
      {history.length === 0 ? (
        <div className="msp-empty-note">
          Nothing recorded yet — changes appear here when a probed machine is found with a different version.
        </div>
      ) : (
        history.map((entry) => (
          <div key={`${entry.hostId}:${entry.tool}:${entry.at}`} className="msp-hist-row">
            <span className="msp-hist-tool">{entry.tool}</span>
            <span className={`msp-hist-kind ${entry.kind}`}>
              {entry.kind === "added" ? `appeared at ${entry.to}` : entry.kind === "removed" ? `${entry.from} now missing` : `${entry.from} → ${entry.to}`}
            </span>
            <span className="msp-hist-host">{entry.hostName || entry.hostId}</span>
            <span className="msp-hist-when">{formatAgo(entry.at)}</span>
          </div>
        ))
      )}
    </section>
  );
}

function EmptyMachines() {
  return (
    <div className="msp-card msp-empty">
      No machines are enrolled with this bb server yet. Enroll one (Settings → Machines) and this page picks it up on the next probe.
    </div>
  );
}

function Skeleton() {
  return (
    <div className="msp-machines" aria-busy="true">
      {[0, 1].map((row) => (
        <div key={row} className="msp-card msp-skel" />
      ))}
    </div>
  );
}

function IconSpin({ name, spin }: { name: string; spin: boolean }) {
  return <Icon name={name} className={`msp-icon${spin ? " spinning" : ""}`} aria-hidden="true" />;
}
