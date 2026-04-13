import {
  type ChangeEvent,
  type DragEvent,
  startTransition,
  useEffect,
  useId,
  useState,
} from "react";
import "./App.css";
import {
  DEFAULT_TARGET_WIDTHS,
  type ProcessingResult,
  isSupportedImageFile,
  processImageFile,
  warmAvifEncoder,
} from "./lib/imageProcessing";
import { downloadAssetsZip, downloadBlob } from "./lib/downloads";

const DEFAULT_QUALITY = 60;
const PROCESS_DELAY_MS = 350;

type ProcessingStatus = "idle" | "processing" | "ready" | "error";

function App() {
  const uploadInputId = useId();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [quality, setQuality] = useState(DEFAULT_QUALITY);
  const [status, setStatus] = useState<ProcessingStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string | null>(null);
  const [encodedPreviewUrl, setEncodedPreviewUrl] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isPackagingZip, setIsPackagingZip] = useState(false);

  useEffect(() => {
    void warmAvifEncoder();
  }, []);

  useEffect(() => {
    if (!selectedFile) {
      setSourcePreviewUrl(null);
      return;
    }

    const nextUrl = URL.createObjectURL(selectedFile);
    setSourcePreviewUrl(nextUrl);

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [selectedFile]);

  useEffect(() => {
    if (!result?.outputs.length) {
      setEncodedPreviewUrl(null);
      return;
    }

    const preferredPreview =
      result.outputs.find((asset) => asset.width === 1200) ?? result.outputs[0];
    const nextUrl = URL.createObjectURL(preferredPreview.blob);
    setEncodedPreviewUrl(nextUrl);

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [result]);

  useEffect(() => {
    if (!selectedFile) {
      setResult(null);
      return;
    }

    let isCancelled = false;

    setStatus("processing");

    const timeoutId = window.setTimeout(() => {
      void processImageFile(selectedFile, {
        quality,
        targetWidths: [...DEFAULT_TARGET_WIDTHS],
      })
        .then((nextResult) => {
          if (isCancelled) {
            return;
          }

          startTransition(() => {
            setResult(nextResult);
            setErrorMessage(null);
            setStatus("ready");
          });
        })
        .catch((error: unknown) => {
          if (isCancelled) {
            return;
          }

          startTransition(() => {
            setResult(null);
            setStatus("error");
            setErrorMessage(
              error instanceof Error
                ? error.message
                : "Unable to process this image right now.",
            );
          });
        });
    }, PROCESS_DELAY_MS);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [quality, selectedFile]);

  const outputs = result?.outputs ?? [];
  const hasExports = outputs.length > 0;
  const skippedWidths = result?.skippedWidths ?? [];
  const previewLabel = outputs.some((asset) => asset.width === 1200)
    ? "1200px AVIF preview"
    : outputs[0]
      ? `${outputs[0].width}px AVIF preview`
      : "AVIF preview";

  const statusMessage = getStatusMessage(status, selectedFile, outputs.length);

  const handleFileSelection = (file: File | null) => {
    if (!file) {
      return;
    }

    if (!isSupportedImageFile(file)) {
      setSelectedFile(null);
      setResult(null);
      setStatus("error");
      setErrorMessage("Please choose a JPG, PNG, or WebP image.");
      return;
    }

    setSelectedFile(file);
    setResult(null);
    setStatus("idle");
    setErrorMessage(null);
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleFileSelection(event.target.files?.[0] ?? null);
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
    handleFileSelection(event.dataTransfer.files?.[0] ?? null);
  };

  const handleZipDownload = async () => {
    if (!selectedFile || !hasExports) {
      return;
    }

    try {
      setIsPackagingZip(true);
      await downloadAssetsZip(selectedFile.name, outputs);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "The ZIP archive could not be created.",
      );
    } finally {
      setIsPackagingZip(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="backdrop-glow backdrop-glow-left" />
      <div className="backdrop-glow backdrop-glow-right" />

      <header className="hero-panel">
        <div>
          <p className="eyebrow">AVIF Photo Scaler</p>
          <h1>Compress once, ship two crisp AVIF sizes.</h1>
        </div>
        <p className="hero-copy">
          Drop a single JPG, PNG, or WebP image and export browser-generated
          AVIF files at 1200px and 600px without sending your photo to a server.
        </p>
        <div className="badge-row">
          <span>Browser only</span>
          <span>1200px + 600px</span>
          <span>No upscaling</span>
        </div>
      </header>

      <main className="workspace-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Upload</p>
              <h2>Bring in the source photo</h2>
            </div>
            <p className="panel-note">
              The app keeps the original aspect ratio and only exports sizes the
              source image can support.
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
              id={uploadInputId}
              aria-label="Upload photo"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              className="visually-hidden"
              type="file"
              onChange={handleInputChange}
            />
            <span className="upload-pill">Upload photo</span>
            <strong>Drop a JPG, PNG, or WebP image here.</strong>
            <span>
              Or click to browse. Processing stays in your browser and the app
              exports AVIF versions at fixed widths.
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
              id="quality-slider"
              aria-label="AVIF quality"
              className="quality-slider"
              max={90}
              min={20}
              step={1}
              type="range"
              value={quality}
              onChange={(event) => setQuality(Number(event.target.value))}
            />
            <p className="muted-copy">
              Higher values keep more detail and increase file size. The preview
              regenerates automatically after each change.
            </p>
          </div>

          <div className="rules-grid">
            <article className="rule-card">
              <p className="eyebrow">Input</p>
              <h3>Focused v1 support</h3>
              <p>JPG, PNG, and WebP uploads only.</p>
            </article>
            <article className="rule-card">
              <p className="eyebrow">Exports</p>
              <h3>Fixed widths</h3>
              <p>AVIF outputs at 1200px and 600px.</p>
            </article>
            <article className="rule-card">
              <p className="eyebrow">Scaling</p>
              <h3>No artificial enlargement</h3>
              <p>Images smaller than a target width are skipped.</p>
            </article>
          </div>

          <div className="status-stack" aria-live="polite">
            <p className={`status-pill status-${status}`}>{statusMessage}</p>
            {errorMessage ? (
              <p className="error-banner" role="alert">
                {errorMessage}
              </p>
            ) : null}
          </div>

          {selectedFile ? (
            <div className="file-chip">
              <span className="file-chip-label">Selected</span>
              <strong>{selectedFile.name}</strong>
            </div>
          ) : null}
        </section>

        <section className="panel panel-preview">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Preview</p>
              <h2>Compare source and AVIF output</h2>
            </div>
            <p className="panel-note">
              The right pane shows the 1200px AVIF when available, or the 600px
              version when that is the highest supported output.
            </p>
          </div>

          <div className="preview-grid">
            <figure className="preview-card">
              <figcaption>Original upload</figcaption>
              {sourcePreviewUrl ? (
                <img
                  alt={selectedFile ? `Original preview for ${selectedFile.name}` : "Original preview"}
                  src={sourcePreviewUrl}
                />
              ) : (
                <div className="preview-placeholder">
                  Upload a photo to see the original here.
                </div>
              )}
            </figure>

            <figure className="preview-card">
              <figcaption>{previewLabel}</figcaption>
              {encodedPreviewUrl ? (
                <img alt="AVIF output preview" src={encodedPreviewUrl} />
              ) : (
                <div className="preview-placeholder">
                  Processed AVIF output will appear here after encoding.
                </div>
              )}
            </figure>
          </div>

          <div className="results-header">
            <div>
              <p className="eyebrow">Exports</p>
              <h3>Ready-to-download files</h3>
            </div>
            {hasExports ? (
              <button
                className="secondary-button"
                disabled={status === "processing" || isPackagingZip}
                type="button"
                onClick={() => void handleZipDownload()}
              >
                {isPackagingZip ? "Packaging ZIP..." : "Download ZIP"}
              </button>
            ) : null}
          </div>

          <div className="output-grid">
            {hasExports ? (
              outputs.map((asset) => (
                <article className="output-card" key={asset.width}>
                  <div>
                    <p className="eyebrow">AVIF export</p>
                    <h4>{asset.width}px</h4>
                  </div>
                  <dl className="output-meta">
                    <div>
                      <dt>Dimensions</dt>
                      <dd>
                        {asset.width} x {asset.height}
                      </dd>
                    </div>
                    <div>
                      <dt>File size</dt>
                      <dd>{formatBytes(asset.sizeBytes)}</dd>
                    </div>
                    <div>
                      <dt>Filename</dt>
                      <dd>{asset.filename}</dd>
                    </div>
                  </dl>
                  <button
                    className="primary-button"
                    disabled={status === "processing"}
                    type="button"
                    onClick={() => downloadBlob(asset.blob, asset.filename)}
                  >
                    Download {asset.width}px
                  </button>
                </article>
              ))
            ) : (
              <div className="empty-state">
                <p className="eyebrow">No exports yet</p>
                <h4>Upload a compatible image to generate AVIF files.</h4>
                <p>
                  Files smaller than 600px wide will not create an export because
                  this app never upscales the source.
                </p>
              </div>
            )}
          </div>

          {skippedWidths.length > 0 ? (
            <p className="note-banner">
              Skipped {skippedWidths.length > 1 ? "exports" : "export"}:{" "}
              {formatWidthList(skippedWidths)} because this app does not upscale
              smaller source images.
            </p>
          ) : null}

          {status === "ready" && !hasExports ? (
            <p className="note-banner">
              This upload is narrower than 600px, so there are no AVIF outputs
              to download.
            </p>
          ) : null}
        </section>
      </main>
    </div>
  );
}

function getStatusMessage(
  status: ProcessingStatus,
  selectedFile: File | null,
  outputCount: number,
): string {
  if (!selectedFile) {
    return "Waiting for a photo. Fixed AVIF exports will be generated at 1200px and 600px.";
  }

  if (status === "processing") {
    return "Encoding fresh AVIF previews and downloads...";
  }

  if (status === "ready") {
    return outputCount > 0
      ? `Ready: ${outputCount} AVIF ${outputCount === 1 ? "export" : "exports"} generated.`
      : "Ready: the image was processed, but no export widths were large enough to generate.";
  }

  if (status === "error") {
    return "Processing is blocked until a supported image is selected.";
  }

  return "Preparing the next AVIF export run...";
}

function formatWidthList(widths: number[]): string {
  return widths.map((width) => `${width}px`).join(" and ");
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
