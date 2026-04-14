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

  for (const targetWidth of uniqueWidths) {
    const scaledHeight = Math.max(
      1,
      Math.round((sourceHeight * targetWidth) / sourceWidth),
    );

    outputs.push({
      width: targetWidth,
      height: scaledHeight,
    });
  }

  return { outputs, skippedWidths: [] };
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

  const decoded = await decodeImageFile(file);

  try {
    const plan = getTargetDimensions(
      decoded.width,
      decoded.height,
      options.targetWidths,
    );

    const outputs: OutputAsset[] = [];

    for (const target of plan.outputs) {
      const canvas = renderScaledCanvas(decoded.image, target.width, target.height);
      const blob = await encodeCanvasToAvif(canvas, options.quality);

      outputs.push({
        width: target.width,
        height: target.height,
        filename: createOutputFilename(file.name, target.width),
        blob,
        sizeBytes: blob.size,
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

function renderScaledCanvas(
  source: CanvasImageSource,
  width: number,
  height: number,
): HTMLCanvasElement {
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
  context.drawImage(
    source,
    0,
    0,
    getSourceWidth(source),
    getSourceHeight(source),
    0,
    0,
    width,
    height,
  );

  return canvas;
}

async function encodeCanvasToAvif(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  const browserEncodedBlob = await canvasToBlob(canvas, quality);

  if (browserEncodedBlob) {
    return browserEncodedBlob;
  }

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Your browser could not initialize a 2D canvas.");
  }

  const encoder = await loadAvifModule();
  const encoded = await encoder.encode(
    context.getImageData(0, 0, canvas.width, canvas.height),
    {
      cqLevel: qualityToCqLevel(quality),
    },
  );
  const data = normalizeEncodedData(encoded);

  return new Blob([toArrayBuffer(data)], { type: "image/avif" });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (blob?.type === "image/avif") {
          resolve(blob);
          return;
        }

        resolve(null);
      },
      "image/avif",
      quality / 100,
    );
  });
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

function getSourceWidth(source: CanvasImageSource): number {
  if ("displayWidth" in source && typeof source.displayWidth === "number") {
    return source.displayWidth;
  }

  if ("videoWidth" in source && typeof source.videoWidth === "number") {
    return source.videoWidth;
  }

  if ("naturalWidth" in source && typeof source.naturalWidth === "number") {
    return source.naturalWidth;
  }

  if ("width" in source && typeof source.width === "number") {
    return source.width;
  }

  throw new Error("Unable to determine the source image width.");
}

function getSourceHeight(source: CanvasImageSource): number {
  if ("displayHeight" in source && typeof source.displayHeight === "number") {
    return source.displayHeight;
  }

  if ("videoHeight" in source && typeof source.videoHeight === "number") {
    return source.videoHeight;
  }

  if ("naturalHeight" in source && typeof source.naturalHeight === "number") {
    return source.naturalHeight;
  }

  if ("height" in source && typeof source.height === "number") {
    return source.height;
  }

  throw new Error("Unable to determine the source image height.");
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
