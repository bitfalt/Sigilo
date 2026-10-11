// SigiloRegistry: registry roots (one per payroll run of a verified employer) and employer
// verification. IncomePassportVerifier: on-chain passport attestations.

import { indexer } from "envio";

import { loadStats } from "../lib/stats";

indexer.onEvent(
  { contract: "SigiloRegistry", event: "RootPublished" },
  async ({ event, context }) => {
    const stats = await loadStats(context);
    const index = Number(event.params.index);
    context.RegistryRoot.set({
      id: String(index),
      index,
      root: event.params.root,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      txHash: event.transaction.hash,
    });
    context.NetworkStats.set({
      ...stats,
      rootsPublished: stats.rootsPublished + 1,
      latestRoot: event.params.root,
      updatedAt: event.block.timestamp,
    });
  },
);

indexer.onEvent(
  { contract: "SigiloRegistry", event: "EmployerVerificationSet" },
  async ({ event, context }) => {
    const id = event.params.employerId;
    const [stats, previous] = await Promise.all([
      loadStats(context),
      context.EmployerVerification.get(id),
    ]);
    const { verified } = event.params;
    const was = previous?.verified ?? false;
    context.EmployerVerification.set({
      id,
      verified,
      firstVerifiedAt: previous?.firstVerifiedAt ?? (verified ? event.block.timestamp : undefined),
      updatedAt: event.block.timestamp,
      changes: (previous?.changes ?? 0) + 1,
    });
    context.NetworkStats.set({
      ...stats,
      verifiedEmployers: stats.verifiedEmployers + Number(verified) - Number(was),
      updatedAt: event.block.timestamp,
    });
  },
);

indexer.onEvent(
  { contract: "IncomePassportVerifier", event: "PassportVerified" },
  async ({ event, context }) => {
    const stats = await loadStats(context);
    const p = event.params;
    context.PassportAttestation.set({
      id: `${event.transaction.hash}-${event.logIndex}`,
      scope: p.scope.toString(),
      pseudonym: p.pseudonym.toString(),
      threshold: p.threshold,
      firstPeriod: Number(p.firstPeriod),
      nonce: p.nonce.toString(),
      registryRoot: p.registryRoot,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      txHash: event.transaction.hash,
    });
    context.NetworkStats.set({
      ...stats,
      passportAttestations: stats.passportAttestations + 1,
      updatedAt: event.block.timestamp,
    });
  },
);
