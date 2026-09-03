import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  decryptContent,
  encryptContent,
  generateDek,
  loadMasterKey,
  safeEqual,
  unwrapDek,
  wrapDek,
} from "@/lib/crypto";

const master = randomBytes(32);
const STORAGE_KEY = "abc123def456";

describe("loadMasterKey", () => {
  it("accepts a 32-byte base64 key", () => {
    const raw = master.toString("base64");
    expect(loadMasterKey(raw).equals(master)).toBe(true);
  });

  it("rejects a missing key with a message that says how to make one", () => {
    expect(() => loadMasterKey(undefined)).toThrow(/MEDIA_MASTER_KEY/);
    expect(() => loadMasterKey(undefined)).toThrow(/randomBytes\(32\)/);
  });

  it("rejects a key of the wrong length", () => {
    expect(() => loadMasterKey(randomBytes(16).toString("base64"))).toThrow(
      /exactly 32 bytes/,
    );
  });
});

describe("content encryption", () => {
  it("round-trips bytes through AES-256-GCM", () => {
    const dek = generateDek();
    const plaintext = randomBytes(64 * 1024);

    const sealed = encryptContent(plaintext, dek);

    // The ciphertext must not be the plaintext, and must carry an IV and a tag.
    expect(sealed.ciphertext.equals(plaintext)).toBe(false);
    expect(sealed.iv).toHaveLength(12);
    expect(sealed.tag).toHaveLength(16);

    expect(decryptContent(sealed, dek).equals(plaintext)).toBe(true);
  });

  it("uses a fresh IV per call, so the same bytes never encrypt the same way", () => {
    const dek = generateDek();
    const plaintext = Buffer.from("same input, twice");
    const a = encryptContent(plaintext, dek);
    const b = encryptContent(plaintext, dek);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("refuses tampered ciphertext instead of returning garbage", () => {
    const dek = generateDek();
    const sealed = encryptContent(Buffer.from("original bytes"), dek);
    sealed.ciphertext[0] ^= 0xff;
    expect(() => decryptContent(sealed, dek)).toThrow();
  });

  it("refuses a tampered auth tag", () => {
    const dek = generateDek();
    const sealed = encryptContent(Buffer.from("original bytes"), dek);
    sealed.tag[0] ^= 0xff;
    expect(() => decryptContent(sealed, dek)).toThrow();
  });

  it("refuses the wrong data key", () => {
    const sealed = encryptContent(Buffer.from("secret"), generateDek());
    expect(() => decryptContent(sealed, generateDek())).toThrow();
  });
});

describe("key wrapping", () => {
  it("round-trips a DEK under the master key", () => {
    const dek = generateDek();
    const wrapped = wrapDek(dek, master, STORAGE_KEY);
    expect(wrapped.ciphertext.equals(dek)).toBe(false);
    expect(unwrapDek(wrapped, master, STORAGE_KEY).equals(dek)).toBe(true);
  });

  it("binds the wrapped key to its storage key", () => {
    // A wrapped key lifted from one row must not open another row's media.
    const dek = generateDek();
    const wrapped = wrapDek(dek, master, STORAGE_KEY);
    expect(() => unwrapDek(wrapped, master, "someone-elses-key")).toThrow();
  });

  it("refuses the wrong master key", () => {
    const wrapped = wrapDek(generateDek(), master, STORAGE_KEY);
    expect(() => unwrapDek(wrapped, randomBytes(32), STORAGE_KEY)).toThrow();
  });
});

describe("crypto-shredding", () => {
  it("leaves archived ciphertext permanently unreadable once the key is gone", () => {
    // What the archive holds after an upload.
    const dek = generateDek();
    const media = randomBytes(4096);
    const sealed = encryptContent(media, dek);
    const wrapped = wrapDek(dek, master, STORAGE_KEY);

    // Sanity: while the wrapped key exists, the file reads back.
    const recovered = unwrapDek(wrapped, master, STORAGE_KEY);
    expect(decryptContent(sealed, recovered).equals(media)).toBe(true);

    // The shred: the row's wrappedKey column is nulled. Internet Archive has no
    // delete, so this is the deletion — the ciphertext survives, the key does not.
    const shreddedRow: { wrappedKey: Buffer | null } = { wrappedKey: null };
    expect(shreddedRow.wrappedKey).toBeNull();

    // Nothing short of the original DEK opens it, and the DEK only ever existed
    // inside that wrapper.
    expect(() => decryptContent(sealed, generateDek())).toThrow();
    expect(() => decryptContent(sealed, master)).toThrow();
  });
});

describe("safeEqual", () => {
  it("matches identical strings", () => {
    expect(safeEqual("cron-token", "cron-token")).toBe(true);
  });

  it("rejects different strings, including different lengths", () => {
    expect(safeEqual("cron-token", "cron-tokeN")).toBe(false);
    expect(safeEqual("short", "much longer value")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });
});
