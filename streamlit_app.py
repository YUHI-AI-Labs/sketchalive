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

html = (ROOT / "index.html").read_text(encoding="utf-8")
core_js = (ROOT / "core.js").read_text(encoding="utf-8")

# Inline core.js (srcdoc iframes can't resolve "core.js" as a relative URL).
html = html.replace('<script src="core.js"></script>', f"<script>{core_js}</script>")
# manifest/sw/icons are relative-path references that won't resolve inside
# the iframe either; they fail silently (SW registration already has a
# .catch(), favicon/icons just won't render) -- harmless inside an embed.

components.html(html, height=860, scrolling=False)
