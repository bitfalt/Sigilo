import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

// Keep the demo faucet stocked with testnet AUSD (Agora's faucet has a global cooldown).
crons.interval("refill demo faucet", { hours: 1 }, internal.faucet.refill, {});

export default crons;
