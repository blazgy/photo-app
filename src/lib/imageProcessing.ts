export interface ProcessingOptions {
  quality: number;
  targetWidths: number[];
}

export interface OutputAsset {
  width: number;
  height: number;
  filename: string;
  blob: Blob;
  sizeBytes: number;
}

export interface ProcessingResult {
  outputs: OutputAsset[];
  skippedWidths: number[];
}

interface PlannedOutput {
  width: number;
  height: number;
}

interface TargetPlan {
  outputs: PlannedOutput[];
  skippedWidths: number[];
}

interface DecodedImage {
  image: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const SUPPORTED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

let avifModulePromise:
  | Promise<typeof import("@jsquash/avif")>
  | null = null;

export const DEFAULT_TARGET_WIDTHS = [1200, 600] as const;

export function isSupportedImageFile(
  file: Pick<File, "name" | "type">,
): boolean {
  if (SUPPORTED_IMAGE_TYPES.has(file.type)) {
    return true;
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return SUPPORTED_EXTENSIONS.has(extension);
}

export function getBaseFilename(filename: string): string {
  const withoutExtension = filename.replace(/\.[^.]+$/, "").trim();
  const safeFilename = withoutExtension
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return safeFilename || "photo";
}

export function createOutputFilename(
  sourceFilename: string,
  width: number,
): string {
  return `${getBaseFilename(sourceFilename)}-${width}.avif`;
}

export function createZipFilename(sourceFilename: string): string {
  return `${getBaseFilename(sourceFilename)}-avif-exports.zip`;
}

export function getTargetDimensions(
  sourceWidth: number,
  sourceHeight: number,
  targetWidths: number[],
): TargetPlan {
  const uniqueWidths = targetWidths.filter(
    (width, index) =>
      Number.isInteger(width) &&
      width > 0 &&
      targetWidths.indexOf(width) === index,
  );

  const outputs: PlannedOutput[] = [];
  const skippedWidths: number[] = [];

  for (const targetWidth of uniqueWidths) {
    if (targetWidth > sourceWidth) {
      skippedWidths.push(targetWidth);
      continue;
    }

    const scaledHeight = Math.max(
      1,
      Math.round((sourceHeight * targetWidth) / sourceWidth),
    );

    outputs.push({
      width: targetWidth,
      height: scaledHeight,
    });
  }

  return { outputs, skippedWidths };
}

export async function warmAvifEncoder(): Promise<void> {
  await loadAvifModule();
}

export async function processImageFile(
  file: File,
  options: ProcessingOptions,
): Promise<ProcessingResult> {
  if (!isSupportedImageFile(file)) {
    throw new Error("Please choose a JPG, PNG, or WebP image.");
  }

  const encoder = await loadAvifModule();
  const decoded = await decodeImageFile(file);

  try {
    const plan = getTargetDimensions(
      decoded.width,
      decoded.height,
      options.targetWidths,
    );

    const outputs: OutputAsset[] = [];

    for (const target of plan.outputs) {
      const pixels = renderScaledImage(decoded.image, target.width, target.height);
      const encoded = await encoder.encode(pixels, {
        cqLevel: qualityToCqLevel(options.quality),
      });
      const data = normalizeEncodedData(encoded);
      const buffer = toArrayBuffer(data);

      outputs.push({
        width: target.width,
        height: target.height,
        filename: createOutputFilename(file.name, target.width),
        blob: new Blob([buffer], { type: "image/avif" }),
        sizeBytes: buffer.byteLength,
      });
    }

    return {
      outputs,
      skippedWidths: plan.skippedWidths,
    };
  } finally {
    decoded.cleanup();
  }
}

async function loadAvifModule(): Promise<typeof import("@jsquash/avif")> {
  if (!avifModulePromise) {
    avifModulePromise = import("@jsquash/avif");
  }

  return avifModulePromise;
}

async function decodeImageFile(file: File): Promise<DecodedImage> {
  if ("createImageBitmap" in window) {
    const bitmap = await window.createImageBitmap(file);

    return {
      image: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      cleanup: () => bitmap.close(),
    };
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImageElement(objectUrl);

    return {
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      cleanup: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function renderScaledImage(
  source: CanvasImageSource,
  width: number,
  height: number,
): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Your browser could not initialize a 2D canvas.");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.clearRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);

  return context.getImageData(0, 0, width, height);
}

function normalizeEncodedData(
  encoded: Uint8Array | ArrayBuffer,
): Uint8Array {
  if (encoded instanceof Uint8Array) {
    return encoded;
  }

  return new Uint8Array(encoded);
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(
    view.byteOffset,
    view.byteOffset + view.byteLength,
  ) as ArrayBuffer;
}

function qualityToCqLevel(quality: number): number {
  const clampedQuality = Math.min(100, Math.max(0, quality));
  return Math.round(((100 - clampedQuality) / 100) * 63);
}

function loadImageElement(objectUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => {
      reject(new Error("The selected image could not be decoded."));
    };
    image.src = objectUrl;
  });
}
