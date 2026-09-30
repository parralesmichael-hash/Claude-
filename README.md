# Card Snap

A phone web app for photographing Pokémon (and other) trading cards for eBay listings.

For each card it produces:

| # | File | What it is |
|---|------|------------|
| 01 | `front.jpg` | Front, auto-cropped to the card edges |
| 02 | `back.jpg` | Back, auto-cropped |
| 03 | `front-corners.jpg` | 2×2 grid of the four front corners, enlarged |
| 04 | `back-corners.jpg` | Same for the back |
| 05–08 | `closeup-*.jpg` | Optional real close-up shot of each corner |

Files are named from the card name you type (e.g. `charizard-4-102_01_front.jpg`) so they sort in listing order.

## Features
- Live camera with a card-shaped guide and **auto-capture**: fires when the phone holds still.
- Finds the card's real edges on a plain background and crops to them. It falls back to the guide box and warns you if it can't.
- **Blur check** flags soft photos before you list.
- Retake any single shot.
- **Save / Share** sends the photos straight to your Photos app (iPhone "Save Images") or the eBay app. You can also download a .zip per card or for the whole session.
- Installs to the home screen and works offline. Photos never leave your phone unless you share them.

## Hosting it (free, GitHub Pages)
1. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
2. Choose this branch and the `/ (root)` folder, then Save.
3. After a minute the site is live at `https://<your-username>.github.io/<repo-name>/`.
4. Open that link on your phone:
   - **iPhone (Safari):** Share → *Add to Home Screen*
   - **Android (Chrome):** ⋮ menu → *Install app*

The camera needs HTTPS, which GitHub Pages provides.

## Tips for pro-looking photos
- Use a plain, dark, matte background (a black mouse pad or felt works great). The auto-crop relies on this contrast.
- Use bright, indirect light, like a window or two lamps angled at 45°. Avoid direct overhead light on holos.
- For sleeved or toploadered cards, tilt slightly to push glare off the card.
- Phones can't focus closer than about 10 cm, so for close-ups use the **zoom slider** from farther back rather than moving closer.

## Run locally
```sh
python3 -m http.server 8000   # then open http://localhost:8000
```
