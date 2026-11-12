# Security and privacy

FOG MIRROR is a static browser application. It has no backend, no accounts, no analytics, and no server-side storage.

## Data flow

- Camera frames are drawn to a local `<video>`/canvas and processed in the page. They are never uploaded.
- Microphone samples are analysed with the Web Audio API in the page. They are never uploaded or recorded.
- Hand and face landmarks are produced locally by MediaPipe Tasks Vision. Model files are fetched from Google's model storage and the runtime from jsDelivr.
- Photographs, the last drawing, and preferences are stored in the browser (`IndexedDB` and `localStorage`). They stay on the device until the user deletes them or clears site data.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting:

https://github.com/ajaybe-ops/fog-mirror/security/advisories/new

Include the browser and version, a description of the issue, and reproduction steps. Please do not open a public issue for a security report.

## Supported versions

The `main` branch is the supported version. The deployed site tracks `main`.
