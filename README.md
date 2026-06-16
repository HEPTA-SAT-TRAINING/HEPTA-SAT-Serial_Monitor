# HEPTA Serial Viewer

Browser-based serial monitor for HEPTA-SAT Lab5 exercises. Connect over USB, view downlinked text in a terminal-style output, send commands, and decode JPEG images (Lab5-05).

## Quick start

Open in **Chrome or Edge** (no install required):

```text
https://hepta-sat-training.github.io/hepta-serial-viewer/
```

1. **Add Port** → select your COM port
2. Leave baud rate at **38400**, then click **Connect**
3. Read serial output in the main pane
4. Type commands in the input bar (`a` for accelerometer, `p` for image in Lab5-04/05)

See [docs/README.md](docs/README.md) for full usage and protocol details.

## Local development

```bash
python -m http.server 8080 --directory docs
```

Open `http://localhost:8080`.

## GitHub Pages

Configure **Settings → Pages**: Branch=`main`, Folder=`/docs`.

## Verify scripts

```bash
node tools/verify_byte_line_buffer.mjs
node tools/verify_image_recovery.mjs
```
