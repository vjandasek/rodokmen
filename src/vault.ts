/**
 * Password encryption of the published family data (Web Crypto, so the same code runs in the
 * browser and in the Node publish script): AES-GCM with a key derived from the password by
 * PBKDF2-SHA256. The encrypted file is public, so the password's strength is the whole protection.
 */

/** The encrypted data as embedded in the published page. */
export interface Vault {
  version: 1;
  /** PBKDF2-SHA256 iterations. */
  iterations: number;
  /** Base64. */
  salt: string;
  /** Base64, 12 bytes. */
  iv: string;
  /** Base64 ciphertext with the GCM tag. */
  data: string;
}

/** OWASP's 2023 recommendation for PBKDF2-SHA256. */
export const ITERATIONS = 600_000;

/**
 * The password as compared: trimmed, inner whitespace collapsed, lower case, Unicode NFC. Phones
 * capitalise the first letter and add spaces by themselves; this keeps that from locking anyone out.
 */
export function normalizePassword(password: string): string {
  return password.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Chunked: spreading a whole large array into fromCharCode overflows the stack in some browsers. */
function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** The AES key for a password and salt; extractable, so the viewer can remember it. */
export async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(normalizePassword(password)),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypts `text` with a fresh random salt and IV. */
export async function seal(text: string, password: string, iterations = ITERATIONS): Promise<Vault> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return { version: 1, iterations, salt: toBase64(salt), iv: toBase64(iv), data: toBase64(new Uint8Array(data)) };
}

/** The key for `vault` from a typed password (slow on purpose: PBKDF2). */
export function vaultKey(vault: Vault, password: string): Promise<CryptoKey> {
  return deriveKey(password, fromBase64(vault.salt), vault.iterations);
}

/** Decrypts with a key; rejects when the key is wrong (GCM authentication fails). */
export async function open(vault: Vault, key: CryptoKey): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(vault.iv) as BufferSource },
    key,
    fromBase64(vault.data) as BufferSource,
  );
  return new TextDecoder().decode(plain);
}

/** Key bytes for remembering on the device (base64), and back. */
export async function exportKey(key: CryptoKey): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
}

export function importKey(text: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromBase64(text) as BufferSource, 'AES-GCM', true, ['encrypt', 'decrypt']);
}
