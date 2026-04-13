import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

let objectUrlCount = 0;

globalThis.URL.createObjectURL = vi.fn(() => `blob:mock-${objectUrlCount += 1}`);
globalThis.URL.revokeObjectURL = vi.fn();
