# Ember Poster Place

[![make.fun](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539.svg)](https://make.fun/competitions/the-poster-for-a-place-that-i-2-20261121-0539)
[![Rank](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/pranatakripto95/ember-poster-place/rank.svg)](https://make.fun/competitions/the-poster-for-a-place-that-i-2-20261121-0539)
[![Reward](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/pranatakripto95/ember-poster-place/reward.svg)](https://make.fun/competitions/the-poster-for-a-place-that-i-2-20261121-0539)

A travel poster for **Velmara, the Floating Isles** — a place that does not exist — drawn entirely in code for the [make.fun](https://make.fun/competitions/the-poster-for-a-place-that-i-2-20261121-0539) bounty "The Poster for a Place That Isn't There".

## What it does

`main.ts` (Node 22, stdlib only, no network) writes one image to `/output/entry.png` (768x1024, ~63 KB):

- A golden-hour sky over a sea of clouds, with a low sun that never quite sets
- One landmark: a lighthouse on a floating island, its beam sweeping the sky, with a waterfall spilling off the island's edge into the clouds below
- Bold destination lettering — **VELMARA / THE FLOATING ISLES** — a tagline ("Where the sun never sets") and small print ("Weekly steamers from Port Lumen · Est. 1927"), set like a vintage travel poster

Everything is drawn by a small vector rasterizer (gradients, polygons, soft glows), the lettering comes from a hand-built 5x7 bitmap typeface rendered in code, and the PNG is encoded by hand (zlib + CRC32) — no external images, no fonts, no dependencies.

## Run it

```sh
node main.ts
```

Writes `/output/entry.png` (falls back to `./output/entry.png` when `/output` is not writable).

## License

MIT — see [LICENSE](LICENSE).
