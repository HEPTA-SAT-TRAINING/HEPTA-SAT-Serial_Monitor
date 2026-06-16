/**
 * Bytes shown per hex dump line.
 */
export const HEX_BYTES_PER_LINE = 16;

/**
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @returns {Uint8Array}
 */
function concatBytes(a, b) {
  if (a.length === 0) {
    return b;
  }
  if (b.length === 0) {
    return a;
  }
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/**
 * @param {Uint8Array} bytes
 * @param {number} byteOffset
 * @param {number} [padTo]
 * @returns {string}
 */
function formatHexLine(bytes, byteOffset, padTo = HEX_BYTES_PER_LINE) {
  const parts = [];
  for (let i = 0; i < padTo; i++) {
    parts.push(
      i < bytes.length
        ? bytes[i].toString(16).padStart(2, "0").toUpperCase()
        : "  "
    );
  }
  const offset = byteOffset.toString(16).padStart(8, "0").toUpperCase();
  return `${offset}  ${parts.join(" ")}`;
}

/**
 * Buffers a byte stream and emits fixed-width hex dump lines.
 */
export class HexLineBuffer {
  /** @type {Uint8Array} */
  #pending = new Uint8Array(0);
  #streamOffset = 0;

  reset() {
    this.#pending = new Uint8Array(0);
    this.#streamOffset = 0;
  }

  /**
   * @param {Uint8Array} chunk
   * @returns {string[]}
   */
  push(chunk) {
    const merged = concatBytes(this.#pending, chunk);
    const completeBytes = merged.length - (merged.length % HEX_BYTES_PER_LINE);
    if (completeBytes === 0) {
      this.#pending = merged;
      return [];
    }

    const lines = [];
    for (let i = 0; i < completeBytes; i += HEX_BYTES_PER_LINE) {
      lines.push(
        formatHexLine(
          merged.subarray(i, i + HEX_BYTES_PER_LINE),
          this.#streamOffset + i
        )
      );
    }

    this.#pending = merged.subarray(completeBytes);
    this.#streamOffset += completeBytes;
    return lines;
  }

  /**
   * Emit the final partial line, padded to a full row.
   * @returns {string[]}
   */
  flush() {
    if (this.#pending.length === 0) {
      return [];
    }

    const line = formatHexLine(this.#pending, this.#streamOffset);
    this.#streamOffset += this.#pending.length;
    this.#pending = new Uint8Array(0);
    return [line];
  }
}

/**
 * Format bytes as a classic hex dump (16 bytes per line).
 * @param {Uint8Array} data
 * @param {number} [startOffset]
 * @returns {string[]}
 */
export function formatHexDump(data, startOffset = 0) {
  const lines = [];
  for (let i = 0; i < data.length; i += HEX_BYTES_PER_LINE) {
    const slice = data.subarray(i, Math.min(i + HEX_BYTES_PER_LINE, data.length));
    lines.push(formatHexLine(slice, startOffset + i, slice.length));
  }
  return lines;
}

/**
 * Short preview of a binary chunk for image-transfer visibility.
 * @param {Uint8Array} chunk
 * @param {number} [previewBytes]
 * @returns {string}
 */
export function formatBinaryChunkPreview(chunk, previewBytes = 32) {
  const shown = chunk.subarray(0, Math.min(previewBytes, chunk.length));
  const hex = [...shown]
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
  const suffix =
    chunk.length > previewBytes ? ` … (+${chunk.length - previewBytes} bytes)` : "";
  return `[binary ${chunk.length} B] ${hex}${suffix}`;
}
