// bb-plugin-microsandbox-pi — the two-hop relay.
//
// One relay = one box = one in-box connector child. The relay hosts
// the unix listeners for the box's three vsock routes (msb's guest side
// dials them), connects the three accepted sockets into lanes, and
// pumps line-framed JSON between the lanes and the runtime lane:
//
//   runtime ⇄ [bridge routing] ⇄ relay ⇄ in-box bb provider-pi child
//
// All protocol lines pass verbatim both ways; the in-box child speaks
// the same Provider Bridge Protocol this bundle was built against.
import net from "node:net";
import { mkdirSync, rmSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export interface RelayHooks {
  /** A complete line from the in-box child (runtime-bound). */
  onLine: (line: string) => void;
  /** The in-box child's stderr text (diagnostics). */
  onErrorText: (text: string) => void;
  /** The child side vanished (bridge exited) or the box died. */
  onLost: (reason: string) => void;
  /** Lane-level diagnostics (journalled by the bridge when enabled). */
  onLaneEvent?: (note: string) => void;
}

export interface RelayOptions {
  socketsDir: string;
}

export interface Relay {
  /** Runtime → in-box. Buffers until all three lanes are live. */
  writeRuntimeToChild(line: string): void;
  end(): Promise<void>;
  /** All lanes bound, no loss reported. */
  isConnected(): boolean;
  readonly name: string;
}

/// msb may re-dial a route (its muxer accepted once per guest dial); a
/// lane carrying real traffic is protected from such replacement — a
/// quiet one is replaced so an eager reconnect always wins.
export type Lane = "in" | "out" | "err";
const LANES = ["in", "out", "err"] as const satisfies readonly Lane[];

interface RelayLife {
  bound: number;
  lost: boolean;
  done: boolean;
}

export async function startRelay(hooks: RelayHooks, options: RelayOptions, name: string): Promise<Relay> {
  const lanes = new Map<Lane, { socket: net.Socket; sawTraffic: boolean }>();
  const runtimeBuffer: string[] = [];

  function flush(buffered: boolean = runtimeBuffer.length > 0): void {
    const lane = lanes.get("in");
    if (lane === undefined || lane.socket.destroyed || !lane.socket.writable) return;
    if (buffered) {
      while (runtimeBuffer.length > 0) {
        const line = runtimeBuffer.shift();
        if (line !== undefined) lane.socket.write(`${line}\n`);
      }
    }
  }

  function markLost(reason: string, lane: Lane | null): void {
    if (life.lost || life.done) return;
    life.lost = true;
    hooks.onLost(reason + (lane === null ? "" : ` (${lane})`));
  }

  function bind(lane: Lane, socket: net.Socket): void {
    const previous = lanes.get(lane);
    if (previous !== undefined && !previous.socket.destroyed) previous.socket.destroy();
    hooks.onLaneEvent?.(`bind ${lane} replacedPrev=${previous !== undefined ? String(previous.sawTraffic) : "none"}`);
    socket.setNoDelay(true);
    lanes.set(lane, { socket, sawTraffic: false });
    socket.on("error", () => undefined);
    socket.on("data", (chunk: Buffer) => {
      const entry = lanes.get(lane);
      if (entry !== undefined) entry.sawTraffic = true;
      const text = (laneThreads.get(lane) ?? "") + chunk.toString("utf8");
      const parts = text.split("\n");
      laneThreads.set(lane, parts.pop() ?? "");
      for (const line of parts) {
        if (line.trim() === "") continue;
        if (lane === "out") hooks.onLine(line);
        else hooks.onErrorText(line);
      }
    });
    socket.on("close", () => {
      const entry = lanes.get(lane);
      hooks.onLaneEvent?.(`close ${lane} hadTraffic=${entry !== undefined && entry.socket === socket ? String(entry.sawTraffic) : "?"}`);
      if (entry !== undefined && entry.socket === socket && entry.sawTraffic) {
        markLost("lane closed after traffic", lane);
      } else if (entry !== undefined && entry.socket === socket && !entry.sawTraffic) {
        lanes.delete(lane);
      }
    });
    if (LANES.every((key) => lanes.has(key))) flush();
  }

  const laneThreads = new Map<Lane, string>();
  const life: RelayLife = { bound: 0, lost: false, done: false };

  // Listeners must be live BEFORE the box boots: the guest shim dials
  // once per lane, so a late listener would force the muxer into its
  // redial churn instead of a clean first dial.
  mkdirSync(dirname(join(options.socketsDir, "in.sock")), { recursive: true });

  const listeners = await new Promise<Map<Lane, net.Server>>((resolve, reject) => {
    const servers = new Map<Lane, net.Server>();
    let pending: number = LANES.length;
    let settled = false;
    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true;
      for (const server of servers.values()) server.close();
      reject(cause);
    };
    const done = () => {
      if (pending === 0 && !settled) {
        settled = true;
        resolve(servers);
      }
    };
    for (const lane of LANES) {
      const path = join(options.socketsDir, `${lane}.sock`);
      try {
        rmSyncClean(path);
      } catch {
        /* a stale socket owned by a dying relay; unlink and listen */
      }
      const server = net.createServer((socket) => {
        const entry = lanes.get(lane);
        if (entry !== undefined && !entry.socket.destroyed && entry.sawTraffic) {
          socket.destroy();
          return;
        }
        bind(lane, socket);
      });
      server.on("error", fail);
      server.listen(path, () => {
        servers.set(lane, server);
        pending -= 1;
        done();
      });
    }
  });

  return {
    name,
    isConnected() {
      return LANES.every((lane) => {
        const entry = lanes.get(lane);
        return entry !== undefined && !entry.socket.destroyed;
      }) && !life.lost && !life.done;
    },
    writeRuntimeToChild(line) {
      runtimeBuffer.push(line);
      hooks.onLaneEvent?.(`push lanes=${String(lanes.size)} buffer=${String(runtimeBuffer.length)} lost=${String(life.lost)}`);
      flush();
    },
    async end() {
      life.done = true;
      life.lost = true;
      for (const { socket } of lanes.values()) socket.destroy();
      for (const server of listeners.values()) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      await rm(join(options.socketsDir, "in.sock"), { force: true }).catch(() => undefined);
    },
  };
}

/** Unlink-sync helper (fire and forget errors). */
function rmSyncClean(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    /* unlink races are harmless at bootstrap */
  }
}

/** Wait until the relay reports fully connected or the timeout passes. */
export async function waitConnected(relay: Relay, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (relay.isConnected()) return true;
    await sleep(50);
  }
  return false;
}
