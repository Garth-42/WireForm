import type { ConnectorPhoto } from "./model";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SOURCE_BYTES = 8_000_000;
const MAX_DIMENSION = 720;

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The selected image could not be read."));
    image.src = dataUrl;
  });
}

function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The selected image could not be read."));
    reader.readAsDataURL(file);
  });
}

export async function prepareConnectorPhoto(
  file: File,
  alt: string,
): Promise<ConnectorPhoto> {
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error("Connector photos must be JPEG, PNG, or WebP images.");
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("Connector photos must be smaller than 8 MB.");
  }

  const sourceUrl = await readDataUrl(file);
  const image = await loadImage(sourceUrl);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image processing is unavailable in this browser.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.84),
    fileName: file.name.slice(0, 240),
    mimeType: "image/jpeg",
    width,
    height,
    alt: alt.trim().slice(0, 500) || "Connector photo",
  };
}
