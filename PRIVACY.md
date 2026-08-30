# Privacy

SketchAlive is a client-only prototype. There is no backend and nothing is
uploaded anywhere.

## What happens to your photo / camera feed

- A photo you pick, or a frame captured from your camera, is decoded and
  processed entirely inside your browser (`core.js` has no DOM/network calls
  and never leaves the page's JavaScript context).
- Nothing is sent to a server. There is no server. `python3 -m http.server`
  (or any static file host) only serves the static `index.html`/`core.js`
  files themselves -- it never receives your images.
- The extracted character texture and its source photo stay in local
  variables/canvases in the page's memory. Closing or reloading the tab
  discards them. Nothing is written to `localStorage`, `IndexedDB`, or
  cookies.

## Camera access

- Live camera mode (`getUserMedia`) is opt-in: the camera is only requested
  when you tap "ライブカメラで映す" / "Try live camera", and the browser's
  native permission prompt is what actually grants it.
- Video frames are analyzed locally (paper detection) and never recorded or
  transmitted, except into the on-device 10-second recording feature below,
  which you control explicitly.

## Recording / sharing

- The "● 10s" button records the on-screen canvas (and, only while
  recording, a synthesized "talk" sound -- see HANDOFF.md) into a local
  video file using `MediaRecorder`. This file is only written to your
  device's memory/downloads, or handed to the OS share sheet
  (`navigator.share`) if you choose to share it -- that choice, and the
  resulting destination, is entirely under your control via the OS UI.

## Third-party requests

- The page loads one Google Fonts stylesheet (`Yusei Magic`) over HTTPS.
  That's the only outbound network request the app makes on its own.

## Not-real people / rights

- The character you get out of this only ever comes from a doodle you (or
  whoever is holding the phone) drew and scanned yourself. The app does not
  ask for or use anyone's likeness, name, or personal data.
