# slomo.tech

The SloMo Zone website: Touch To Slow for sports video, with a live demo.

A static site with no build step. `index.html` is the page; the video, poster, logo, icons and share picture sit beside it.

Hosted with GitHub Pages from the `main` branch. `CNAME` tells GitHub the site lives at slomo.tech.

The clip is played by `tts-engine.js`, which decodes the video itself (WebCodecs) and paints frames to a canvas, so touch answers on the next screen refresh. Browsers that cannot do this, and any clip the engine fails on, fall back to the browser's own video player.
