# SketchAlive

Draw a stick figure on paper. Scan it. Watch it escape the page, talk back to
you, dance if you double-tap it, and record a 10-second clip to share.

Zero dependencies, no build step, no backend — one `index.html` and one
`core.js`, entirely browser-side.

## Quick start

```bash
git clone <this-repo>
cd sketchalive
python3 -m http.server 8000   # or: npx serve
```

Open `http://localhost:8000`. No camera or paper handy? Use one of the three
practice-doodle buttons on the home screen — no photo required.

To try it on your phone: open `http://<your-computer's-LAN-IP>:8000` from a
phone on the same Wi-Fi. Photo upload and recording work over plain HTTP;
**live camera AR requires HTTPS** (or `localhost`) — tunnel it (e.g.
`cloudflared tunnel --url http://localhost:8000`) if you want to test that
part on a phone.

## What it does

1. **Scan** — take/pick a photo of a stick-figure drawing on paper (or use a
   practice doodle). The app finds the paper's four corners, lets you
   confirm/adjust them, and corrects the perspective.
2. **Extract** — finds the ink, works out a rough 15-joint skeleton, and
   builds a deformable textured mesh from the drawing itself (your actual
   pen strokes become the character's skin).
3. **Come alive** — the character sits on the paper. Tap it to talk, drag it
   around, double-tap to dance. Press **SET IT FREE** and it looks around,
   walks to the paper's edge, hesitates, jumps off, and turns back to say
   something about its own anatomy.
4. **Record & share** — a 10-second recording button captures the escape (or
   whatever it's doing) with synthesized audio, ready to save or share.

There's also an experimental **live camera AR** mode: point your camera at
the paper instead of taking a photo, and the character tracks the paper's
position/tilt/scale in real time as you move the phone.

**💬 Talk to it** — tap the chat button for a real conversation: type or
speak (mic button, browser speech recognition) and the character replies
in character, powered by a small LLM ([Qwen2.5-0.5B](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct))
running **entirely in your browser via WebGPU** (`@mlc-ai/web-llm`) — no
server, no API key, nothing leaves your device except the one-time model
download. Needs a WebGPU-capable browser (recent Chrome/Edge); falls back
to the character's scripted one-liners elsewhere. Voice input specifically
uses the browser's built-in speech recognition, which *is* cloud-backed in
Chrome — see [PRIVACY.md](PRIVACY.md).

## Running inside Streamlit

```bash
pip install streamlit
streamlit run streamlit_app.py
```

This embeds the untouched `index.html`/`core.js` inside `st.components.v1.html()` —
Streamlit's component iframe allows camera/microphone by default, so the
scan, AR, and chat features all work the same as standalone.

## Installing it as an app

SketchAlive is an installable PWA — open it in a browser, then:
- **iOS Safari**: Share → Add to Home Screen
- **Android Chrome**: menu → Install app (or the address-bar install prompt)

Once installed it launches full-screen (no browser chrome) and **works fully
offline** after the first visit — a service worker caches the app shell, so
the practice doodles work with no network at all.

## Project status

This is a prototype, not a finished product. The core pipeline (ink
extraction → skeleton → animation → recording) is solid and covered by
automated tests. The weakest link is that **it has not yet been tested
against a real camera photo of a real hand-drawn figure on real paper** —
only synthetic test images. See [HANDOFF.md](HANDOFF.md) for the full,
unvarnished list of what's tested, what's approximated, and what's still
open, plus the architecture and a couple of nasty browser bugs that were
found and fixed along the way (worth reading if you're picking this up).

## Tests

```bash
node test-core.mjs      # ink extraction + rigging golden path
node test-fk.mjs        # forward-kinematics / skinning math
node test-paper.mjs     # paper-corner detection + perspective homography
node test-fixtures.mjs  # synthetic "real-photo-like" edge cases
```

All four are deterministic (seeded RNG) and dependency-free — just Node.

## License

MIT — see [LICENSE](LICENSE). See [PRIVACY.md](PRIVACY.md) for what happens
(and doesn't happen) to your photos and camera feed: nothing leaves your
browser.
