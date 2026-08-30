"""
Streamlit wrapper for SketchAlive -- mobile-only frame.

The app itself (index.html + core.js) is untouched -- this just inlines
core.js into index.html (so it works inside an iframe's srcdoc, where
relative <script src> paths don't resolve) and hosts it via
st.components.v1.html(). Camera/mic access works because Streamlit's
component iframe includes "camera" and "microphone" in its default `allow`
attribute.

SketchAlive is a fixed-viewport, app-like UI (bottom-anchored buttons) --
guessing a pixel height for Streamlit's iframe kept breaking (Streamlit's
own chrome, different mobile browser toolbars) and needing bottom buttons
to be reached by scrolling. Instead of guessing again, this pins the iframe
to the ACTUAL viewport height via CSS (100svh, falling back to 100dvh/100vh)
and disables scrolling everywhere -- on any screen, on desktop or mobile,
you get a fixed phone-shaped frame with nothing to scroll, matching the
app's own "no internal scrolling" design intent instead of fighting it.

Run: streamlit run streamlit_app.py
"""
import pathlib
import streamlit as st
import streamlit.components.v1 as components

ROOT = pathlib.Path(__file__).parent

st.set_page_config(page_title="SketchAlive", layout="centered")

st.markdown("""
<style>
  #MainMenu, header, footer, [data-testid="stStatusWidget"] { display: none !important; }
  html, body, .stApp, .main, .block-container {
    height: 100svh !important; height: 100dvh !important;
    margin: 0 !important; padding: 0 !important; overflow: hidden !important;
    max-width: 100% !important;
  }
  .block-container { display: flex !important; justify-content: center !important; }
  /* The SketchAlive embed itself: a fixed phone-shaped frame, centered,
     filling the real viewport height regardless of Streamlit's own chrome
     or the mobile browser's address-bar show/hide. */
  div[data-testid="stIFrame"], div[data-testid="stIFrame"] iframe, iframe {
    height: 100svh !important; height: 100dvh !important;
    max-width: 480px !important; width: 100% !important;
    border: none !important; display: block !important;
  }
</style>
""", unsafe_allow_html=True)

html = (ROOT / "index.html").read_text(encoding="utf-8")
core_js = (ROOT / "core.js").read_text(encoding="utf-8")

# Inline core.js (srcdoc iframes can't resolve "core.js" as a relative URL).
html = html.replace('<script src="core.js"></script>', f"<script>{core_js}</script>")
# manifest/sw/icons are relative-path references that won't resolve inside
# the iframe either; they fail silently (SW registration already has a
# .catch(), favicon/icons just won't render) -- harmless inside an embed.

# The height=900 here is just Streamlit's required initial value; the CSS
# above overrides it to the real viewport height (100svh/100dvh). No
# scrolling: the app's own body is deliberately non-scrolling too, so if
# something doesn't fit it should be fixed at the source, not papered over.
components.html(html, height=900, scrolling=False)
