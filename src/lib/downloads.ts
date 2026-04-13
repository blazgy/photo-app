import { zipSync } from "fflate";
import {
  createZipFilename,
  type OutputAsset,
} from "./imageProcessing";

export function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = objectUrl;
  link.download = filename;
  link.rel = "noopener";
  link.click();

  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 0);
}

export function downloadAssetsIndividually(outputs: OutputAsset[]): void {
  outputs.forEach((asset, index) => {
    window.setTimeout(() => {
      downloadBlob(asset.blob, asset.filename);
    }, index * 180);
  });
}

export async function downloadAssetsZip(
  sourceFilename: string,
  outputs: OutputAsset[],
): Promise<void> {
  const files = Object.fromEntries(
    await Promise.all(
      outputs.map(async (asset) => [
        asset.filename,
        new Uint8Array(await asset.blob.arrayBuffer()),
      ]),
    ),
  );

  const archive = zipSync(files, { level: 0 });
  const zipBlob = new Blob([toArrayBuffer(archive)], {
    type: "application/zip",
  });

  downloadBlob(zipBlob, createZipFilename(sourceFilename));
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(
    view.byteOffset,
    view.byteOffset + view.byteLength,
  ) as ArrayBuffer;
}
