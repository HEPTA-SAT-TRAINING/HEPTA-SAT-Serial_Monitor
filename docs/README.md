# HEPTA Serial Viewer

VS Code Serial Monitor–style web app for HEPTA-SAT Lab5. Receives text downlink over Web Serial, sends single-character commands, and decodes JPEG images when `IMG_BEGIN` is detected.

## Getting started (GitHub Pages)

```text
https://hepta-sat-training.github.io/hepta-serial-viewer/
```

Use **Chrome or Edge**. No additional tools need to be installed.

## Requirements

- **Browser**: Chrome or Edge (Web Serial API)
- **Connection**: HTTPS or `localhost`
- **Default baud rate**: **38400** (fixed HEPTA COM / XBee `BD=5` setting)

## Usage

1. Click **Add Port** and authorize a COM port
2. Select the port from the dropdown
3. Click **Connect**
4. Serial output appears in the main pane
5. Type a command in the input bar and press **Enter** or **Send**
   - Lab5-04/05: `a` — accelerometer (10 lines)
   - Lab5-05: `p` — JPEG image (opens in a modal when complete)
6. Click **Clear** to reset the output pane

> Only COM ports previously authorized via **Add Port** appear in the dropdown. Use **Refresh** to reload the list.

## Lab compatibility

| Lab | Typical output | Commands |
|-----|----------------|----------|
| Lab5-01 | `count from COM = ...` | — |
| Lab5-02 | count + command echo | any character |
| Lab5-03 | HK telemetry (`TEMP=...`) | any character |
| Lab5-04 | HK + `AX=...` after `a` | `a` |
| Lab5-05 | HK + accel + JPEG | `a`, `p` |

## Image protocol (Lab5-05)

| Command | Description |
|---------|-------------|
| `a` | Accelerometer text (`AX=...,AY=...,AZ=...`) |
| `p` | Image as binary packets |

Image transfer sequence:

```text
IMG_BEGIN\n
START packet x2 (TYPE=0x01)
DATA packets (TYPE=0x02, 64-byte payload)
XOR parity packet (TYPE=0x05)
END packet (TYPE=0x03)
\nIMG_END\n
```

Packet format: MAGIC `HP` + TYPE + SEQ + TOTAL + LEN + CRC16 + PAYLOAD (little endian, CRC-16/CCITT-FALSE).

## File layout

```text
docs/
  index.html          UI shell
  styles.css          VS Code–style layout
  app.js              State machine and UI
  serial.js           Web Serial connection
  crc16.js            CRC-16/CCITT-FALSE
  packet.js           Binary packet parser
  image_assembler.js  Loss-tolerant image reconstruction
  byte_line_buffer.js Line-oriented text buffer
```

## Troubleshooting

- **Cannot connect**: Use Chrome/Edge over HTTPS or `localhost`
- **No data**: Confirm baud rate 38400 and XBee `BD=5` on both modules
- **Image error**: A single lost packet is recovered automatically; retry `p` if multiple losses occur
- **Packet timeout**: Transfer aborts after 10 s without a valid packet; image overall timeout is 60 s
