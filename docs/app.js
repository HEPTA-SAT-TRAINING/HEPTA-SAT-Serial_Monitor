import { SerialConnection, formatPortLabel } from "./serial.js";
import { verifyCrc16SelfTest } from "./crc16.js";
import { ByteLineBuffer } from "./byte_line_buffer.js";
import { ImageAssembler } from "./image_assembler.js";
import { HexLineBuffer } from "./hex_format.js";
import { saveBlobWithPicker } from "./save_file.js";
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

const DisplayMode = {
  TEXT: "text",
  HEX: "hex",
};

/** @type {Record<string, string>} */
const LINE_ENDINGS = {
  none: "",
  lf: "\n",
  cr: "\r",
  crlf: "\r\n",
};

const PACKET_TIMEOUT_MS = 10000;
const IMAGE_TIMEOUT_MS = 60000;

/** @type {SerialConnection} */
const serial = new SerialConnection();

/** @type {PacketReceiver} */
const packetReceiver = new PacketReceiver();
const imageAssembler = new ImageAssembler();

let rxState = RxState.TEXT_MODE;
let displayMode = DisplayMode.TEXT;
let autoScroll = true;
const hexLineBuffer = new HexLineBuffer();
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
/** @type {SerialPort | null} */
let currentPort = null;
/** @type {HTMLElement | null} */
let imageProgressLine = null;
/** @type {string[]} */
const sendHistory = [];
let sendHistoryIndex = -1;
let sendHistoryDraft = "";

const el = {
  portDisplay: document.getElementById("port-display"),
  btnAddPort: document.getElementById("btn-add-port"),
  btnConnect: document.getElementById("btn-connect"),
  btnDisconnect: document.getElementById("btn-disconnect"),
  btnClear: document.getElementById("btn-clear"),
  btnSaveLog: document.getElementById("btn-save-log"),
  autoScroll: document.getElementById("auto-scroll"),
  baudrate: document.getElementById("baudrate"),
  displayMode: document.getElementById("display-mode"),
  lineEnding: document.getElementById("line-ending"),
  setupHint: document.getElementById("setup-hint"),
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
    if (displayMode === DisplayMode.HEX) {
      flushHexBuffer();
    }
    setConnectionUi(false);
    resetImageReceive("Disconnected during image receive");
    void syncCurrentPortPermission();
  };

  el.btnAddPort.addEventListener("click", onAddPort);
  el.btnConnect.addEventListener("click", onConnect);
  el.btnDisconnect.addEventListener("click", onDisconnect);
  el.btnClear.addEventListener("click", clearOutput);
  el.btnSaveLog.addEventListener("click", () => void saveLog());
  el.autoScroll.addEventListener("change", () => {
    autoScroll = el.autoScroll.checked;
  });
  el.displayMode.addEventListener("change", onDisplayModeChange);
  el.btnSend.addEventListener("click", onSendInput);
  el.sendInput.addEventListener("keydown", onSendInputKeydown);
  el.btnSaveJpeg.addEventListener("click", () => void saveJpeg());
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
  syncCurrentPortPermission();
  appendOutput(
    "Welcome — ① Select Port → ② Connect (38400 baud). View: Text or Hex.",
    "warn"
  );
}

function onDisplayModeChange() {
  const previousMode = displayMode;
  displayMode = el.displayMode.value === DisplayMode.HEX ? DisplayMode.HEX : DisplayMode.TEXT;
  textBuffer.takeRemaining();
  if (previousMode === DisplayMode.HEX && displayMode === DisplayMode.TEXT) {
    appendOutputLines(hexLineBuffer.flush(), "hex");
  }
  appendOutput(
    displayMode === DisplayMode.HEX
      ? "Display mode: Hex (raw bytes)"
      : "Display mode: Text (line-oriented)",
    "warn"
  );
}

/**
 * @param {string} message
 * @param {"system" | "error" | "warn" | "hex" | "binary"} [level]
 */
function appendOutput(message, level = "system") {
  const line = document.createElement("div");
  if (level !== "system") {
    line.className = `line-${level}`;
  }
  line.textContent = message;
  el.output.appendChild(line);
  scrollOutputIfNeeded();
}

function scrollOutputIfNeeded() {
  if (autoScroll) {
    el.output.scrollTop = el.output.scrollHeight;
  }
}

function getLineEndingSuffix() {
  const key = el.lineEnding.value;
  return LINE_ENDINGS[key] ?? "";
}

function resetSendHistoryNavigation() {
  sendHistoryIndex = -1;
  sendHistoryDraft = "";
}

/**
 * @param {string} text
 */
function pushSendHistory(text) {
  const last = sendHistory[sendHistory.length - 1];
  if (text !== last) {
    sendHistory.push(text);
    if (sendHistory.length > 100) {
      sendHistory.shift();
    }
  }
  resetSendHistoryNavigation();
}

/**
 * @param {number} direction -1 for older, +1 for newer
 */
function navigateSendHistory(direction) {
  if (sendHistory.length === 0) {
    return;
  }

  if (sendHistoryIndex === -1) {
    if (direction > 0) {
      return;
    }
    sendHistoryDraft = el.sendInput.value;
    sendHistoryIndex = sendHistory.length;
  }

  const nextIndex = sendHistoryIndex + direction;
  if (nextIndex < 0 || nextIndex > sendHistory.length) {
    return;
  }

  if (nextIndex === sendHistory.length) {
    sendHistoryIndex = -1;
    el.sendInput.value = sendHistoryDraft;
    return;
  }

  sendHistoryIndex = nextIndex;
  el.sendInput.value = sendHistory[sendHistoryIndex];
}

/**
 * @param {KeyboardEvent} event
 */
function onSendInputKeydown(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    void onSendInput();
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    navigateSendHistory(-1);
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    navigateSendHistory(1);
    return;
  }

  if (
    event.key !== "Tab" &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey
  ) {
    sendHistoryIndex = -1;
  }
}

function formatLineEndingLabel() {
  const key = el.lineEnding.value;
  if (key === "none") {
    return "";
  }
  if (key === "lf") {
    return " +LF";
  }
  if (key === "cr") {
    return " +CR";
  }
  if (key === "crlf") {
    return " +CRLF";
  }
  return "";
}

async function saveLog() {
  const text = el.output.innerText.trimEnd();
  if (!text) {
    appendOutput("Log is empty — nothing to save", "warn");
    return;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const blob = new Blob([text + "\n"], { type: "text/plain;charset=utf-8" });
  const suggestedName = `hepta_serial_log_${ts}.txt`;
  try {
    const savedName = await saveBlobWithPicker(
      blob,
      suggestedName,
      {
        description: "Text file",
        accept: { "text/plain": [".txt"] },
      }
    );
    appendOutput(`Saved log as ${savedName}`, "warn");
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      appendOutput("Save cancelled", "warn");
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    appendOutput(`Save failed: ${msg}`, "error");
  }
}

/**
 * @param {string[]} lines
 * @param {"hex" | "binary"} [level]
 */
function appendOutputLines(lines, level = "hex") {
  for (const message of lines) {
    appendOutput(message, level);
  }
}

/**
 * @param {Uint8Array} chunk
 */
function appendHexChunk(chunk) {
  appendOutputLines(hexLineBuffer.push(chunk), "hex");
}

function flushHexBuffer() {
  appendOutputLines(hexLineBuffer.flush(), "hex");
}

function clearOutput() {
  el.output.textContent = "";
  imageProgressLine = null;
  hexLineBuffer.reset();
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
  scrollOutputIfNeeded();
}

function clearImageProgressLine() {
  imageProgressLine = null;
}

function updateSetupHint() {
  const needsPort = !currentPort && !serial.isConnected;
  el.setupHint.hidden = !needsPort;
}

/**
 * @param {SerialPort} a
 * @param {SerialPort} b
 */
function isSamePort(a, b) {
  const aInfo = a.getInfo();
  const bInfo = b.getInfo();
  return (
    aInfo.usbVendorId === bInfo.usbVendorId &&
    aInfo.usbProductId === bInfo.usbProductId &&
    aInfo.bluetoothServiceClassId === bInfo.bluetoothServiceClassId
  );
}

function renderCurrentPort() {
  if (!currentPort) {
    el.portDisplay.textContent = "— no port selected —";
    el.portDisplay.title = "No COM port selected";
  } else {
    const label = formatPortLabel(currentPort, 0);
    el.portDisplay.textContent = label;
    el.portDisplay.title = `Current COM port: ${label}`;
  }
  updateSetupHint();
  updateConnectionStepButtons();
}

/**
 * @param {HTMLButtonElement} button
 * @param {boolean} isActive
 * @param {boolean} isDisabled
 */
function setStepButton(button, isActive, isDisabled = false) {
  button.disabled = isDisabled;
  button.classList.remove("btn-primary", "btn-step");
  button.classList.add(isActive ? "btn-primary" : "btn-step");
}

function updateConnectionStepButtons() {
  const connected = serial.isConnected;
  const hasPort = !!currentPort;

  setStepButton(el.btnAddPort, !connected && !hasPort, connected);
  setStepButton(el.btnConnect, !connected && hasPort, connected || !hasPort);
  setStepButton(el.btnDisconnect, connected, !connected);
}

function isPortGranted(port, ports) {
  return ports.some((granted) => granted === port || isSamePort(granted, port));
}

async function syncCurrentPortPermission() {
  let ports = [];
  try {
    ports = await SerialConnection.getGrantedPorts();
  } catch (err) {
    appendOutput(
      `Failed to list ports: ${err instanceof Error ? err.message : String(err)}`,
      "error"
    );
  }

  if (currentPort && ports.length > 0 && !isPortGranted(currentPort, ports)) {
    currentPort = null;
    appendOutput("Selected port permission is no longer available", "warn");
  }

  renderCurrentPort();
}

function getSelectedPort() {
  return currentPort;
}

async function onAddPort() {
  try {
    const port = await SerialConnection.requestNewPort();
    currentPort = port;
    renderCurrentPort();
    appendOutput(`Port selected: ${formatPortLabel(port, 0)}`, "warn");
    appendOutput("Now click Connect (step ②).", "warn");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("cancel")) {
      appendOutput(`Select port failed: ${msg}`, "error");
    }
  }
}

/**
 * @param {boolean} connected
 */
function setConnectionUi(connected) {
  el.baudrate.disabled = connected;
  updateConnectionStepButtons();

  const canSend = connected && !imageReceiving;
  el.sendInput.disabled = !canSend;
  el.btnSend.disabled = !canSend;
  el.lineEnding.disabled = !canSend;

  el.connectionStatus.textContent = connected
    ? imageReceiving
      ? "Connected (receiving image)"
      : "Connected"
    : "Disconnected";
  el.connectionStatus.className = `status-badge ${
    connected ? (imageReceiving ? "receiving" : "connected") : "disconnected"
  }`;

  updateSetupHint();
}

/**
 * @param {Uint8Array} chunk
 */
function onSerialChunk(chunk) {
  if (displayMode === DisplayMode.HEX) {
    appendHexChunk(chunk);
  }

  if (rxState === RxState.IMAGE_PACKET_RX) {
    processImageChunk(chunk);
    return;
  }

  processTextChunk(chunk);
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
        if (displayMode !== DisplayMode.HEX) {
          appendOutput("IMG_END");
        }
        continue;
      }
      beginImageReceive();
      const remainder = textBuffer.takeRemaining();
      if (remainder.length > 0) {
        processImageChunk(remainder);
      }
      return;
    }

    if (line && displayMode !== DisplayMode.HEX) {
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
  if (displayMode !== DisplayMode.HEX) {
    appendOutput("IMG_BEGIN — binary image packets follow (HP…)", "warn");
  }
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
    if (displayMode !== DisplayMode.HEX) {
      appendOutput(
        `START: id=${meta.imageId}, size=${meta.imageSize}, image_crc=0x${meta.imageCrc16.toString(16).padStart(4, "0")}, total_packets=${packet.total}`,
        "warn"
      );
    }
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
    if (displayMode === DisplayMode.HEX) {
      appendHexChunk(packetReceiver.buffer);
    } else {
      processTextChunk(packetReceiver.buffer);
    }
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
  let port = getSelectedPort();
  if (!port) {
    appendOutput("No port selected — opening port picker…", "warn");
    await onAddPort();
    port = getSelectedPort();
    if (!port) {
      return;
    }
  }

  const baud = parseInt(el.baudrate.value, 10);
  if (!Number.isFinite(baud) || baud <= 0) {
    appendOutput("Invalid baudrate", "error");
    return;
  }

  const portLabel = formatPortLabel(port, 0);

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
  const suffix = getLineEndingSuffix();
  if (!text && !suffix) {
    return;
  }

  try {
    await serial.write(text + suffix);
    appendOutput(`> ${text}${formatLineEndingLabel()}`, "warn");
    pushSendHistory(text);
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

async function saveJpeg() {
  if (!currentImageBlob) {
    return;
  }
  const id = lastImageId;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const suggestedName = `hepta_image_${id}_${ts}.jpg`;
  try {
    const savedName = await saveBlobWithPicker(
      currentImageBlob,
      suggestedName,
      {
        description: "JPEG image",
        accept: { "image/jpeg": [".jpg"] },
      }
    );
    appendOutput(`Saved JPEG as ${savedName}`, "warn");
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      appendOutput("Save cancelled", "warn");
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    appendOutput(`Save failed: ${msg}`, "error");
  }
}

init();
