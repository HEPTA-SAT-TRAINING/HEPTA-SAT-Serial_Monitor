# GitHub Pages deployment

## 1. Create the repository

Push this folder to `HEPTA-SAT-TRAINING/hepta-serial-viewer` on GitHub:

```bash
git remote add origin git@github.com:HEPTA-SAT-TRAINING/hepta-serial-viewer.git
git push -u origin main
```

## 2. Enable GitHub Pages

1. Open **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: `main`, folder: `/docs`
4. Save

After 1–3 minutes the app is available at:

```text
https://hepta-sat-training.github.io/hepta-serial-viewer/
```

## 3. Verify locally before push

```bash
node tools/verify_byte_line_buffer.mjs
node tools/verify_image_recovery.mjs
python -m http.server 8080 --directory docs
```

Open `http://localhost:8080` in Chrome or Edge.

## 4. Hardware smoke test (after Pages is live)

| Lab | Expected |
|-----|----------|
| Lab5-01 | `count from COM = ...` every second |
| Lab5-03 | `TEMP=...,VBAT=...` every second |
| Lab5-04 | Type `a` → 10× `AX=...,AY=...,AZ=...` |
| Lab5-05 | Type `p` → JPEG modal with Save button |

Baud rate: **38400** on both XBee modules (`BD=5`).
