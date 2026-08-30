"""
Streamlit wrapper for SketchAlive.

The app itself (index.html + core.js) is untouched -- this just inlines
core.js into index.html (so it works inside an iframe's srcdoc, where
relative <script src> paths don't resolve) and hosts it via
st.components.v1.html(). Camera/mic access works because Streamlit's
component iframe includes "camera" and "microphone" in its default `allow`
attribute.

Run: streamlit run streamlit_app.py
"""
import pathlib
import streamlit as st
import streamlit.components.v1 as components

ROOT = pathlib.Path(__file__).parent

st.set_page_config(page_title="SketchAlive", layout="centered")

# SketchAlive is a full-viewport, app-like UI (bottom-anchored buttons for
# scan/record/etc.) -- Streamlit's own header/toolbar/footer and default
# content padding eat into that vertical space, which on a phone-sized
# viewport pushed those bottom buttons below the fold and forced scrolling
# to reach them. Reclaim that space instead of just handing the iframe a
# taller box (which made the scrolling worse, not better).
st.markdown("""
<style>
  #MainMenu, header, footer { visibility: hidden; height: 0; }
  .block-container { padding: 0 !important; max-width: 100% !important; }
  iframe { display: block; }
</style>
""", unsafe_allow_html=True)

html = (ROOT / "index.html").read_text(encoding="utf-8")
core_js = (ROOT / "core.js").read_text(encoding="utf-8")

# Inline core.js (srcdoc iframes can't resolve "core.js" as a relative URL).
html = html.replace('<script src="core.js"></script>', f"<script>{core_js}</script>")
# manifest/sw/icons are relative-path references that won't resolve inside
# the iframe either; they fail silently (SW registration already has a
# .catch(), favicon/icons just won't render) -- harmless inside an embed.

# Tall-ish but phone-realistic; scrolling=True is a safety net for taller
# viewports/browser chrome combos even though the app's own body disables
# its internal scrolling (it's a fixed-viewport app UI by design).
components.html(html, height=780, scrolling=True)
