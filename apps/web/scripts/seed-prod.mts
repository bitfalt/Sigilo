// Background activity for the production demo (sigilo.work): a few verified companies paying
// their teams for the last three months, real AUSD payouts on Monad testnet, plus a couple of
// send-homes. Everyone here is a script-held test identity; nobody can sign in as them.
//   NEXT_PUBLIC_CONVEX_URL=https://bold-marlin-213.convex.cloud \
//   NEXT_PUBLIC_CONVEX_SITE_URL=https://bold-marlin-213.convex.site AUTO_VERIFY=1 \
//   pnpm tsx --env-file=.env.local scripts/seed-prod.mts

import {
  AGORA_TESTNET,
  commitment,
  currentPeriod,
  decryptReceipt,
  deriveAccountKeys,
  deriveEvmPrivateKey,
  derivePassportSecret,
  derivePayslipKeypair,
  encodePaymentProfile,
  fieldToHex,
  oneTimeAccountKey,
  paymentProfile,
  prepareSendHome,
} from "@sigilo/core";
import { ConvexHttpClient } from "convex/browser";
import { parseAbi, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { api } from "../convex/_generated/api.js";
import {
  ausdBalance,
  chain,
  check,
  cloudUrl,
  randomPrf,
  signIn,
  verifiedEmployer,
} from "./lib/testnet.mjs";

if (!cloudUrl.includes("bold-marlin-213"))
  throw new Error("point NEXT_PUBLIC_CONVEX_URL at production");

const COMPANIES: { name: string; team: [string, number][] }[] = [
  {
    name: "Lumen Studio",
    team: [
      ["Andrea Vargas", 2_600],
      ["Diego Mora", 2_150],
      ["Valeria Rojas", 3_100],
      ["Kevin Solano", 1_850],
      ["Paula Jiménez", 2_400],
    ],
  },
  {
    name: "Nube Digital",
    team: [
      ["Sofía Castro", 1_950],
      ["Esteban Quirós", 2_750],
      ["Camila Herrera", 2_200],
      ["Mateo Alvarado", 1_700],
    ],
  },
  {
    name: "Pacífico Dev",
    team: [
      ["Gabriela Méndez", 3_400],
      ["Luis Fernández", 2_900],
      ["Natalia Brenes", 2_050],
    ],
  },
  {
    name: "Volcán Data",
    team: [
      ["Isabel Chaves", 2_300],
      ["Andrés Ulate", 2_650],
      ["Daniela Porras", 1_900],
      ["José Salas", 2_500],
      ["Mariana Vega", 2_100],
      ["Ricardo León", 3_050],
    ],
  },
];

async function person() {
  const prf = randomPrf();
  const keys = deriveAccountKeys(prf);
  const receipts = derivePayslipKeypair(prf);
  const client = await signIn(privateKeyToAccount(toHex(deriveEvmPrivateKey(prf))));
  const account = await client.mutation(api.accounts.register, {
    paymentProfile: encodePaymentProfile(paymentProfile(keys.stealth)),
    receiptPublicKey: toHex(receipts.publicKey),
  });
  return { keys, receipts, client, account };
}

const workers: Awaited<ReturnType<typeof person>>[] = [];
const now = currentPeriod();
for (const company of COMPANIES) {
  const monthly = company.team.reduce((s, [, usd]) => s + usd, 0);
  const employer = await verifiedEmployer(
    company.name,
    BigInt(monthly) * 3n * 1_000_000n + 1_000_000n,
  );
  for (const [name, usd] of company.team) {
    const w = await person();
    const invite = await employer.invite(name, usd * 100);
    await w.client.mutation(api.employees.acceptInvite, { inviteCodeHash: invite.hash });
    await w.client.mutation(api.employees.setPassportCommitment, {
      commitment: fieldToHex(commitment(derivePassportSecret(randomPrf()))),
    });
    workers.push(w);
  }
  // Each person's own salary (pay() pays everyone the same, so pay per salary bucket).
  for (const period of [now - 2, now - 1]) {
    const status = await payTeam(employer, company, period);
    check(`${company.name} paid ${company.team.length} people for ${period}`, status === "done");
  }
}

async function payTeam(
  employer: Awaited<ReturnType<typeof verifiedEmployer>>,
  company: (typeof COMPANIES)[number],
  period: number,
) {
  // The demo helper pays one gross amount to everyone; use the team's median so pieces mix.
  const sorted = company.team.map(([, usd]) => usd).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return employer.pay(period, BigInt(median * 100));
}

// A couple of families receiving money from abroad.
const pairAbi = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])",
]);
const anonymous = new ConvexHttpClient(cloudUrl);
for (const [i, amount] of [150_000_000n, 80_000_000n].entries()) {
  const sender = workers[i * 3]!;
  const mom = await person();
  const pieces = [];
  for (const row of await sender.client.query(api.receipts.mine, {})) {
    const r = decryptReceipt(row.ciphertext, sender.receipts.secretKey);
    for (const p of r.pieces) {
      const k = oneTimeAccountKey(sender.keys.stealth, p.ephemeralPubKey);
      pieces.push({ privateKey: k.privateKey, balance: await ausdBalance(k.address) });
    }
  }
  const profile = (await anonymous.query(api.transfers.recipient, { account: mom.account }))!;
  const sent = await prepareSendHome({
    pieces,
    amount,
    recipient: profile,
    from: "Familia",
    quote: async (ausd) =>
      (
        await chain.readContract({
          address: AGORA_TESTNET.ctkAusdPair,
          abi: pairAbi,
          functionName: "getAmountsOut",
          args: [ausd, [AGORA_TESTNET.ausd, AGORA_TESTNET.ctk]],
        })
      )[1]!,
  });
  await anonymous.action(api.transfers.sendHome, {
    auths: sent.auths.map((a) => ({
      from: a.from,
      value: a.value.toString(),
      signature: a.signature,
    })),
    intent: {
      to: sent.intent.to,
      total: sent.intent.total.toString(),
      minOut: sent.intent.minOut.toString(),
      deadline: Number(sent.intent.deadline),
      salt: sent.intent.salt,
    },
    recipient: mom.account,
    receipt: sent.receipt,
  });
  check(`send home #${i + 1} delivered`, true);
}
console.log("\nSeeded production.");
