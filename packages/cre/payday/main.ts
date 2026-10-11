// Entry point of the Sigilo "payday" CRE workflow. The logic lives in workflow.ts: Javy (the
// QuickJS-to-WASM compiler) rejects exported functions with parameters in the entry module.

import { Runner } from "@chainlink/cre-sdk";

import { type Config, configSchema, initWorkflow } from "./workflow";

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}
