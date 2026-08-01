# 🚀 Rockets & Satellites

An interactive, video-game-style encyclopedia of the major rockets and
satellites that have left Earth. Pick a craft like a character in a game, read
its story, and **watch it fly to its real destination in a 3D animation**.

![Explore Space](https://img.shields.io/badge/status-live-brightgreen) &nbsp; ![No build step](https://img.shields.io/badge/build-none-blue)

## ✨ What's inside

- **Home** — two big buttons: **Rockets** and **Satellites**.
- **Each section** offers two choices:
  - **See the parts** of a famous craft — an interactive, numbered anatomy diagram.
  - **Explore all** — a video-game "character select" screen. Use the **‹ ›
    arrows** (or your keyboard's left/right keys) to browse the whole roster.
- **Detail page** for every craft — big mission headline, who built it, where it
  went, why it went, and what was discovered, in large, readable type.
- **3D animation** — click **"Watch it fly"** on any craft to see a procedurally
  built model launch from Earth and travel along a real trajectory to the Moon,
  Mars, the Sun, Jupiter, Saturn, Pluto, interstellar space, and more. Drag to
  orbit the camera; hit **Replay** to watch again.

Currently **20 rockets** and **20 satellites**, from Sputnik 1 to Starship.

## ▶️ Running it locally

It's plain HTML/CSS/JavaScript — no build step, no dependencies to install.
Because it uses ES modules, it must be served over HTTP (not opened as a
`file://`). Any static server works:

```bash
python3 -m http.server 8099
```

Then open <http://localhost:8099>.

> Three.js (for the 3D scenes) is loaded from a CDN via an import map in
> `index.html`, so you need an internet connection the first time it loads.

## 🌐 Deploying to GitHub Pages

1. Push this folder to your repository's default branch.
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to *Deploy from a branch*,
   pick your branch and the `/ (root)` folder, and save.
4. Your site goes live at `https://<user>.github.io/<repo>/` in a minute or two.

No configuration or build is required — the files are served as-is.

## ➕ Adding a new rocket or satellite

Everything is data-driven. Open [`js/data.js`](js/data.js), copy an existing
entry in the `ROCKETS` or `SATELLITES` array, and fill in the fields. A new
gallery card, detail page, and 3D animation are generated automatically — you
don't touch any other file. The field guide is documented at the top of
`js/data.js`.

Key fields:

- `mission`, `builtBy`, `where`, `why`, `discovered` — the page text.
- `facts` — the quick-spec chips.
- `destination` — drives the 3D scene (`Moon`, `Mars`, `Sun`, `Jupiter`,
  `Saturn`, `Pluto`, `Venus`, `Comet`, `Interstellar`, `LEO`, `GTO`, `L2`,
  `DeepSpace`, `Suborbital`).
- `viz` — parameters for the procedural 3D model.
- `anatomy` *(optional)* — add this array to enable a "See its parts" diagram.

## 🗂️ Project structure

```
index.html        Page shell + Three.js import map
css/styles.css    All styling (space theme, large fonts)
js/data.js        THE DATA — every rocket & satellite lives here
js/app.js         Router + all page rendering
js/scene3d.js     The 3D launch/flight animation engine (Three.js)
js/anatomy.js     Interactive "parts" diagram builder (SVG)
js/stars.js       Twinkling starfield background
```

## 🛠️ Built with

Vanilla JavaScript (ES modules) · [Three.js](https://threejs.org/) · SVG · HTML Canvas.
No framework, no bundler.
