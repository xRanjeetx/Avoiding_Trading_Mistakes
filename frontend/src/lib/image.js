// Trade screenshots are shrunk in the browser before upload: a phone screenshot of several MB becomes a WebP of
// roughly 100–300 KB, which keeps the free storage going a long way and uploads fast on mobile data.
export const MAX_SIDE = 1600; // longest side in pixels; enough to read a chart
export const QUALITY = 0.82;
export const SLOTS = [["before", "Before entry"], ["after", "After close"]];

// The size to draw at: never enlarges, keeps the aspect ratio, and never returns 0.
export function fitSize(width, height, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const isImage = (file) => /^image\/(png|jpe?g|webp|gif|bmp)$/i.test(file?.type || "");

// Turns a picked or pasted image file into a small Blob (WebP, or JPEG where the browser cannot write WebP).
export async function compressImage(file) {
  if (!isImage(file)) throw new Error("Choose an image file (PNG, JPEG or WebP).");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That image could not be read.");
  }
  const { width, height } = fitSize(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // PNG transparency would turn black in JPEG
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", QUALITY));
  if (blob && blob.type === "image/webp") return blob;
  const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
  if (!jpeg) throw new Error("That image could not be converted.");
  return jpeg;
}
