import { MEDIAPIPE_VERSION, MEDIAPIPE_WASM } from "./config.js";

let visionPromise = null;
let filesetPromise = null;

/** Load MediaPipe Tasks Vision once, shared by hands and face detection. */
export function loadVision() {
  if (!visionPromise) {
    visionPromise = import(
      `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`
    ).catch((error) => {
      visionPromise = null;
      throw error;
    });
  }
  return visionPromise;
}

export async function getFileset() {
  if (!filesetPromise) {
    filesetPromise = loadVision()
      .then(({ FilesetResolver }) => FilesetResolver.forVisionTasks(MEDIAPIPE_WASM))
      .catch((error) => {
        filesetPromise = null;
        throw error;
      });
  }
  return filesetPromise;
}
