"use client";

// The unlocked person's account id, registering their public keys first if needed (idempotent).

import { useConvexAuth, useMutation } from "convex/react";
import { useEffect, useState } from "react";

import type { WorkerKeys } from "@/lib/identity";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export function useRegisteredAccount(keys: WorkerKeys | null): Id<"accounts"> | null {
  const { isAuthenticated } = useConvexAuth();
  const register = useMutation(api.accounts.register);
  const [account, setAccount] = useState<Id<"accounts"> | null>(null);

  useEffect(() => {
    if (!keys || !isAuthenticated || account) return;
    let cancelled = false;
    register({ paymentProfile: keys.paymentProfile, receiptPublicKey: keys.receiptPublicKey })
      .then((id) => !cancelled && setAccount(id))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [keys, isAuthenticated, account, register]);

  return account;
}
