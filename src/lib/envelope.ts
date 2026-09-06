/**
 * Placeholder for the real crypto layer.
 *
 * The backend work (libsodium `crypto_box`, key registry, device keys) lands
 * behind this module. Everything the UI needs is already shaped the way the
 * real implementation will be: plaintext in, opaque base64 out, and a decrypt
 * that is allowed to fail. Swapping in libsodium-wrappers should not require
 * touching a single component.
 */

/** Stand-in for a sealed envelope so the "what the server sees" view has
 *  something realistic to render. NOT encryption — do not ship this. */
export function fakeSeal(plaintext: string): string {
  const bytes = new TextEncoder().encode(plaintext);
  const scrambled = Array.from(bytes, (b, i) => b ^ ((i * 37 + 11) & 0xff));
  const binary = String.fromCharCode(...scrambled);
  // Nonce-ish prefix so the blobs look like real sealed boxes.
  const nonce = Math.random().toString(36).slice(2, 10);
  return btoa(nonce + binary);
}

/** Formats a blob for display: base64 wrapped so it fills the bubble. */
export function previewCiphertext(ciphertext: string, maxLength = 240): string {
  return ciphertext.length > maxLength
    ? ciphertext.slice(0, maxLength) + '…'
    : ciphertext;
}
