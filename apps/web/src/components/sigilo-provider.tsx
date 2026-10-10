"use client";

// App-wide state: the unlocked keys (memory only) and a Convex client authenticated with a session
// token signed by the Mera session. Locking ends the session, wipes keys and signs out of Convex.

import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import { CONVEX_URL } from "@/lib/config";
import { type Keys, lock as lockKeys } from "@/lib/identity";
import { type SessionToken, signIn } from "@/lib/session";

interface SigiloState {
  keys: Keys | null;
  setKeys(keys: Keys): void;
  lock(): void;
  /** A Convex session token for the unlocked keys (signed in the Mera session, no prompt). */
  getToken(forceRefresh: boolean): Promise<string | null>;
}

const SigiloContext = createContext<SigiloState | null>(null);

export function useSigilo(): SigiloState {
  const state = useContext(SigiloContext);
  if (!state) throw new Error("useSigilo must be used inside <SigiloProvider>");
  return state;
}

/** The unlocked keys of the given role, or null. */
export function useKeys<R extends Keys["role"]>(role: R): Extract<Keys, { role: R }> | null {
  const { keys } = useSigilo();
  return keys?.role === role ? (keys as Extract<Keys, { role: R }>) : null;
}

/** Convex `useAuth` adapter, reading the keys from context. */
function useSigiloAuth() {
  const { keys, getToken } = useSigilo();
  const fetchAccessToken = useCallback(
    ({ forceRefreshToken }: { forceRefreshToken: boolean }) => getToken(forceRefreshToken),
    [getToken],
  );
  return useMemo(
    () => ({ isLoading: false, isAuthenticated: keys !== null, fetchAccessToken }),
    [keys, fetchAccessToken],
  );
}

const convex = new ConvexReactClient(CONVEX_URL || "https://placeholder.convex.cloud");

export function SigiloProvider({ children }: { children: ReactNode }) {
  const [keys, setKeysState] = useState<Keys | null>(null);
  const keysRef = useRef<Keys | null>(null);
  const tokenRef = useRef<{ address: string; token: SessionToken } | null>(null);

  const setKeys = useCallback((next: Keys) => {
    const prev = keysRef.current;
    if (prev && prev !== next) lockKeys(prev);
    keysRef.current = next;
    tokenRef.current = null;
    setKeysState(next);
  }, []);

  const lock = useCallback(() => {
    if (keysRef.current) lockKeys(keysRef.current);
    keysRef.current = null;
    tokenRef.current = null;
    setKeysState(null);
  }, []);

  const getToken = useCallback(
    async (forceRefresh: boolean) => {
      if (!keys) return null;
      const cached = tokenRef.current;
      const fresh =
        cached?.address === keys.address && cached.token.expiresAt - Date.now() > 60_000;
      if (!forceRefresh && fresh) return cached!.token.token;
      const token = await signIn(keys.account);
      tokenRef.current = { address: keys.address, token };
      return token.token;
    },
    [keys],
  );

  const state = useMemo(() => ({ keys, setKeys, lock, getToken }), [keys, setKeys, lock, getToken]);

  return (
    <SigiloContext.Provider value={state}>
      <ConvexProviderWithAuth client={convex} useAuth={useSigiloAuth}>
        {children}
      </ConvexProviderWithAuth>
    </SigiloContext.Provider>
  );
}
