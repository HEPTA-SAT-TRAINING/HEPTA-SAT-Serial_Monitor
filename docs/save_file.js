/**
 * @typedef {{ description: string, accept: Record<string, string[]> }} SaveFileType
 */

/**
 * Save a blob with the native "Save As" dialog when available.
 * Falls back to a download link with the suggested filename.
 *
 * Default folder cannot be set from a web app (browser security). Chrome and
 * Edge reopen the last folder the user chose for this site.
 *
 * @param {Blob} blob
 * @param {string} suggestedName
 * @param {SaveFileType} [fileType]
 * @returns {Promise<string>} Saved filename, or suggestedName on fallback download.
 */
export async function saveBlobWithPicker(blob, suggestedName, fileType) {
  if (typeof window.showSaveFilePicker === "function") {
    try {
      const options = { suggestedName };
      if (fileType) {
        options.types = [fileType];
      }
      const handle = await window.showSaveFilePicker(options);
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return handle.name;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw err;
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = suggestedName;
  anchor.click();
  URL.revokeObjectURL(url);
  return suggestedName;
}
