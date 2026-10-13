// bb-plugin-maki-agent-provider — a BB plugin frontend entry.
//
// A Settings section reporting the installed maki version and path per machine.
import { useEffect, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract, MakiStatusOutput } from "./src/contract";
import { MakiBrandIcon } from "./src/brand-icon";

type MachineStatus = MakiStatusOutput["machines"][number];

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

function MakiStatusSection() {
  const rpc = useRpc<typeof rpcContract>();
  const [status, setStatus] = useState<MakiStatusOutput | null>(null);

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

  return (
    <div className="space-y-3">
      {status === null ? null : status.machines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No connected machines right now.
        </p>
      ) : (
        <ul className="space-y-1">
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
    id: "maki-status",
    title: "maki",
    component: MakiStatusSection,
  });
});
