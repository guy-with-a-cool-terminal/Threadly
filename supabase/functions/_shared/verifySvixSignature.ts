// Manual verification of Resend's webhook signatures, which use the Svix
// protocol: https://docs.svix.com/receiving/verifying-payloads/how-manual
//
// Implemented directly against Web Crypto instead of an SDK helper, since
// that's a small, stable, well-documented algorithm and avoids depending on
// an SDK method's exact Deno-compatible call shape for something security
// critical.
export async function verifySvixSignature(opts: {
  rawBody: string;
  svixId: string | null;
  svixTimestamp: string | null;
  svixSignature: string | null;
  secret: string; // "whsec_..."
}): Promise<boolean> {
  const { rawBody, svixId, svixTimestamp, svixSignature, secret } = opts;
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Replay protection: reject requests signed more than 5 minutes ago.
  const timestampSeconds = Number(svixTimestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(Date.now() / 1000 - timestampSeconds) > 300) return false;

  const secretBytes = base64Decode(secret.replace(/^whsec_/, ""));
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedContent),
  );
  const expected = base64Encode(new Uint8Array(signatureBytes));

  // Header format: space-separated "v1,<base64sig>" entries - Svix rotates
  // signing keys, so more than one may be present.
  const candidates = svixSignature
    .split(" ")
    .map((entry) => entry.split(",")[1])
    .filter((v): v is string => Boolean(v));

  return candidates.some((candidate) => timingSafeEqual(candidate, expected));
}

function base64Decode(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
