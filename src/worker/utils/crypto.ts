const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const KEY_LENGTH_BITS = 256;
const HASH_PREFIX = 'pbkdf2_sha256';

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function deriveKeyBytes(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    KEY_LENGTH_BITS
  );

  return new Uint8Array(derivedBits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const derived = await deriveKeyBytes(password, salt, PBKDF2_ITERATIONS);
  return `${HASH_PREFIX}$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(derived)}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== HASH_PREFIX) {
    return false;
  }
  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 10_000 || iterations > 1_000_000) {
    return false;
  }

  try {
    const salt = hexToBytes(parts[2]);
    const expected = hexToBytes(parts[3]);
    const actual = await deriveKeyBytes(password, salt, iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateUnambiguousCode(groups: number, groupLength: number): string {
  const parts: string[] = [];
  for (let group = 0; group < groups; group += 1) {
    const bytes = crypto.getRandomValues(new Uint8Array(groupLength));
    let text = '';
    for (let index = 0; index < groupLength; index += 1) {
      text += RECOVERY_ALPHABET[bytes[index] & 31];
    }
    parts.push(text);
  }
  return parts.join('-');
}

export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]+/g, '').toUpperCase();
}

export async function hashRecoveryCode(secret: string, context: string, normalizedCode: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${context}:${normalizedCode}`));
  return bytesToHex(new Uint8Array(signature));
}

export function verifyRecoveryCodeHash(expectedHex: string, candidateHex: string): boolean {
  try {
    const expected = hexToBytes(expectedHex);
    const candidate = hexToBytes(candidateHex);
    if (expected.length !== candidate.length) return false;
    return timingSafeEqual(expected, candidate);
  } catch {
    return false;
  }
}
