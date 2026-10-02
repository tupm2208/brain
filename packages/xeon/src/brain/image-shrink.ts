/**
 * @file Shrinking photos before a model compares them (01/10/2026). A customer photo plus ten
 * catalogue photos at full size took 23–30 s per call; at 512 px / 256 px the same comparison took
 * 4–6 s with the same answers. `sharp` is loaded lazily: a machine without it still answers, only
 * slower (the photos go at full size).
 */

/** Resizes a picture to fit `maxPx` × `maxPx` and re-encodes it as JPEG. */
export type ImageShrink = (picture: Buffer, maxPx: number, quality: number) => Promise<Buffer>;

type SharpFactory = (input: Buffer) => {
  flatten(options: { background: string }): ReturnType<SharpFactory>;
  resize(width: number, height: number, options: { fit: "inside"; withoutEnlargement: boolean }): ReturnType<SharpFactory>;
  jpeg(options: { quality: number }): ReturnType<SharpFactory>;
  toBuffer(): Promise<Buffer>;
};

/** The `sharp` shrinker, or `null` when `sharp` is not installed on this machine. */
export function sharpShrink(): ImageShrink | null {
  let sharp: SharpFactory;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sharp = require("sharp") as SharpFactory;
  } catch {
    return null;
  }
  // Transparent PNGs (catalogue cut-outs) go on white, as a shop page shows them.
  return (picture, maxPx, quality) => sharp(picture).flatten({ background: "#ffffff" })
    .resize(maxPx, maxPx, { fit: "inside", withoutEnlargement: true }).jpeg({ quality }).toBuffer();
}
