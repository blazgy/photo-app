import {
  type ChangeEvent,
  type DragEvent,
  type MutableRefObject,
  startTransition,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import "./App.css";
import {
  DEFAULT_TARGET_WIDTHS,
  type OutputAsset,
  type ProcessingResult,
  getBaseFilename,
  isSupportedImageFile,
  processImageFile,
  warmAvifEncoder,
} from "./lib/imageProcessing";
import {
  downloadAssetsIndividually,
  downloadAssetsZip,
  downloadBlob,
} from "./lib/downloads";

const DEFAULT_QUALITY = 60;
const MAX_BATCH_FILES = 10;
const PROCESS_DELAY_MS = 350;

type QueueItemStatus = "queued" | "processing" | "ready" | "error";
type FeedbackTone = "info" | "error";

interface QueueItem {
  id: string;
  file: File;
  status: QueueItemStatus;
  result: ProcessingResult | null;
  errorMessage: string | null;
}

function App() {
  const uploadInputId = useId();
  const queueIdRef = useRef(0);
  const hasInitializedQuality = useRef(false);
  const itemsRef = useRef<QueueItem[]>([]);

  const [items, setItems] = useState<QueueItem[]>([]);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [quality, setQuality] = useState(DEFAULT_QUALITY);
  const [uploadFeedback, setUploadFeedback] = useState<string | null>(null);
  const [uploadFeedbackTone, setUploadFeedbackTone] =
    useState<FeedbackTone>("info");
  const [isDragActive, setIsDragActive] = useState(false);
  const [isBatchZipDownloading, setIsBatchZipDownloading] = useState(false);
  const [separateDownloadsInProgress, setSeparateDownloadsInProgress] =
    useState<Record<string, boolean>>({});

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    void warmAvifEncoder();
  }, []);

  useEffect(() => {
    if (!hasInitializedQuality.current) {
      hasInitializedQuality.current = true;
      return;
    }

    if (itemsRef.current.length === 0) {
      return;
    }

    setActiveItemId(null);
    setItems((currentItems) =>
      currentItems.map((item) => ({
        ...item,
        status: "queued",
        result: null,
        errorMessage: null,
      })),
    );
    setUploadFeedback(
      "Quality changed. Re-encoding the batch one photo at a time.",
    );
    setUploadFeedbackTone("info");
  }, [quality]);

  useEffect(() => {
    if (activeItemId) {
      return;
    }

    const nextQueuedItem = items.find((item) => item.status === "queued");

    if (!nextQueuedItem) {
      return;
    }

    setActiveItemId(nextQueuedItem.id);
  }, [activeItemId, items]);

  useEffect(() => {
    if (!activeItemId) {
      return;
    }

    const itemToProcess = itemsRef.current.find((item) => item.id === activeItemId);

    if (!itemToProcess) {
      setActiveItemId(null);
      return;
    }

    let isCancelled = false;

    setItems((currentItems) =>
      currentItems.map((item) =>
        item.id === activeItemId
          ? {
              ...item,
              status: "processing",
              errorMessage: null,
            }
          : item,
      ),
    );

    const timeoutId = window.setTimeout(() => {
      void processImageFile(itemToProcess.file, {
        quality,
        targetWidths: [...DEFAULT_TARGET_WIDTHS],
      })
        .then((nextResult) => {
          if (isCancelled) {
            return;
          }

          startTransition(() => {
            setItems((currentItems) =>
              currentItems.map((item) =>
                item.id === activeItemId
                  ? {
                      ...item,
                      status: "ready",
                      result: nextResult,
                      errorMessage: null,
                    }
                  : item,
              ),
            );
            setActiveItemId((currentActiveId) =>
              currentActiveId === activeItemId ? null : currentActiveId,
            );
          });
        })
        .catch((error: unknown) => {
          if (isCancelled) {
            return;
          }

          startTransition(() => {
            setItems((currentItems) =>
              currentItems.map((item) =>
                item.id === activeItemId
                  ? {
                      ...item,
                      status: "error",
                      result: null,
                      errorMessage:
                        error instanceof Error
                          ? error.message
                          : "Unable to process this image right now.",
                    }
                  : item,
              ),
            );
            setActiveItemId((currentActiveId) =>
              currentActiveId === activeItemId ? null : currentActiveId,
            );
          });
        });
    }, PROCESS_DELAY_MS);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [activeItemId, quality]);

  const totalCount = items.length;
  const readyItems = items.filter((item) => item.status === "ready");
  const queuedCount = items.filter((item) => item.status === "queued").length;
  const errorCount = items.filter((item) => item.status === "error").length;
  const heroItem =
    items.find((item) => item.status === "processing") ??
    items.find((item) => item.status === "ready") ??
    items[0] ??
    null;
  const heroOutput =
    heroItem?.result?.outputs.find((asset) => asset.width === 1200) ??
    heroItem?.result?.outputs[0] ??
    null;
  const statusMessage = getStatusMessage(items);
  const batchZipOutputs = collectBatchOutputs(items);
  const hasPendingWork = queuedCount > 0 || Boolean(activeItemId);
  const isBatchZipDisabled =
    batchZipOutputs.length === 0 || hasPendingWork || isBatchZipDownloading;

  const handleFilesSelection = (incomingFiles: File[]) => {
    if (incomingFiles.length === 0) {
      return;
    }

    const supportedFiles = incomingFiles.filter((file) => isSupportedImageFile(file));
    const unsupportedCount = incomingFiles.length - supportedFiles.length;
    const remainingSlots = Math.max(MAX_BATCH_FILES - itemsRef.current.length, 0);
    const acceptedFiles = supportedFiles.slice(0, remainingSlots);
    const overflowCount = Math.max(supportedFiles.length - acceptedFiles.length, 0);

    if (acceptedFiles.length > 0) {
      setItems((currentItems) => [
        ...currentItems,
        ...acceptedFiles.map((file) => createQueueItem(file, queueIdRef)),
      ]);
    }

    if (acceptedFiles.length === 0) {
      if (remainingSlots === 0) {
        setUploadFeedback(
          `The queue already has ${MAX_BATCH_FILES} photos. Clear it before adding more.`,
        );
      } else {
        setUploadFeedback("No compatible images were added. Use JPG, PNG, or WebP files.");
      }

      setUploadFeedbackTone("error");
      return;
    }

    const feedbackParts = [
      `${acceptedFiles.length} ${pluralize("photo", acceptedFiles.length)} added to the queue.`,
    ];

    if (unsupportedCount > 0) {
      feedbackParts.push(
        `${unsupportedCount} unsupported ${pluralize("file", unsupportedCount)} ignored.`,
      );
    }

    if (overflowCount > 0) {
      feedbackParts.push(
        `${overflowCount} ${pluralize("file", overflowCount)} skipped because the batch limit is ${MAX_BATCH_FILES}.`,
      );
    }

    setUploadFeedback(feedbackParts.join(" "));
    setUploadFeedbackTone(
      unsupportedCount > 0 || overflowCount > 0 ? "error" : "info",
    );
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleFilesSelection(Array.from(event.target.files ?? []));
    event.currentTarget.value = "";
  };

  const handleDragOver = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    handleFilesSelection(Array.from(event.dataTransfer.files ?? []));
  };

  const handleClearQueue = () => {
    setActiveItemId(null);
    setItems([]);
    setUploadFeedback("The batch queue was cleared.");
    setUploadFeedbackTone("info");
    setIsBatchZipDownloading(false);
    setSeparateDownloadsInProgress({});
  };

  const handleBatchZipDownload = async () => {
    if (isBatchZipDisabled) {
      return;
    }

    try {
      setIsBatchZipDownloading(true);
      await downloadAssetsZip("netzwerk-photo-batch", batchZipOutputs);
    } catch (error) {
      setUploadFeedback(
        error instanceof Error
          ? error.message
          : "The ZIP archive could not be created.",
      );
      setUploadFeedbackTone("error");
    } finally {
      setIsBatchZipDownloading(false);
    }
  };

  const handleItemSeparateDownload = (itemId: string, outputs: OutputAsset[]) => {
    setSeparateDownloadsInProgress((currentState) => ({
      ...currentState,
      [itemId]: true,
    }));
    downloadAssetsIndividually(outputs);

    window.setTimeout(() => {
      setSeparateDownloadsInProgress((currentState) => ({
        ...currentState,
        [itemId]: false,
      }));
    }, Math.max(outputs.length - 1, 0) * 180 + 220);
  };

  return (
    <div className="page-shell">
      <div className="frame-shell">
        <header className="hero-panel">
          <div className="top-rail">
            <span className="rail-logo">+1</span>
          </div>

          <div className="hero-stage">
            <div className="hero-brand">
              <p className="eyebrow">OTRO Photo Scaler</p>
              <h1>scale.</h1>
              <p className="hero-copy">
                Upload up to 10 photos. The app queues them one by one and exports
                AVIF files at 1200px and 600px with proportional height.
              </p>
              <div className="hero-meta" aria-hidden="true">
                <span>AVIF LAB</span>
                <span>{`${totalCount} / ${MAX_BATCH_FILES}`}</span>
              </div>
              <div className="hero-index" aria-hidden="true">
                {totalCount > 0 ? totalCount.toString().padStart(2, "0") : "10"}
              </div>
            </div>

            <div className="hero-art">
              <div className="hero-notes">
                <span>Developed by OTRO LABS</span>
              </div>

              <div className="hero-composition">
                <div className="hero-accent-block" />
                <div className="hero-image-shell">
                  <PreviewImage
                    alt={
                      heroItem
                        ? `Hero preview for ${heroItem.file.name}`
                        : "Hero preview"
                    }
                    placeholderClassName="hero-image-placeholder"
                    placeholderText="Upload a batch to place the active queue item into the live preview."
                    source={heroOutput?.blob ?? heroItem?.file ?? null}
                  />
                </div>
                <div className="hero-vertical-copy" aria-hidden="true">
                  <span>NETZWERK</span>
                  <span>PHOTO</span>
                  <span>SCALER</span>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="workspace-grid">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Upload</p>
                <h2>Queue up to 10 photos</h2>
              </div>
              <p className="panel-note">
                The queue runs one image at a time and every photo gets fixed
                1200px and 600px AVIF exports.
              </p>
            </div>

            <label
              className={`upload-zone ${isDragActive ? "is-dragging" : ""}`}
              htmlFor={uploadInputId}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <input
                accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                aria-label="Upload photos"
                className="visually-hidden"
                id={uploadInputId}
                multiple
                type="file"
                onChange={handleInputChange}
              />
              <span className="upload-pill">Upload batch</span>
              <strong>Drop up to 10 JPG, PNG, or WebP images here.</strong>
              <span>
                Or click to browse. New photos are added to the queue and processed
                one by one in your browser.
              </span>
            </label>

            <div className="control-card">
              <div className="control-heading">
                <div>
                  <p className="eyebrow">Compression</p>
                  <h3>AVIF quality</h3>
                </div>
                <span className="quality-value">{quality}</span>
              </div>
              <label className="slider-label" htmlFor="quality-slider">
                AVIF quality
              </label>
              <input
                aria-label="AVIF quality"
                className="quality-slider"
                id="quality-slider"
                max={90}
                min={20}
                step={1}
                type="range"
                value={quality}
                onChange={(event) => setQuality(Number(event.target.value))}
              />
              <p className="muted-copy">
                Changing the quality re-queues the current batch and regenerates the
                exports one by one.
              </p>
            </div>

            <div className="status-stack" aria-live="polite">
              <p className="status-pill">{statusMessage}</p>
              {uploadFeedback ? (
                <p
                  className={
                    uploadFeedbackTone === "error" ? "error-banner" : "note-banner"
                  }
                  role={uploadFeedbackTone === "error" ? "alert" : undefined}
                >
                  {uploadFeedback}
                </p>
              ) : null}
            </div>

            <div className="file-chip">
              <span className="file-chip-label">Queue</span>
              <strong>
                {totalCount} / {MAX_BATCH_FILES} photos
              </strong>
              {totalCount > 0 ? (
                <button
                  className="batch-download-all-button"
                  disabled={isBatchZipDisabled}
                  type="button"
                  onClick={() => void handleBatchZipDownload()}
                >
                  {isBatchZipDownloading ? "Packaging batch ZIP..." : "Download All ZIP"}
                </button>
              ) : null}
              {totalCount > 0 ? (
                <button
                  className="queue-clear-button"
                  type="button"
                  onClick={handleClearQueue}
                >
                  Clear Queue
                </button>
              ) : null}
            </div>
          </section>

          <section className="panel panel-preview">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Preview</p>
                <h2>Track the active queue item</h2>
              </div>
              <p className="panel-note">
                The hero and preview panes follow the current item while every
                result card keeps individual AVIF download actions.
              </p>
            </div>

            <div className="preview-grid">
              <figure className="preview-card">
                <figcaption>Current source image</figcaption>
                <PreviewImage
                  alt={
                    heroItem
                      ? `Original preview for ${heroItem.file.name}`
                      : "Original preview"
                  }
                  placeholderClassName="preview-placeholder"
                  placeholderText="Upload a batch to see the current source image here."
                  source={heroItem?.file ?? null}
                />
              </figure>

              <figure className="preview-card">
                <figcaption>{getPreviewLabel(heroItem)}</figcaption>
                <PreviewImage
                  alt="AVIF output preview"
                  placeholderClassName="preview-placeholder"
                  placeholderText="Processed AVIF output will appear here for the active queue item."
                  source={heroOutput?.blob ?? null}
                />
              </figure>
            </div>

            <div className="results-header">
              <div>
                <p className="eyebrow">Exports</p>
                <h3>Processed batch</h3>
              </div>
              <p className="results-copy">
                {readyItems.length > 0
                  ? `${readyItems.length} ${pluralize("photo", readyItems.length)} ready. Use Download All ZIP once batch processing completes.`
                  : "Each processed photo gets 1200px and 600px downloads, plus one Download All ZIP for the full batch."}
              </p>
            </div>

            <div className="output-grid">
              {items.length > 0 ? (
                items.map((item, index) => (
                  <BatchItemCard
                    key={item.id}
                    index={index}
                    isDownloadingBoth={Boolean(separateDownloadsInProgress[item.id])}
                    item={item}
                    onDownloadAsset={downloadBlob}
                    onDownloadBoth={handleItemSeparateDownload}
                  />
                ))
              ) : (
                <div className="empty-state">
                  <p className="eyebrow">No queue yet</p>
                  <h4>Upload a batch to start the one-by-one AVIF pipeline.</h4>
                  <p>
                    Each image will generate a 1200px export, a 600px export, and
                    per-photo downloads plus one batch ZIP when processing completes.
                  </p>
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

interface BatchItemCardProps {
  index: number;
  isDownloadingBoth: boolean;
  item: QueueItem;
  onDownloadAsset: (blob: Blob, filename: string) => void;
  onDownloadBoth: (itemId: string, outputs: OutputAsset[]) => void;
}

function BatchItemCard({
  index,
  isDownloadingBoth,
  item,
  onDownloadAsset,
  onDownloadBoth,
}: BatchItemCardProps) {
  const outputs = item.result?.outputs ?? [];

  return (
    <article className={`output-card batch-card batch-card-${item.status}`}>
      <div className="batch-card-header">
        <div>
          <p className="eyebrow">{`Photo ${index + 1}`}</p>
          <h4>{item.file.name}</h4>
        </div>
        <span className={`batch-status batch-status-${item.status}`}>
          {getItemStatusLabel(item.status)}
        </span>
      </div>

      <div className="batch-preview-shell">
        <PreviewImage
          alt={`Batch preview for ${item.file.name}`}
          placeholderClassName="preview-placeholder batch-preview-placeholder"
          placeholderText="This queue item is waiting for a preview."
          source={
            outputs.find((asset) => asset.width === 1200)?.blob ??
            outputs[0]?.blob ??
            item.file
          }
        />
      </div>

      {item.errorMessage ? (
        <p className="error-banner" role="alert">
          {item.errorMessage}
        </p>
      ) : null}

      {outputs.length > 0 ? (
        <>
          <div className="batch-export-list">
            {outputs.map((asset) => (
              <div className="batch-export-row" key={asset.width}>
                <div className="batch-export-meta">
                  <strong>{asset.width}px</strong>
                  <span>
                    {asset.width} x {asset.height}
                  </span>
                  <span>{formatBytes(asset.sizeBytes)}</span>
                </div>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => onDownloadAsset(asset.blob, asset.filename)}
                >
                  Download {asset.width}px
                </button>
              </div>
            ))}
          </div>

          <div className="batch-actions">
            <button
              className="secondary-button"
              disabled={isDownloadingBoth}
              type="button"
              onClick={() => onDownloadBoth(item.id, outputs)}
            >
              {isDownloadingBoth ? "Downloading both..." : "Download Both Files"}
            </button>
          </div>
        </>
      ) : (
        <p className="muted-copy batch-note">{getItemDetailCopy(item.status)}</p>
      )}
    </article>
  );
}

interface PreviewImageProps {
  alt: string;
  placeholderClassName: string;
  placeholderText: string;
  source: Blob | null;
}

function PreviewImage({
  alt,
  placeholderClassName,
  placeholderText,
  source,
}: PreviewImageProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!source) {
      setPreviewUrl(null);
      return;
    }

    const nextUrl = URL.createObjectURL(source);
    setPreviewUrl(nextUrl);

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [source]);

  if (!previewUrl) {
    return <div className={placeholderClassName}>{placeholderText}</div>;
  }

  return <img alt={alt} src={previewUrl} />;
}

function collectBatchOutputs(items: QueueItem[]): OutputAsset[] {
  return items.flatMap((item, index) => {
    if (item.status !== "ready" || !item.result) {
      return [];
    }

    const sourcePrefix = getBaseFilename(item.file.name);
    const indexPrefix = String(index + 1).padStart(2, "0");

    return item.result.outputs.map((asset) => ({
      ...asset,
      filename: `${indexPrefix}-${sourcePrefix}-${asset.width}.avif`,
    }));
  });
}

function createQueueItem(file: File, queueIdRef: MutableRefObject<number>): QueueItem {
  queueIdRef.current += 1;

  return {
    id: `queue-item-${queueIdRef.current}`,
    file,
    status: "queued",
    result: null,
    errorMessage: null,
  };
}

function getStatusMessage(items: QueueItem[]): string {
  if (items.length === 0) {
    return `Waiting for up to ${MAX_BATCH_FILES} photos. They will be processed one by one.`;
  }

  const processingIndex = items.findIndex((item) => item.status === "processing");
  const readyCount = items.filter((item) => item.status === "ready").length;
  const queuedCount = items.filter((item) => item.status === "queued").length;
  const errorCount = items.filter((item) => item.status === "error").length;

  if (processingIndex >= 0) {
    return `Processing photo ${processingIndex + 1} of ${items.length}. ${readyCount} ready, ${queuedCount} waiting.`;
  }

  if (queuedCount > 0) {
    return `${queuedCount} ${pluralize("photo", queuedCount)} ${queuedCount === 1 ? "is" : "are"} queued and waiting to be processed.`;
  }

  if (errorCount > 0) {
    return `Finished with ${readyCount} ready and ${errorCount} failed ${pluralize("photo", errorCount)}.`;
  }

  return `Ready: ${readyCount} ${pluralize("photo", readyCount)} processed at 1200px and 600px.`;
}

function getPreviewLabel(item: QueueItem | null): string {
  if (!item) {
    return "Batch preview";
  }

  const preferredOutput =
    item.result?.outputs.find((asset) => asset.width === 1200) ??
    item.result?.outputs[0];

  if (preferredOutput) {
    return `${preferredOutput.width}px AVIF preview`;
  }

  return item.status === "processing" ? "Processing source preview" : "Queued source preview";
}

function getItemStatusLabel(status: QueueItemStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "processing":
      return "Processing";
    case "ready":
      return "Ready";
    case "error":
      return "Error";
  }
}

function getItemDetailCopy(status: QueueItemStatus): string {
  switch (status) {
    case "queued":
      return "This photo is waiting in the queue and will be processed after the current items finish.";
    case "processing":
      return "This photo is being encoded right now. The preview and downloads will appear when processing completes.";
    case "ready":
      return "The exports are ready.";
    case "error":
      return "This photo could not be processed.";
  }
}

function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default App;
