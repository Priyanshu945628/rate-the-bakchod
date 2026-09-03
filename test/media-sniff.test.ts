import { describe, expect, it } from "vitest";
import { isHeic, sniffKind } from "@/lib/media/pipeline";

/**
 * Magic-byte sniffing, and the one image format that sniffs fine and still cannot
 * be decoded.
 *
 * HEIC, AVIF, MP4 and M4A are all the same container with a different brand written
 * four bytes in, so the interesting cases all live in `ftyp`. Getting the AVIF/HEIC
 * split wrong in either direction is a real bug: refuse an AVIF and a working upload
 * stops working, accept a HEIC and the uploader gets a libvips string.
 */

/** An ISO-BMFF `ftyp` box: size, "ftyp", major brand, minor version, compatible brands. */
function ftyp(major: string, compat: string[] = []): Buffer {
  const size = 16 + compat.length * 4;
  // A few trailing bytes stand in for the boxes that follow a real file's header.
  const buf = Buffer.alloc(size + 8, 0);
  buf.writeUInt32BE(size, 0);
  buf.write("ftyp", 4, "latin1");
  buf.write(major, 8, "latin1");
  compat.forEach((brand, i) => buf.write(brand, 16 + i * 4, "latin1"));
  return buf;
}

describe("sniffKind", () => {
  it("reads the common image signatures", () => {
    expect(sniffKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("IMAGE");
    expect(sniffKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("IMAGE");
    expect(sniffKind(Buffer.from("GIF89a", "latin1"))).toBe("IMAGE");
    expect(sniffKind(Buffer.concat([Buffer.from("RIFF0000WEBP", "latin1")]))).toBe("IMAGE");
  });

  it("separates mp4 video from m4a audio by brand", () => {
    expect(sniffKind(ftyp("isom"))).toBe("VIDEO");
    expect(sniffKind(ftyp("M4A "))).toBe("AUDIO");
  });

  it("calls a HEIC an image — it is one, and the decoder is the problem", () => {
    expect(sniffKind(ftyp("heic"))).toBe("IMAGE");
    expect(sniffKind(ftyp("avif"))).toBe("IMAGE");
  });

  it("has no answer for something it does not recognise", () => {
    expect(sniffKind(Buffer.from("not a file at all", "latin1"))).toBeNull();
    expect(sniffKind(Buffer.alloc(0))).toBeNull();
  });
});

describe("isHeic", () => {
  it("recognises the HEVC-in-HEIF brands", () => {
    for (const brand of ["heic", "heix", "heim", "heis", "hevc", "hevx"]) {
      expect(isHeic(ftyp(brand)), brand).toBe(true);
    }
  });

  it("leaves AVIF alone", () => {
    expect(isHeic(ftyp("avif"))).toBe(false);
    expect(isHeic(ftyp("avis"))).toBe(false);
    // The generic brand with AVIF declared underneath it — sharp decodes this.
    expect(isHeic(ftyp("mif1", ["avif", "mif1", "miaf"]))).toBe(false);
  });

  it("treats a generic HEIF as HEIC unless AVIF is declared", () => {
    expect(isHeic(ftyp("mif1", ["heic", "mif1"]))).toBe(true);
    // Nothing declared at all: the message about JPEG is a better answer than a
    // decoder failure.
    expect(isHeic(ftyp("mif1"))).toBe(true);
  });

  it("does not read past the ftyp box for compatible brands", () => {
    // "avif" here belongs to whatever box comes next, not to this file's brand list.
    const header = ftyp("mif1", ["heic"]);
    const spoof = Buffer.concat([header, Buffer.from("avif".repeat(4), "latin1")]);
    expect(isHeic(spoof)).toBe(true);
  });

  it("says no to everything that is not ISO-BMFF", () => {
    expect(isHeic(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
    expect(isHeic(ftyp("isom"))).toBe(false);
    expect(isHeic(Buffer.alloc(0))).toBe(false);
  });
});
