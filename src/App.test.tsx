import { act, fireEvent, render, screen } from "@testing-library/react";
import App from "./App";
import { processImageFile, warmAvifEncoder } from "./lib/imageProcessing";

vi.mock("./lib/imageProcessing", async () => {
  const actual = await vi.importActual<typeof import("./lib/imageProcessing")>(
    "./lib/imageProcessing",
  );

  return {
    ...actual,
    processImageFile: vi.fn(),
    warmAvifEncoder: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("./lib/downloads", () => ({
  downloadAssetsIndividually: vi.fn(),
  downloadAssetsZip: vi.fn().mockResolvedValue(undefined),
  downloadBlob: vi.fn(),
}));

const mockedProcessImageFile = vi.mocked(processImageFile);
const mockedWarmAvifEncoder = vi.mocked(warmAvifEncoder);

describe("App", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedWarmAvifEncoder.mockResolvedValue(undefined);
    mockedProcessImageFile.mockResolvedValue({
      outputs: [
        {
          width: 600,
          height: 400,
          filename: "portrait-600.avif",
          blob: new Blob(["encoded"], { type: "image/avif" }),
          sizeBytes: 7,
        },
      ],
      skippedWidths: [1200],
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("shows a validation error for unsupported files", () => {
    render(<App />);

    const input = screen.getByLabelText("Upload photo");
    fireEvent.change(input, {
      target: {
        files: [new File(["notes"], "notes.txt", { type: "text/plain" })],
      },
    });

    expect(
      screen.getByText("Please choose a JPG, PNG, or WebP image."),
    ).toBeInTheDocument();
    expect(mockedProcessImageFile).not.toHaveBeenCalled();
  });

  it("processes a valid image and reveals the output card", async () => {
    render(<App />);

    const file = new File(["portrait"], "portrait.jpg", {
      type: "image/jpeg",
    });

    fireEvent.change(screen.getByLabelText("Upload photo"), {
      target: { files: [file] },
    });

    await flushDebouncedProcessing();

    expect(mockedProcessImageFile).toHaveBeenCalledWith(file, {
      quality: 60,
      targetWidths: [1200, 600],
    });
    expect(screen.getByText("600 x 400")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download ZIP" })).toBeEnabled();
    expect(
      screen.getByText(
        "Skipped export: 1200px because this app does not upscale smaller source images.",
      ),
    ).toBeInTheDocument();
  });

  it("reprocesses when the quality slider changes", async () => {
    render(<App />);

    const file = new File(["portrait"], "portrait.jpg", {
      type: "image/jpeg",
    });

    fireEvent.change(screen.getByLabelText("Upload photo"), {
      target: { files: [file] },
    });

    await flushDebouncedProcessing();
    expect(mockedProcessImageFile).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("AVIF quality"), {
      target: { value: "72" },
    });

    await flushDebouncedProcessing();

    expect(mockedProcessImageFile).toHaveBeenLastCalledWith(file, {
      quality: 72,
      targetWidths: [1200, 600],
    });
  });

  it("downloads both generated files separately from a single action", async () => {
    const downloads = await import("./lib/downloads");

    render(<App />);

    const file = new File(["portrait"], "portrait.jpg", {
      type: "image/jpeg",
    });

    fireEvent.change(screen.getByLabelText("Upload photo"), {
      target: { files: [file] },
    });

    await flushDebouncedProcessing();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download Both Files" }));
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(downloads.downloadAssetsIndividually).toHaveBeenCalledWith([
      {
        width: 600,
        height: 400,
        filename: "portrait-600.avif",
        blob: expect.any(Blob),
        sizeBytes: 7,
      },
    ]);
  });
});

async function flushDebouncedProcessing(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(400);
    await Promise.resolve();
    await Promise.resolve();
  });
}
