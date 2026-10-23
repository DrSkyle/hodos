# Recording runs in the foreground, in a browser

Sensing only happens during an explicit, screen-on trip, because the web
platform cannot do anything else: the Device Orientation and Motion spec
dispatches events only while the document is visible, so a hidden or
screen-off page receives no motion or location updates. We accept the
"mount, open, tap start" step rather than requiring a native app, because the
same code then runs on every phone with a browser, installs without an app
store, and the detection — the actual product — remains fully passive.

_Considered:_ a native or Capacitor-shelled app with a foreground service, which
would sense with the screen off. Rejected for the initial build on time; the
path stays open (see `docs/research/2026-10-23-passive-sensing-feasibility.md`).
