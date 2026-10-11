import { createTestIndexer } from "envio";
import { describe, it } from "vitest";

import { at, CHAIN_ID, event, txHash } from "./helpers";

const REGISTRY = "0xba306ac85e31d43b92bc1915ff84354a08140a8b" as const;
const employerA = `0x${"0a".repeat(32)}` as const;
const employerB = `0x${"0b".repeat(32)}` as const;

const registryEvent = (step: number, name: string, params: Record<string, unknown>) =>
  event("SigiloRegistry", name, step, params, REGISTRY);

describe("registry", () => {
  it("tracks roots and currently verified employers", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN_ID]: {
          simulate: [
            registryEvent(1, "EmployerVerificationSet", { employerId: employerA, verified: true }),
            registryEvent(2, "RootPublished", { root: `0x${"11".repeat(32)}`, index: 0n }),
            registryEvent(3, "EmployerVerificationSet", { employerId: employerB, verified: true }),
            registryEvent(4, "RootPublished", { root: `0x${"22".repeat(32)}`, index: 1n }),
            registryEvent(5, "EmployerVerificationSet", { employerId: employerA, verified: false }),
          ],
        },
      },
    });
    t.expect(await indexer.NetworkStats.getOrThrow("sigilo")).toMatchObject({
      verifiedEmployers: 1,
      rootsPublished: 2,
      latestRoot: `0x${"22".repeat(32)}`,
    });
    t.expect(await indexer.EmployerVerification.getOrThrow(employerA)).toMatchObject({
      verified: false,
      firstVerifiedAt: at(1).timestamp,
      changes: 2,
    });
    t.expect(await indexer.RegistryRoot.getOrThrow("1")).toMatchObject({
      index: 1,
      txHash: txHash("SigiloRegistry-RootPublished-4"),
    });
  });
});
