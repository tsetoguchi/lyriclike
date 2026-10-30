// Safari before 15.4 and Chrome before 92 have no crypto.randomUUID. Without
// it, storage.js throws as it loads and takes saving and sharing down with
// it, so this fills it in before any app script runs.
(function addRandomUuidFallback() {
  'use strict';

  const BYTE_COUNT = 16;
  // RFC 4122: byte 6 carries the version (4), byte 8 the variant (10xx).
  const VERSION_BYTE = 6;
  const VERSION_BITS = 0x40;
  const VARIANT_BYTE = 8;
  const VARIANT_BITS = 0x80;
  const LOW_NIBBLE = 0x0f;
  const LOW_SIX_BITS = 0x3f;
  const GROUP_ENDS = [4, 6, 8, 10];

  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.randomUUID === 'function') return;

  function toHex(byte) {
    return byte.toString(16).padStart(2, '0');
  }

  function randomUuid() {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(BYTE_COUNT));
    bytes[VERSION_BYTE] = (bytes[VERSION_BYTE] & LOW_NIBBLE) | VERSION_BITS;
    bytes[VARIANT_BYTE] = (bytes[VARIANT_BYTE] & LOW_SIX_BITS) | VARIANT_BITS;
    return Array.from(bytes, (byte, index) =>
      (GROUP_ENDS.includes(index) ? '-' : '') + toHex(byte)).join('');
  }

  cryptoApi.randomUUID = randomUuid;
})();
