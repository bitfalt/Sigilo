// One person, one passkey, two employers (dev Convex deployment):
//   pnpm smoke:two-employers
// María joins Acme and activates her Income Passport, then joins Meca with the same account:
// the passport carries over without a second activation, and both employers see it.

import {
  commitment,
  deriveAccountKeys,
  deriveEvmPrivateKey,
  derivePassportSecret,
  derivePayslipKeypair,
  encodePaymentProfile,
  fieldToHex,
  paymentProfile,
} from "@sigilo/core";
import { toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { api } from "../convex/_generated/api.js";
import { check, randomPrf, signIn, verifiedEmployer } from "./lib/testnet.mjs";

const acme = await verifiedEmployer("Acme Labs (two-employer test)", 0n);
const meca = await verifiedEmployer("Meca (two-employer test)", 0n);

const prf = randomPrf();
const keys = deriveAccountKeys(prf);
const maria = await signIn(privateKeyToAccount(toHex(deriveEvmPrivateKey(prf))));
await maria.mutation(api.accounts.register, {
  paymentProfile: encodePaymentProfile(paymentProfile(keys.stealth)),
  receiptPublicKey: toHex(derivePayslipKeypair(prf).publicKey),
});

const first = await acme.invite("María", 240_000);
const joinedAcme = await maria.mutation(api.employees.acceptInvite, { inviteCodeHash: first.hash });
check("joined Acme; passport not active yet", !joinedAcme.passportActive);
const c = fieldToHex(commitment(derivePassportSecret(randomPrf())));
await maria.mutation(api.employees.setPassportCommitment, { commitment: c });

const second = await meca.invite("María", 90_000);
const joinedMeca = await maria.mutation(api.employees.acceptInvite, {
  inviteCodeHash: second.hash,
});
check("joined Meca with the same account; passport carried over", joinedMeca.passportActive);

const employers = await maria.query(api.employees.myEmployers, {});
check(
  "María sees both employers, passport active with both",
  employers.length === 2 && employers.every((e) => e.passportActive),
  employers.map((e) => e.employerName).join(", "),
);
const [acmeRow] = await acme.client.query(api.employees.list, {});
const [mecaRow] = await meca.client.query(api.employees.list, {});
check(
  "each employer sees her as active with an Income Passport",
  acmeRow?.passportCommitment === c && mecaRow?.passportCommitment === c,
);
console.log("\nAll checks passed.");
