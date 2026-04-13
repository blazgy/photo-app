# AVIF Photo Scaler

A browser-based photo compression tool that accepts a single `JPG`, `PNG`, or `WebP` image and exports AVIF files at `1200px` and `600px` wide.

## Features

- Client-side image processing with no backend upload
- Fixed AVIF exports at `1200px` and `600px`
- Adjustable AVIF quality slider with regenerated preview
- Direct download for each output plus a combined ZIP archive
- No upscaling: widths larger than the source are skipped

## Local Development

1. Install a recent Node.js release.
2. Run `npm install`.
3. Start the dev server with `npm run dev`.
4. Run tests with `npm test`.
5. Create a production build with `npm run build`.
