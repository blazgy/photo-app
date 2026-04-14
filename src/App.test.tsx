import { act, fireEvent, render, screen } from "@testing-library/react";
import App from "./App";
import {
  type ProcessingResult,
  processImageFile,
  warmAvifEncoder,
} from "./lib/imageProcessing";

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
    mockedProcessImageFile.mockResolvedValue(createMockResult("portrait", 800));
  });

  afterEach(async () => {
    await act(async () => {
      vi.runOnlyPendingTimers();
      await Promise.resolve();
      await Promise.resolve();
    });
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("shows a validation error for unsupported batch input", () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText("Upload photos"), {
      target: {
        files: [new File(["notes"], "notes.txt", { type: "text/plain" })],
      },
    });

    expect(
      screen.getByText("No compatible images were added. Use JPG, PNG, or WebP files."),
    ).toBeInTheDocument();
    expect(mockedProcessImageFile).not.toHaveBeenCalled();
  });

  it("caps the batch queue at 10 photos", async () => {
    render(<App />);

    const files = Array.from({ length: 11 }, (_, index) =>
      new File([`image-${index}`], `image-${index}.jpg`, {
        type: "image/jpeg",
      }),
    );

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Upload photos"), {
        target: { files },
      });
    });

    await flushQueueCycle();

    expect(screen.getByText("10 / 10 photos")).toBeInTheDocument();
    expect(
      screen.getByText("10 photos added to the queue. 1 file skipped because the batch limit is 10."),
    ).toBeInTheDocument();
  });

  it("processes queued photos one by one", async () => {
    let resolveFirst: ((value: ProcessingResult) => void) | undefined;

    mockedProcessImageFile
      .mockImplementationOnce(
        () =>
          new Promise<ProcessingResult>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(createMockResult("second", 720));

    render(<App />);

    const firstFile = new File(["first"], "first.jpg", { type: "image/jpeg" });
    const secondFile = new File(["second"], "second.jpg", { type: "image/jpeg" });

    fireEvent.change(screen.getByLabelText("Upload photos"), {
      target: { files: [firstFile, secondFile] },
    });

    await flushQueueCycle();

    expect(mockedProcessImageFile).toHaveBeenCalledTimes(1);
    expect(mockedProcessImageFile).toHaveBeenNthCalledWith(1, firstFile, {
      quality: 60,
      targetWidths: [1200, 600],
    });
    expect(
      screen.getByText("Processing photo 1 of 2. 0 ready, 1 waiting."),
    ).toBeInTheDocument();

    await act(async () => {
      resolveFirst?.(createMockResult("first", 900));
      await Promise.resolve();
      await Promise.resolve();
    });

    await flushQueueCycle();

    expect(mockedProcessImageFile).toHaveBeenCalledTimes(2);
    expect(mockedProcessImageFile).toHaveBeenNthCalledWith(2, secondFile, {
      quality: 60,
      targetWidths: [1200, 600],
    });
  });

  it("reprocesses the batch when the quality slider changes", async () => {
    render(<App />);

    const file = new File(["portrait"], "portrait.jpg", {
      type: "image/jpeg",
    });

    fireEvent.change(screen.getByLabelText("Upload photos"), {
      target: { files: [file] },
    });

    await flushQueueCycle();
    expect(mockedProcessImageFile).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("AVIF quality"), {
      target: { value: "72" },
    });

    await flushQueueCycle();

    expect(mockedProcessImageFile).toHaveBeenLastCalledWith(file, {
      quality: 72,
      targetWidths: [1200, 600],
    });
    expect(
      screen.getByText("Quality changed. Re-encoding the batch one photo at a time."),
    ).toBeInTheDocument();
  });

  it("downloads the processed batch as one zip archive", async () => {
    const downloads = await import("./lib/downloads");

    render(<App />);

    const file = new File(["portrait"], "portrait.jpg", {
      type: "image/jpeg",
    });

    fireEvent.change(screen.getByLabelText("Upload photos"), {
      target: { files: [file] },
    });

    await flushQueueCycle();
    expect(screen.queryByRole("button", { name: "Download ZIP" })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download All ZIP" }));
      await Promise.resolve();
    });

    expect(downloads.downloadAssetsZip).toHaveBeenCalledWith(
      "netzwerk-photo-batch",
      expect.arrayContaining([
        expect.objectContaining({ width: 1200 }),
        expect.objectContaining({ width: 600 }),
      ]),
    );
  });
});

function createMockResult(
  baseName: string,
  scaled1200Height: number,
): ProcessingResult {
  return {
    outputs: [
      {
        width: 1200,
        height: scaled1200Height,
        filename: `${baseName}-1200.avif`,
        blob: new Blob([`${baseName}-1200`], { type: "image/avif" }),
        sizeBytes: 12,
      },
      {
        width: 600,
        height: Math.round(scaled1200Height / 2),
        filename: `${baseName}-600.avif`,
        blob: new Blob([`${baseName}-600`], { type: "image/avif" }),
        sizeBytes: 7,
      },
    ],
    skippedWidths: [],
  };
}

async function flushQueueCycle(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(400);
    await Promise.resolve();
    await Promise.resolve();
  });
}
