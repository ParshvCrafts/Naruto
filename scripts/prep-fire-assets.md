# Fire asset prep (S17 Fireball)

Source clips live in `assets/extra_for_future/` (raw, untracked-heavy — do not ship).
Both chosen sources are on a **black** background, so the app composites them with
`globalCompositeOperation = 'screen'` (black → transparent) — the same path Rasengan
and Chidori use. No chroma-key / alpha-webm needed.

Requires ffmpeg on PATH (winget install ffmpeg).

## Side flame (breath jet) → assets/effects/fireball.mp4
Directional orange flame on black. 4K source, take the 2s–6s window (flame at full
body), scale to 1280 wide, H.264 yuv420p, no audio.

```bash
ffmpeg -y -ss 2 -t 4 \
  -i "assets/extra_for_future/vecteezy_orange-flames-on-black-background-for-dramatic-effect-and_69244018.mov" \
  -vf "scale=1280:-2" -c:v libx264 -profile:v high -pix_fmt yuv420p \
  -crf 26 -movflags +faststart -an assets/effects/fireball.mp4
```
Result: ~680 KB.

## Front burst (ignition flash) → assets/effects/fireball_burst.mp4
Full-frame fire explosion (also on black), used for the brief ignition moment.

```bash
ffmpeg -y -i "assets/extra_for_future/Fireball - Front.mp4" \
  -vf "scale=960:-2" -c:v libx264 -pix_fmt yuv420p \
  -crf 27 -movflags +faststart -an assets/effects/fireball_burst.mp4
```
Result: ~190 KB.

## Rejected alternative
`vecteezy_flamethrower-...-green-screen.mov` (ProRes, green background) would need
`chromakey=0x00ff00:0.3:0.1,despill=green` + VP9 alpha. Skipped — the black-background
clip is equally directional and reuses the existing screen-blend VideoFX with no new
alpha-video code path.
