import { useCallback, useEffect, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "@/server";

export type PersonasRpc = ReturnType<typeof usePersonasRpc>;

export function usePersonasRpc() {
  return useRpc<typeof rpcContract>();
}

interface QueryState<T> {
  data: T | null;
  error: string | null;
  isLoading: boolean;
}

/**
 * Loads once per `key` change and again whenever the backend publishes a
 * "personas" realtime signal, so a second window stays in sync.
 */
export function useQuery<T>(
  load: () => Promise<T>,
  key: string,
): QueryState<T> & { reload: () => void } {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<QueryState<T>>({
    data: null,
    error: null,
    isLoading: true,
  });

  const reload = useCallback(() => {
    setNonce((current) => current + 1);
  }, []);

  useRealtime("personas", reload);

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, isLoading: true }));
    load().then(
      (data) => {
        if (cancelled) return;
        setState({ data, error: null, isLoading: false });
      },
      (error: unknown) => {
        if (cancelled) return;
        setState({
          data: null,
          error: error instanceof Error ? error.message : String(error),
          isLoading: false,
        });
      },
    );
    return () => {
      cancelled = true;
    };
    // `load` is recreated every render; `key` is the real dependency.
  }, [key, nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...state, reload };
}
