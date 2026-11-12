import { DEFAULT_PREFERENCES, STORAGE_KEYS } from "./config.js";
import { uid } from "./utils.js";

const DB_NAME = "fog-mirror";
const DB_VERSION = 1;
const PHOTO_STORE = "photos";
const DRAWING_STORE = "drawings";

/**
 * Local-only persistence. Preferences live in localStorage; photographs and
 * drawings live in IndexedDB. No network code exists in this module.
 */
export class Storage {
  constructor() {
    this.dbPromise = null;
    this.dbAvailable = true;
  }

  loadPreferences() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.prefs);
      if (!raw) return { ...DEFAULT_PREFERENCES };
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_PREFERENCES, ...(parsed && typeof parsed === "object" ? parsed : {}) };
    } catch {
      return { ...DEFAULT_PREFERENCES };
    }
  }

  savePreferences(preferences) {
    try {
      localStorage.setItem(STORAGE_KEYS.prefs, JSON.stringify(preferences));
    } catch {
      // Storage can be unavailable in strict privacy modes; the session still works.
    }
  }

  async openDB() {
    if (!this.dbAvailable) return null;
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve) => {
      if (!("indexedDB" in window)) {
        this.dbAvailable = false;
        resolve(null);
        return;
      }

      let request;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch {
        this.dbAvailable = false;
        resolve(null);
        return;
      }

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(PHOTO_STORE)) {
          const store = db.createObjectStore(PHOTO_STORE, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
        }
        if (!db.objectStoreNames.contains(DRAWING_STORE)) {
          db.createObjectStore(DRAWING_STORE, { keyPath: "id" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.dbAvailable = false;
        resolve(null);
      };
      request.onblocked = () => resolve(null);
    });

    return this.dbPromise;
  }

  async savePhoto({ blob, width, height, filter, mode, faceAware = false }) {
    const db = await this.openDB();
    if (!db) throw new Error("Local photo storage is unavailable in this browser.");
    const record = {
      id: uid(),
      blob,
      width,
      height,
      filter,
      mode,
      faceAware,
      createdAt: Date.now(),
    };

    await new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, "readwrite");
      tx.objectStore(PHOTO_STORE).put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("Could not save photo."));
    });

    return record;
  }

  async getPhotos() {
    const db = await this.openDB();
    if (!db) return [];
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, "readonly");
      const request = tx.objectStore(PHOTO_STORE).getAll();
      request.onsuccess = () => {
        const records = Array.isArray(request.result) ? request.result : [];
        resolve(records.sort((a, b) => b.createdAt - a.createdAt));
      };
      request.onerror = () => reject(request.error || new Error("Could not read photos."));
    });
  }

  async deletePhoto(id) {
    const db = await this.openDB();
    if (!db) return;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, "readwrite");
      tx.objectStore(PHOTO_STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("Could not delete photo."));
    });
  }

  async clearPhotos() {
    const db = await this.openDB();
    if (!db) return;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, "readwrite");
      tx.objectStore(PHOTO_STORE).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("Could not clear photos."));
    });
  }

  async getPhotoCount() {
    try {
      const photos = await this.getPhotos();
      return photos.length;
    } catch {
      return 0;
    }
  }

  async saveDrawing(payload) {
    const db = await this.openDB();
    const record = {
      id: "last",
      payload,
      updatedAt: Date.now(),
    };
    if (!db) {
      try {
        localStorage.setItem(STORAGE_KEYS.drawing, JSON.stringify(payload));
        return record;
      } catch {
        throw new Error("Drawing storage is unavailable in this browser.");
      }
    }
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DRAWING_STORE, "readwrite");
      tx.objectStore(DRAWING_STORE).put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("Could not save drawing."));
    });
    return record;
  }

  async loadDrawing() {
    const db = await this.openDB();
    if (!db) {
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.drawing);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    }
    return new Promise((resolve) => {
      const tx = db.transaction(DRAWING_STORE, "readonly");
      const request = tx.objectStore(DRAWING_STORE).get("last");
      request.onsuccess = () => resolve(request.result?.payload || null);
      request.onerror = () => resolve(null);
    });
  }

  async clearDrawings() {
    const db = await this.openDB();
    try {
      localStorage.removeItem(STORAGE_KEYS.drawing);
    } catch {
      // Ignore.
    }
    if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction(DRAWING_STORE, "readwrite");
      tx.objectStore(DRAWING_STORE).clear();
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  }

  async clearAllLocalData() {
    await Promise.allSettled([this.clearPhotos(), this.clearDrawings()]);
    try {
      localStorage.removeItem(STORAGE_KEYS.prefs);
      localStorage.removeItem(STORAGE_KEYS.drawing);
    } catch {
      // Ignore.
    }
  }
}
