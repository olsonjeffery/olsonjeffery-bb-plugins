// Minimal direct RPC for callbacks that run outside React (palette and
// composer commands): the same POST /plugins/<id>/rpc/<method> endpoint the
// useRpc hook wraps, with the app-surface header the app's own client sends.
type RpcErrorBody = {
  ok?: unknown;
  result?: unknown;
  error?: { message?: unknown } | string | null;
};

function appSurface(): "desktop" | "web" {
  const desktop = (globalThis as Record<string, unknown>).bbDesktop;
  return desktop !== undefined ? "desktop" : "web";
}

export async function callRpcOutsideReact<T>(
  method: string,
  input?: unknown,
): Promise<T> {
  const response = await fetch(
    `/api/v1/plugins/${encodeURIComponent(PLUGIN_ID)}/rpc/${encodeURIComponent(method)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bb-app-surface": appSurface(),
      },
      body: JSON.stringify(input ?? null),
    },
  );
  const body = (await response.json().catch(() => null)) as RpcErrorBody | null;
  if (!response.ok || body?.ok !== true) {
    const structured = body?.error;
    const message =
      structured !== null &&
      typeof structured === "object" &&
      typeof structured.message === "string"
        ? structured.message
        : `RPC ${method} failed (${response.status})`;
    throw new Error(message);
  }
  return body.result as T;
}

export const PLUGIN_ID = "draft-stack";
