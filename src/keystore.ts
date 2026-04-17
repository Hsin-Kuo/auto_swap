import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { promptSecret } from "./prompt.js";

const KEYSTORE_PATH = "./keystore.enc";
const ALGORITHM = "aes-256-gcm";
const SALT_LEN = 32;
const IV_LEN = 16;
const TAG_LEN = 16;
const SCRYPT_N = 2 ** 14;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
}

function encrypt(plaintext: string, password: string): Buffer {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(password, salt);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([salt, iv, tag, encrypted]);
}

function decrypt(data: Buffer, password: string): string {
  const salt = data.subarray(0, SALT_LEN);
  const iv = data.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag = data.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const ciphertext = data.subarray(SALT_LEN + IV_LEN + TAG_LEN);

  const key = deriveKey(password, salt);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export async function encryptAndSave(privateKeyBase58: string): Promise<void> {
  const password = await promptSecret("Set keystore password: ");
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  const confirm = await promptSecret("Confirm password: ");
  if (password !== confirm) {
    throw new Error("Passwords do not match.");
  }

  const encrypted = encrypt(privateKeyBase58, password);
  writeFileSync(KEYSTORE_PATH, encrypted);
  console.log(`Keystore saved to ${KEYSTORE_PATH}`);
}

export async function loadFromKeystore(): Promise<string> {
  if (!existsSync(KEYSTORE_PATH)) {
    throw new Error(
      `Keystore not found at ${KEYSTORE_PATH}. Run \`npm run setup\` to create one.`,
    );
  }

  const password = await promptSecret("Enter keystore password: ");
  const data = readFileSync(KEYSTORE_PATH);

  try {
    return decrypt(data, password);
  } catch {
    throw new Error("Wrong password or corrupted keystore.");
  }
}

export function keystoreExists(): boolean {
  return existsSync(KEYSTORE_PATH);
}
