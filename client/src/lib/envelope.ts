/**
 * Displaying a sealed blob.
 *
 * `fakeSeal` used to live here, producing something ciphertext-shaped for the
 * fixtures to render. It is gone: real sealed envelopes now come from
 * packages/crypto and travel through the transport, so a hand-rolled scrambler
 * labelled "NOT encryption" has nothing left to do and every reason not to be
 * sitting in the tree where someone could reach for it.
 */

/** Formats a blob for display: base64 wrapped so it fills the bubble. */
export function previewCiphertext(ciphertext: string, maxLength = 240): string {
  return ciphertext.length > maxLength
    ? ciphertext.slice(0, maxLength) + '…'
    : ciphertext;
}
