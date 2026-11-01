/** A rectangle inside an image, in pixels. */
export interface CropRect {
  left: number;
  top: number;
  size: number;
}

/** Pure math for turning any photo into a small square profile picture. */
export const ImageMath = {
  /** Profile and class pictures are stored as this many pixels square. */
  PHOTO_SIZE: 256,

  /** The largest square centered in a width x height image. */
  centerSquare(width: number, height: number): CropRect {
    if (!(width > 0 && height > 0)) throw new Error('Image has no size');
    const size = Math.min(width, height);
    return { left: Math.floor((width - size) / 2), top: Math.floor((height - size) / 2), size };
  },

  /** The biggest power-of-two step that still leaves the shorter side at least target pixels. */
  sampleSize(width: number, height: number, target = 256): number {
    let sample = 1;
    const shorter = Math.min(width, height);
    while (Math.floor(shorter / (sample * 2)) >= target) sample *= 2;
    return sample;
  },
};
