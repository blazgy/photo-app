import {
  createOutputFilename,
  createZipFilename,
  getTargetDimensions,
  isSupportedImageFile,
} from "./imageProcessing";

describe("imageProcessing helpers", () => {
  it("preserves aspect ratio for both target widths", () => {
    expect(getTargetDimensions(1600, 900, [1200, 600])).toEqual({
      outputs: [
        { width: 1200, height: 675 },
        { width: 600, height: 338 },
      ],
      skippedWidths: [],
    });
  });

  it("skips widths that would require upscaling", () => {
    expect(getTargetDimensions(800, 600, [1200, 600])).toEqual({
      outputs: [{ width: 600, height: 450 }],
      skippedWidths: [1200],
    });
  });

  it("returns no outputs when the image is smaller than 600px", () => {
    expect(getTargetDimensions(480, 320, [1200, 600])).toEqual({
      outputs: [],
      skippedWidths: [1200, 600],
    });
  });

  it("creates stable AVIF and ZIP filenames", () => {
    expect(createOutputFilename("Summer Walk 2026.png", 1200)).toBe(
      "Summer-Walk-2026-1200.avif",
    );
    expect(createZipFilename("Summer Walk 2026.png")).toBe(
      "Summer-Walk-2026-avif-exports.zip",
    );
  });

  it("validates supported mime types and extensions", () => {
    expect(
      isSupportedImageFile({
        name: "portrait.jpeg",
        type: "image/jpeg",
      } as File),
    ).toBe(true);

    expect(
      isSupportedImageFile({
        name: "portrait.webp",
        type: "",
      } as File),
    ).toBe(true);

    expect(
      isSupportedImageFile({
        name: "notes.txt",
        type: "text/plain",
      } as File),
    ).toBe(false);
  });
});
