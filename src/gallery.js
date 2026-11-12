import { downloadBlob, formatDate } from "./utils.js";

/**
 * Local IndexedDB-backed photo archive. Object URLs are revoked on every
 * refresh so the gallery does not leak memory across long sessions.
 */
export class Gallery {
  constructor({ storage, grid, empty, count, badge, onToast, onShoot } = {}) {
    this.storage = storage;
    this.grid = grid;
    this.empty = empty;
    this.count = count;
    this.badge = badge;
    this.onToast = onToast || (() => {});
    this.onShoot = onShoot || (() => {});
    this.photos = [];
    this.urls = new Map();
    this.loading = false;

    this.grid?.addEventListener("click", (event) => {
      const action = event.target.closest("[data-gallery-action]");
      if (!action) return;
      const id = action.closest("[data-photo-id]")?.dataset.photoId;
      if (!id) return;
      const type = action.dataset.galleryAction;
      if (type === "download") this.download(id);
      if (type === "delete") this.delete(id);
    });

    // The shoot button inside the empty state is wired by UIController so the
    // panel closes before the countdown begins; do not bind it twice here.
  }

  async init() {
    await this.refresh();
  }

  async refresh() {
    if (this.loading) return;
    this.loading = true;
    try {
      this.photos = await this.storage.getPhotos();
      this.render();
    } catch (error) {
      this.onToast(error.message || "Could not read the local gallery.");
    } finally {
      this.loading = false;
    }
  }

  render() {
    this.revokeUrls();
    if (!this.grid) return;
    this.grid.innerHTML = "";

    const count = this.photos.length;
    if (this.count) this.count.textContent = `${count} photograph${count === 1 ? "" : "s"}`;
    if (this.badge) {
      this.badge.textContent = count > 99 ? "99+" : String(count);
      this.badge.hidden = count === 0;
    }
    if (this.empty) this.empty.classList.toggle("is-visible", count === 0);

    for (const photo of this.photos) {
      const item = document.createElement("div");
      item.className = "gallery-item";
      item.dataset.photoId = photo.id;
      item.style.animationDelay = `${Math.min(120, this.photos.indexOf(photo) * 25)}ms`;

      const image = document.createElement("img");
      image.alt = `Fog Mirror photograph from ${formatDate(photo.createdAt)}`;
      image.loading = "lazy";
      const url = URL.createObjectURL(photo.blob);
      this.urls.set(photo.id, url);
      image.src = url;
      item.appendChild(image);

      const overlay = document.createElement("div");
      overlay.className = "gallery-item-overlay";
      overlay.innerHTML = `
        <span class="gallery-item-meta">${escapeHtml(formatDate(photo.createdAt))}${photo.mode === "strip" ? " · strip" : ""}</span>
        <span class="gallery-item-actions">
          <button class="gallery-mini-btn" data-gallery-action="download" aria-label="Download photograph" title="Download">↓</button>
          <button class="gallery-mini-btn" data-gallery-action="delete" aria-label="Delete photograph" title="Delete">×</button>
        </span>
      `;
      item.appendChild(overlay);
      this.grid.appendChild(item);
    }
  }

  async add(record) {
    try {
      const saved = await this.storage.savePhoto({
        blob: record.blob,
        width: record.width,
        height: record.height,
        filter: record.filter,
        mode: record.mode,
        faceAware: record.faceAware,
      });
      await this.refresh();
      this.onToast(record.mode === "strip" ? "Photo strip saved to your local archive." : "Photograph saved to your local archive.");
      return saved;
    } catch (error) {
      this.onToast(error.message || "The photograph could not be saved.");
      return null;
    }
  }

  async download(id) {
    const photo = this.photos.find((candidate) => candidate.id === id);
    if (!photo) return;
    const extension = photo.blob.type === "image/png" ? "png" : "jpg";
    downloadBlob(photo.blob, `fog-mirror-${new Date(photo.createdAt).toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${extension}`);
  }

  async downloadAll() {
    if (!this.photos.length) {
      this.onToast("There are no photographs to download yet.");
      return;
    }
    for (const photo of this.photos) {
      await this.download(photo.id);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    this.onToast(`Downloaded ${this.photos.length} photograph${this.photos.length === 1 ? "" : "s"}.`);
  }

  async delete(id) {
    if (!window.confirm("Delete this photograph from this device?")) return;
    try {
      await this.storage.deletePhoto(id);
      await this.refresh();
      this.onToast("Photograph deleted.");
    } catch (error) {
      this.onToast(error.message || "Could not delete the photograph.");
    }
  }

  async clearAll() {
    if (!this.photos.length) return;
    if (!window.confirm("Delete every photograph stored on this device? This cannot be undone.")) return;
    try {
      await this.storage.clearPhotos();
      await this.refresh();
      this.onToast("Local photo archive cleared.");
    } catch (error) {
      this.onToast(error.message || "Could not clear the archive.");
    }
  }

  async getCount() {
    return this.photos.length;
  }

  revokeUrls() {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }

  dispose() {
    this.revokeUrls();
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
