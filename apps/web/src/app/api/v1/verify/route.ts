import { monad } from "@monad-crypto/mpp/server";
import { AGORA_TESTNET } from "@sigilo/core/constants";
import { SIGILO_TESTNET } from "@sigilo/core/deployments";
import { decodePassportPublicInputs, PASSPORT_PUBLIC_INPUT_COUNT } from "@sigilo/core/passport";
import {
  attestationFor,
  attestationTypedData,
  SIGILO_OPERATOR,
  type SignedAttestation,
  VERIFY_PRICE_USD,
} from "@sigilo/core/verify";
import { Mppx } from "mppx/nextjs";
import { type Hex, parseAbi } from "viem";

import { monadClient, operatorAccount, publicClient, requireEnv } from "@/lib/server/accounts";

// Sigilo Verify API (SPEC.md F6). Each call is paid with MPP: $0.10 in AUSD, pulled with an
// ERC-3009 authorization, so callers need digital dollars but no gas. It checks an Income
// Passport against IncomePassportVerifier (which also checks the registry root is published) and
// answers with an EIP-712 attestation signed by the Sigilo operator (core/verify.ts).

const verifierAbi = parseAbi([
  "function verify(bytes proof, bytes32[] publicInputs) view returns (bool)",
]);
const HEX = /^0x[0-9a-fA-F]+$/;
const HEX32 = /^0x[0-9a-fA-F]{64}$/;

type Handler = (request: Request) => Promise<Response> | Response;
let paidVerify: Handler | undefined;

// Created on first request so builds and previews don't need the keys.
function handler(): Handler {
  if (paidVerify) return paidVerify;
  const operator = operatorAccount();
  const mppx = Mppx.create({
    methods: [
      monad({
        account: operator,
        recipient: operator.address,
        currency: AGORA_TESTNET.ausd,
        decimals: 6,
        testnet: true,
        getClient: monadClient,
      }),
    ],
    secretKey: requireEnv("MPP_SECRET_KEY"),
    realm: "sigilo.work",
  });
  paidVerify = mppx.charge({ amount: VERIFY_PRICE_USD, description: "Income Passport check" })(
    verify,
  );
  return paidVerify;
}

async function verify(request: Request): Promise<Response> {
  let body: { proof?: unknown; publicInputs?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON: { proof, publicInputs }" }, { status: 400 });
  }
  const { proof, publicInputs } = body;
  if (
    typeof proof !== "string" ||
    !HEX.test(proof) ||
    !Array.isArray(publicInputs) ||
    publicInputs.length !== PASSPORT_PUBLIC_INPUT_COUNT ||
    !publicInputs.every((x) => typeof x === "string" && HEX32.test(x))
  ) {
    return Response.json(
      { error: `Expected a hex proof and ${PASSPORT_PUBLIC_INPUT_COUNT} bytes32 public inputs` },
      { status: 400 },
    );
  }

  const valid = await publicClient().readContract({
    address: SIGILO_TESTNET.passportVerifier,
    abi: verifierAbi,
    functionName: "verify",
    args: [proof as Hex, publicInputs as Hex[]],
  });
  const attestation = attestationFor(
    decodePassportPublicInputs(publicInputs as string[]),
    valid,
    Math.floor(Date.now() / 1000),
  );
  const signature = await operatorAccount().signTypedData(attestationTypedData(attestation));
  return Response.json({ attestation, signature } satisfies SignedAttestation);
}

export async function POST(request: Request): Promise<Response> {
  return handler()(request);
}

/** Free description of the paid endpoint, for people and agents. */
export async function GET(): Promise<Response> {
  return Response.json({
    name: "Sigilo Verify",
    description:
      "Checks an Income Passport (proof that someone earned at least a threshold for 3 consecutive months from a verified employer) and returns a signed attestation.",
    price: { amount: VERIFY_PRICE_USD, currency: "AUSD", network: "Monad testnet", via: "MPP" },
    request: { method: "POST", body: { proof: "0x…", publicInputs: ["bytes32 x 8"] } },
    response: { attestation: "IncomeAttestation (EIP-712)", signature: "0x…" },
    signer: SIGILO_OPERATOR,
  });
}
