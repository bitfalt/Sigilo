// Device-first WebAuthn client for Mera. Same requests as Mera's default browser client, plus:
// - create: authenticatorAttachment "platform", so the passkey lives on this device (iCloud
//   Keychain with Face ID / Touch ID, Google Password Manager with Android biometrics, Windows
//   Hello) instead of the browser offering a QR code or a security key first;
// - create and get: the WebAuthn L3 hint "client-device", for browsers that read hints.
// - the passkey's user handle can be set by the caller (Sigilo tags whose passkey it is) and is
//   reported back on sign-in.
// Passkeys still sync through the platform's keychain, so the stateless test keeps working.

import { MeraError, type WebAuthnClient } from "@category-labs/mera";

type PrfResults = { prf?: { enabled?: boolean; results?: { first?: BufferSource } } };

function bytes(source: BufferSource): Uint8Array {
  return source instanceof ArrayBuffer
    ? new Uint8Array(source.slice(0))
    : new Uint8Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
}

function publicKeyCredential(credential: Credential | null): PublicKeyCredential {
  if (credential?.type !== "public-key") {
    throw new MeraError(
      "PASSKEY_OPERATION_FAILED",
      "WebAuthn returned no usable public key credential",
    );
  }
  return credential as PublicKeyCredential;
}

export interface DeviceClientOptions {
  /** Replaces Mera's random user handle on create. */
  userId?: Uint8Array;
  /** Receives the chosen passkey's user handle on sign-in (null if the browser hides it). */
  onUserHandle?(handle: Uint8Array | null): void;
}

export const deviceWebAuthnClient = (client: DeviceClientOptions = {}): WebAuthnClient => ({
  async createCredential(request) {
    const options = {
      rp: request.rp,
      user: client.userId ? { ...request.user, id: client.userId } : request.user,
      challenge: request.challenge,
      pubKeyCredParams: request.algorithms.map((alg) => ({ type: "public-key" as const, alg })),
      ...(request.timeout !== undefined ? { timeout: request.timeout } : {}),
      attestation: request.attestation,
      authenticatorSelection: {
        authenticatorAttachment: "platform" as const,
        residentKey: request.residentKey,
        requireResidentKey: true,
        userVerification: request.userVerification,
      },
      hints: ["client-device"],
      extensions: { prf: { eval: { first: request.prfSalt } } },
    };
    const credential = publicKeyCredential(
      await navigator.credentials.create({
        publicKey: options as PublicKeyCredentialCreationOptions,
      }),
    );
    const response = credential.response as AuthenticatorAttestationResponse;
    const prf = (credential.getClientExtensionResults() as PrfResults).prf;
    const first = prf?.results?.first;
    return {
      credentialId: new Uint8Array(credential.rawId),
      ...(typeof response.getTransports === "function"
        ? { transports: response.getTransports() }
        : {}),
      prfEnabled: prf?.enabled === true,
      ...(first ? { prfOutput: bytes(first) } : {}),
    };
  },

  async getCredential(request) {
    const { allowCredential } = request;
    const options = {
      rpId: request.rpId,
      challenge: request.challenge,
      ...(request.timeout !== undefined ? { timeout: request.timeout } : {}),
      userVerification: request.userVerification,
      hints: ["client-device"],
      extensions: { prf: { eval: { first: request.prfSalt } } },
      ...(allowCredential
        ? {
            allowCredentials: [
              {
                id: allowCredential.credentialId,
                type: "public-key" as const,
                ...(allowCredential.transports ? { transports: allowCredential.transports } : {}),
              },
            ],
          }
        : {}),
    };
    const credential = publicKeyCredential(
      await navigator.credentials.get({ publicKey: options as PublicKeyCredentialRequestOptions }),
    );
    const handle = (credential.response as AuthenticatorAssertionResponse).userHandle;
    client.onUserHandle?.(handle ? bytes(handle) : null);
    const first = (credential.getClientExtensionResults() as PrfResults).prf?.results?.first;
    return {
      credentialId: new Uint8Array(credential.rawId),
      ...(first ? { prfOutput: bytes(first) } : {}),
    };
  },
});
