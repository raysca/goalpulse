# Ad video

The product ad (29s, 16:9 and 9:16) is a [HyperFrames](https://hyperframes.heygen.com) project. One template, `src/index.tpl.html`, is baked with the real demo goal and rendered twice.

Needs Node 22+, ffmpeg and internet (HyperFrames loads GSAP from a CDN).

```bash
# 1. real data: run the demo on a spare port and save its state
node examples/simulate.js --dir /tmp/gp-ad && GOALPULSE_DIR=/tmp/gp-ad node bin/goalpulse.js serve --port 4500 &
curl -s http://127.0.0.1:4500/api/goals > marketing/video/goals.json

# 2. build both compositions and the music bed
cd marketing/video
node src/music.mjs ad/assets/bgm.mp3        # original synthesised music, nothing to license
(cd src && node build.mjs && node build.mjs vertical)

# 3. check and render
(cd ad          && npx hyperframes@0.8.134 check && npx hyperframes@0.8.134 render --output ../../../site/goalpulse-ad.mp4)
(cd ad-vertical && npx hyperframes@0.8.134 check && npx hyperframes@0.8.134 render --output ../../../site/goalpulse-ad-vertical.mp4)
```

Edit the story in `src/index.tpl.html` (scene copy, timings), the social layout in `src/build.mjs`, the music in `src/music.mjs`. Completion/typing/whoosh sounds are bundled HyperFrames effects (Pixabay licence, no attribution needed).
