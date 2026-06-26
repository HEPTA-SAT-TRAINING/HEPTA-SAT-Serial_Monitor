# HEPTA Serial Viewer

VS Code Serial Monitor–style web app for HEPTA-SAT Lab5. Receives text downlink over Web Serial, sends single-character commands, and decodes JPEG images when `IMG_BEGIN` is detected.

## Getting started

```text
https://hepta-sat-training.github.io/HEPTA-SAT-Serial_Monitor/
```

Use **Chrome, Edge, or Firefox**. **Safari is not supported**. No additional tools need to be installed.

## Requirements

- **Browser**: Chrome, Edge, or Firefox (Web Serial API)
- **Not supported**: Safari (no Web Serial API support)
- **Connection**: HTTPS or `localhost`
- **Default baud rate**: **38400** (fixed HEPTA COM / XBee `BD=5` setting)

## Usage

1. Click **Select & Connect Port** and choose the COM port in the browser dialog (it connects automatically once selected)
2. Serial output appears in the main pane
3. Set **View** to **Text** (line-oriented) or **Hex** (raw byte dump)
4. Type a command in the input bar and press **Enter** or **Send**
   - Set **EOL** (line ending) if needed — default **None** (single character commands for Lab5)
   - Lab5-04/05: `a` — accelerometer (10 lines)
   - Lab5-05: `p` — JPEG image (progress line + modal on complete; use View: Hex to inspect raw packets)
6. Uncheck **Auto scroll** to freeze the output while reviewing older lines
7. Click **Save Log** to open a Save dialog and save the output as a `.txt` file
8. Click **Clear** to reset the output pane
9. Click **Disconnect** to release the COM port for other apps

> To switch to a different COM port, click **Disconnect** first, then **Change Port…** and choose the new port — it connects automatically once selected, just like the first connection.

### Display modes

| View | Behavior |
|------|----------|
| **Text** | HK / count / accel lines as plain text; image packets are not shown (progress line + modal on complete) |
| **Hex** | All received bytes as offset + hex dump (16 bytes per line), including during JPEG transfer; no decoded text lines |

### Saving files (Log / JPEG)

- **Save Log**: opens the browser's native Save dialog (default filename stays the same).
- **Save JPEG**: opens the browser's native Save dialog from the image modal (default filename stays the same).

**Default folder**: Web apps cannot reliably force a specific directory for all users/OS. This app lets the browser decide (typically it reopens the last folder used for this site / uses the platform's default).

### Send options

| EOL | Appended on send |
|-----|------------------|
| **None** (default) | nothing — use for Lab5 single-character commands (`a`, `p`) |
| **LF** | `\n` |
| **CR** | `\r` |
| **CRLF** | `\r\n` |

Sent commands are echoed in the log as `> command` with `+LF` / `+CR` / `+CRLF` when a line ending is appended.

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
  hex_format.js       Hex dump and binary preview formatting
```

## Troubleshooting

- **Cannot connect**: Use Chrome/Edge/Firefox over HTTPS or `localhost` (Safari is not supported)
- **No data**: Confirm baud rate 38400 and XBee `BD=5` on both modules
- **Image OK**: A single lost DATA packet is recovered automatically via XOR parity
- **Damaged image**: If 2+ DATA packets are missing, CRC fails, or a timeout occurs while some data was received, the app shows an **Image received (damaged)** modal with a packet map (green / yellow / red) and may still attempt to preview the corrupt JPEG
- **Decode failed**: A damaged JPEG may not render in the browser; you can still save the received bytes from the modal
- **Packet timeout**: After 10 s without a valid packet, the app tries to show a damaged image if any DATA was received; otherwise it shows an error. Overall image timeout is 60 s
