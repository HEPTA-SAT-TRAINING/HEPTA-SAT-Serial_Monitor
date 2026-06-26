# HEPTA Serial Viewer

Browser-based serial monitor for HEPTA-SAT Lab5 exercises. Connect over USB, view downlinked text in a terminal-style output, send commands, and decode JPEG images (Lab5-05).

## Quick start

Open in **Chrome, Edge, or Firefox** (no install required). **Safari is not supported.**

```text
https://hepta-sat-training.github.io/HEPTA-SAT-Serial_Monitor/
```

1. Click **Select & Connect Port** and choose your COM port in the browser dialog (baud rate **38400**)
2. Read serial output in the main pane
3. Type commands in the input bar (`a` for accelerometer, `p` for image in Lab5-04/05)
4. Click **Disconnect** when you need to release the port for other apps

See [docs/README.md](docs/README.md) for full usage, display modes, and protocol details.

## Deployment (maintainers)

Production builds use **esbuild** to bundle `docs/` into `dist/` with content-hashed filenames (`app-XXXX.js`, `styles-XXXX.css`) so browsers never serve stale JavaScript after an update.

```bash
npm install
npm run build    # outputs to dist/
```

Pushes to `main` run `.github/workflows/deploy.yml`, which builds and deploys `dist/` to GitHub Pages.

**One-time GitHub setup:** In the repository **Settings → Pages**, set **Source** to **GitHub Actions** (not “Deploy from branch /docs”). After the first successful workflow run, the live site uses the bundled build.

**Local development** still serves `docs/` directly (no build required):

```bash
cd docs
python -m http.server 8080
# open http://localhost:8080
```
