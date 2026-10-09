#!/usr/bin/env bash
# Compile the income passport circuit and regenerate everything derived from it:
#   - artifacts/income_passport.json  (ACIR + ABI, consumed by noir_js in the browser/server)
#   - artifacts/vk                     (EVM-target verification key)
#   - ../contracts/src/generated/HonkVerifier.sol (UltraHonk ZK verifier for Monad)
# Toolchain pins (must match the JS packages): nargo 1.0.0-rc.2, bb 5.2.1.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CIRCUIT="$ROOT/income_passport"
ARTIFACTS="$ROOT/artifacts"
VERIFIER="$ROOT/../contracts/src/generated/HonkVerifier.sol"

cd "$CIRCUIT"
nargo compile
bb write_vk -b target/income_passport.json -o target -t evm
bb write_solidity_verifier -k target/vk -o "$VERIFIER" -t evm

mkdir -p "$ARTIFACTS"
cp target/income_passport.json "$ARTIFACTS/income_passport.json"
cp target/vk "$ARTIFACTS/vk"
echo "Built income_passport → $ARTIFACTS and $VERIFIER"
