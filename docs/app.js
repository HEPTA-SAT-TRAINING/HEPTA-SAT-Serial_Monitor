import { SerialConnection, formatPortLabel } from "./serial.js";
import { verifyCrc16SelfTest } from "./crc16.js";
import { ByteLineBuffer } from "./byte_line_buffer.js";
import { ImageAssembler } from "./image_assembler.js";
import {
  PacketReceiver,
  PACKET_TYPE_END,
  PACKET_TYPE_ERROR,
  ERROR_MESSAGES,
} from "./packet.js";

const RxState = {
  TEXT_MODE: "TEXT_MODE",
  IMAGE_PACKET_RX: "IMAGE_PACKET_RX",
};

const PACKET_TIMEOUT_MS = 10000;
const IMAGE_TIMEOUT_MS = 60000;

/** @type {SerialConnection} */
const serial = new SerialConnection();

/** @type {PacketReceiver} */
const packetReceiver = new PacketReceiver();
const imageAssembler = new ImageAssembler();

let rxState = RxState.TEXT_MODE;
const textBuffer = new ByteLineBuffer();
const textDecoder = new TextDecoder();
let imageReceiving = false;
/** @type {Blob | null} */
let currentImageBlob = null;
let lastImageId = 0;
/** @type {number | null} */
let packetTimer = null;
/** @type {number | null} */
let imageTimer = null;
/** @type {SerialPort[]} */
let grantedPorts = [];
/** @type {HTMLElement | null} */
let imageProgressLine = null;

const el = {
  portSelect: document.getElementById("port-select"),
  btnAddPort: document.getElementById("btn-add-port"),
  btnRefreshPorts: document.getElementById("btn-refresh-ports"),
  btnConnect: document.getElementById("btn-connect"),
  btnDisconnect: document.getElementById("btn-disconnect"),
  btnClear: document.getElementById("btn-clear"),
  baudrate: document.getElementById("baudrate"),
  connectionStatus: document.getElementById("connection-status"),
  output: document.getElementById("output"),
  sendInput: document.getElementById("send-input"),
  btnSend: document.getElementById("btn-send"),
  imageModal: document.getElementById("image-modal"),
  modalTitle: document.getElementById("modal-title"),
  modalStatus: document.getElementById("modal-status"),
  modalPreview: document.getElementById("modal-preview"),
  btnSaveJpeg: document.getElementById("btn-save-jpeg"),
  btnModalClose: document.getElementById("btn-modal-close"),
  btnModalDismiss: document.getElementById("btn-modal-dismiss"),
  errorModal: document.getElementById("error-modal"),
  errorModalMessage: document.getElementById("error-modal-message"),
  btnErrorClose: document.getElementById("btn-error-close"),
  btnErrorDismiss: document.getElementById("btn-error-dismiss"),
};

function init() {
  if (!verifyCrc16SelfTest()) {
    console.error("CRC-16 self-test failed");
    appendOutput("ERROR: CRC-16 self-test failed (expected 0x29B1 for '123456789')", "error");
  } else {
    console.log("CRC-16 self-test passed (0x29B1)");
  }

  serial.onData = onSerialChunk;
  serial.onError = (err) => {
    appendOutput(`Serial error: ${err.message}`, "error");
    setConnectionUi(false);
  };
  serial.onDisconnect = () => {
    appendOutput("Serial port disconnected", "warn");
    setConnectionUi(false);
    resetImageReceive("Disconnected during image receive");
  };

  el.btnAddPort.addEventListener("click", onAddPort);
  el.btnRefreshPorts.addEventListener("click", () => refreshPortList());
  el.portSelect.addEventListener("change", updateConnectButton);
  el.btnConnect.addEventListener("click", onConnect);
  el.btnDisconnect.addEventListener("click", onDisconnect);
  el.btnClear.addEventListener("click", clearOutput);
  el.btnSend.addEventListener("click", onSendInput);
  el.sendInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onSendInput();
    }
  });
  el.btnSaveJpeg.addEventListener("click", saveJpeg);
  el.btnModalClose.addEventListener("click", hideImageModal);
  el.btnModalDismiss.addEventListener("click", hideImageModal);
  el.btnErrorClose.addEventListener("click", hideErrorModal);
  el.btnErrorDismiss.addEventListener("click", hideErrorModal);

  for (const backdrop of document.querySelectorAll("[data-dismiss]")) {
    backdrop.addEventListener("click", (event) => {
      const target = event.currentTarget;
      if (target instanceof HTMLElement) {
        if (target.dataset.dismiss === "modal") {
          hideImageModal();
        } else if (target.dataset.dismiss === "error-modal") {
          hideErrorModal();
        }
      }
    });
  }

  setConnectionUi(false);
  refreshPortList();
}

/**
 * @param {string} message
 * @param {"system" | "error" | "warn"} [level]
 */
function appendOutput(message, level = "system") {
  const line = document.createElement("div");
  if (level !== "system") {
    line.className = `line-${level}`;
  }
  line.textContent = message;
  el.output.appendChild(line);
  el.output.scrollTop = el.output.scrollHeight;
}

function clearOutput() {
  el.output.textContent = "";
  imageProgressLine = null;
}

/**
 * @param {string} text
 */
function updateImageProgressLine(text) {
  if (!imageProgressLine) {
    imageProgressLine = document.createElement("div");
    imageProgressLine.className = "line-warn";
    el.output.appendChild(imageProgressLine);
  }
  imageProgressLine.textContent = text;
  el.output.scrollTop = el.output.scrollHeight;
}

function clearImageProgressLine() {
  imageProgressLine = null;
}

/**
 * @param {SerialPort | null | undefined} selectPort
 */
async function refreshPortList(selectPort) {
  const previousIndex = el.portSelect.value;

  try {
    grantedPorts = await SerialConnection.getGrantedPorts();
  } catch (err) {
    appendOutput(
      `Failed to list ports: ${err instanceof Error ? err.message : String(err)}`,
      "error"
    );
    grantedPorts = [];
  }

  el.portSelect.textContent = "";

  if (grantedPorts.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No port — click Add Port";
    option.disabled = true;
    option.selected = true;
    el.portSelect.appendChild(option);
  } else {
    grantedPorts.forEach((port, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = formatPortLabel(port, index);
      el.portSelect.appendChild(option);
    });

    if (selectPort) {
      const idx = grantedPorts.indexOf(selectPort);
      if (idx >= 0) {
        el.portSelect.value = String(idx);
      }
    } else if (previousIndex !== "" && Number(previousIndex) < grantedPorts.length) {
      el.portSelect.value = previousIndex;
    } else {
      el.portSelect.value = "0";
    }
  }

  updateConnectButton();
}

function updateConnectButton() {
  const hasSelection =
    grantedPorts.length > 0 && el.portSelect.value !== "" && !serial.isConnected;
  el.btnConnect.disabled = !hasSelection;
}

function getSelectedPort() {
  if (el.portSelect.value === "") {
    return null;
  }
  const index = Number(el.portSelect.value);
  if (!Number.isInteger(index) || index < 0 || index >= grantedPorts.length) {
    return null;
  }
  return grantedPorts[index];
}

async function onAddPort() {
  try {
    const port = await SerialConnection.requestNewPort();
    await refreshPortList(port);
    appendOutput(`Port added: ${formatPortLabel(port, grantedPorts.indexOf(port))}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("cancel")) {
      appendOutput(`Add port failed: ${msg}`, "error");
    }
  }
}

/**
 * @param {boolean} connected
 */
function setConnectionUi(connected) {
  el.btnDisconnect.disabled = !connected;
  el.portSelect.disabled = connected;
  el.btnAddPort.disabled = connected;
  el.btnRefreshPorts.disabled = connected;
  el.baudrate.disabled = connected;
  updateConnectButton();
  if (connected) {
    el.btnConnect.disabled = true;
  }

  const canSend = connected && !imageReceiving;
  el.sendInput.disabled = !canSend;
  el.btnSend.disabled = !canSend;

  el.connectionStatus.textContent = connected
    ? imageReceiving
      ? "Connected (receiving image)"
      : "Connected"
    : "Disconnected";
  el.connectionStatus.className = `status-badge ${
    connected ? (imageReceiving ? "receiving" : "connected") : "disconnected"
  }`;
}

/**
 * @param {Uint8Array} chunk
 */
function onSerialChunk(chunk) {
  if (rxState === RxState.TEXT_MODE) {
    processTextChunk(chunk);
  } else {
    processImageChunk(chunk);
  }
}

/**
 * @param {Uint8Array} chunk
 */
function processTextChunk(chunk) {
  textBuffer.push(chunk);

  while (true) {
    const lineBytes = textBuffer.shiftLine();
    if (lineBytes === null) {
      break;
    }

    const line = textDecoder.decode(lineBytes);

    if (line === "IMG_BEGIN" || line === "IMG_END") {
      if (line === "IMG_END") {
        appendOutput("IMG_END");
        continue;
      }
      beginImageReceive();
      const remainder = textBuffer.takeRemaining();
      if (remainder.length > 0) {
        processImageChunk(remainder);
      }
      return;
    }

    if (line) {
      appendOutput(line);
    }
  }
}

function beginImageReceive() {
  rxState = RxState.IMAGE_PACKET_RX;
  imageReceiving = true;
  packetReceiver.reset();
  imageAssembler.reset();

  if (currentImageBlob) {
    URL.revokeObjectURL(el.modalPreview.src);
    currentImageBlob = null;
  }
  el.modalPreview.removeAttribute("src");

  clearImageProgressLine();
  updateImageProgressLine("Receiving image... 0 / 0 bytes");

  startImageTimeout();
  resetPacketTimeout();
  setConnectionUi(true);
  appendOutput("IMG_BEGIN — switching to binary packet mode", "warn");
}

/**
 * @param {Uint8Array} chunk
 */
function processImageChunk(chunk) {
  const packets = packetReceiver.push(chunk);
  for (const error of packetReceiver.drainErrors()) {
    appendOutput(error, "warn");
  }

  for (const packet of packets) {
    resetPacketTimeout();

    try {
      handleImagePacket(packet);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      abortImageReceive(`Packet error: ${msg}`);
      return;
    }
    if (!imageReceiving) {
      break;
    }
  }

  if (imageReceiving && packetReceiver.drainFooterCount() > 0) {
    try {
      completeImageReceive("IMG_END fallback");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      abortImageReceive(`Image error: ${msg}`);
    }
  }
}

/**
 * @param {ReturnType<import("./packet.js").parsePacket>} packet
 */
function handleImagePacket(packet) {
  if (packet.type === PACKET_TYPE_ERROR) {
    handleErrorPacket(packet);
    return;
  }
  const hadMeta = imageAssembler.meta !== null;
  imageAssembler.accept(packet);
  if (!hadMeta && imageAssembler.meta) {
    const meta = imageAssembler.meta;
    updateImageProgressLine(`Receiving image... 0 / ${meta.imageSize} bytes`);
    appendOutput(
      `START: id=${meta.imageId}, size=${meta.imageSize}, image_crc=0x${meta.imageCrc16.toString(16).padStart(4, "0")}, total_packets=${packet.total}`,
      "warn"
    );
  }
  if (imageAssembler.meta) {
    updateImageProgressLine(
      `Receiving image... ${imageAssembler.receivedBytes()} / ${imageAssembler.meta.imageSize} bytes`
    );
  }
  if (packet.type === PACKET_TYPE_END) {
    completeImageReceive("END packet");
  }
}

function completeImageReceive(terminalSource) {
  const result = imageAssembler.finalize();
  lastImageId = result.meta.imageId;
  currentImageBlob = new Blob([result.image], { type: "image/jpeg" });

  const recoveryText =
    result.recoveredSeq === null ? "" : `, recovered packet ${result.recoveredSeq}`;
  const summary =
    `Image complete via ${terminalSource}: ${result.meta.imageSize} bytes, id=${result.meta.imageId}, CRC OK (0x${result.computedCrc.toString(16).padStart(4, "0")})${recoveryText}`;

  clearImageProgressLine();
  appendOutput(summary, "warn");
  showImageModal(currentImageBlob, result.meta.imageSize, result.meta.imageId, recoveryText);

  finishImageReceive();
}

/**
 * @param {{ payload: Uint8Array }} packet
 */
function handleErrorPacket(packet) {
  const code = packet.payload.length > 0 ? packet.payload[0] : 0;
  const desc = ERROR_MESSAGES[code] ?? `unknown error 0x${code.toString(16)}`;
  abortImageReceive(`ERROR packet: ${desc} (0x${code.toString(16).padStart(2, "0")})`);
}

function flushPacketBufferToText() {
  if (packetReceiver.buffer.length > 0) {
    processTextChunk(packetReceiver.buffer);
    packetReceiver.reset();
  }
}

function finishImageReceive() {
  clearTimeouts();
  rxState = RxState.TEXT_MODE;
  imageReceiving = false;
  imageAssembler.reset();
  flushPacketBufferToText();
  setConnectionUi(serial.isConnected);
  appendOutput("Image receive complete — back to text mode", "warn");
}

/**
 * @param {string} reason
 */
function abortImageReceive(reason) {
  clearImageProgressLine();
  appendOutput(reason, "error");
  showErrorModal(reason);
  resetImageReceive();
}

/**
 * @param {string} [reason]
 */
function resetImageReceive(reason) {
  clearTimeouts();
  rxState = RxState.TEXT_MODE;
  imageReceiving = false;
  clearImageProgressLine();
  flushPacketBufferToText();
  imageAssembler.reset();
  setConnectionUi(serial.isConnected);
  if (reason) {
    appendOutput(reason, "error");
  }
}

function clearTimeouts() {
  if (packetTimer !== null) {
    clearTimeout(packetTimer);
    packetTimer = null;
  }
  if (imageTimer !== null) {
    clearTimeout(imageTimer);
    imageTimer = null;
  }
}

function resetPacketTimeout() {
  if (packetTimer !== null) {
    clearTimeout(packetTimer);
  }
  packetTimer = setTimeout(() => {
    abortImageReceive("Packet timeout (10 s)");
  }, PACKET_TIMEOUT_MS);
}

function startImageTimeout() {
  if (imageTimer !== null) {
    clearTimeout(imageTimer);
  }
  imageTimer = setTimeout(() => {
    abortImageReceive("Image timeout (60 s)");
  }, IMAGE_TIMEOUT_MS);
}

async function onConnect() {
  const port = getSelectedPort();
  if (!port) {
    appendOutput("Select a COM port or click Add Port", "error");
    return;
  }

  const baud = parseInt(el.baudrate.value, 10);
  if (!Number.isFinite(baud) || baud <= 0) {
    appendOutput("Invalid baudrate", "error");
    return;
  }

  const portLabel = formatPortLabel(port, Number(el.portSelect.value));

  try {
    await serial.connect(port, baud);
    setConnectionUi(true);
    appendOutput(`Connected to ${portLabel} at ${baud} baud`, "warn");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("cancel")) {
      appendOutput(`Connect failed: ${msg}`, "error");
    }
  }
}

async function onDisconnect() {
  try {
    await serial.disconnect();
  } catch (err) {
    appendOutput(`Disconnect error: ${err instanceof Error ? err.message : String(err)}`, "error");
  }
  resetImageReceive();
  setConnectionUi(false);
  appendOutput("Disconnected", "warn");
}

async function onSendInput() {
  if (!serial.isConnected || imageReceiving) {
    return;
  }

  const text = el.sendInput.value;
  if (!text) {
    return;
  }

  try {
    await serial.write(text);
    appendOutput(`> ${text}`, "warn");
    el.sendInput.value = "";

    if (text === "p") {
      appendOutput("Waiting for IMG_BEGIN...", "warn");
    }
  } catch (err) {
    appendOutput(`Send failed: ${err instanceof Error ? err.message : String(err)}`, "error");
  }
}

/**
 * @param {Blob} blob
 * @param {number} size
 * @param {number} imageId
 * @param {string} recoveryText
 */
function showImageModal(blob, size, imageId, recoveryText) {
  if (el.modalPreview.src) {
    URL.revokeObjectURL(el.modalPreview.src);
  }
  el.modalPreview.src = URL.createObjectURL(blob);
  el.modalTitle.textContent = "Image received";
  el.modalStatus.textContent = `${size} bytes, id=${imageId}${recoveryText}`;
  el.imageModal.hidden = false;
}

function hideImageModal() {
  el.imageModal.hidden = true;
}

/**
 * @param {string} message
 */
function showErrorModal(message) {
  el.errorModalMessage.textContent = message;
  el.errorModal.hidden = false;
}

function hideErrorModal() {
  el.errorModal.hidden = true;
}

function saveJpeg() {
  if (!currentImageBlob) {
    return;
  }
  const id = lastImageId;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(currentImageBlob);
  a.download = `hepta_image_${id}_${ts}.jpg`;
  a.click();
  URL.revokeObjectURL(a.href);
  appendOutput(`Saved JPEG as ${a.download}`, "warn");
}

init();
