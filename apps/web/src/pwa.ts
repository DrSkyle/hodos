/**
 * Installability, one place.
 *
 * Hodos is a website that behaves like an app: on iPhone and iPad it is added to
 * the Home Screen from Safari, on Android and desktop it installs from the
 * browser prompt. The same shell is cached by /sw.js so it opens without a
 * signal, while road data and shop pins always come from the network.
 */

const DISMISS_KEY = "hodos.install.dismissed.v1";
const DISMISS_DAYS = 30;

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  return (
    (navigator as unknown as { standalone?: boolean }).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches
  );
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ reports itself as a Mac; the touch point count gives it away.
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

/** Safari proper, not an in-app browser where Add to Home Screen is unavailable. */
function isSafari(): boolean {
  const ua = navigator.userAgent;
  if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return false;
  if (/Instagram|FBAN|FBAV|FB_IAB|Line\/|WhatsApp|Twitter|Snapchat|Pinterest/i.test(ua)) return false;
  return /Safari/.test(ua) && !/Chrome|Chromium|Android/.test(ua);
}

function recentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch (_) {
    return false;
  }
}

function rememberDismissal() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch (_) {
    // Private mode: the hint simply shows again next visit.
  }
}

const STYLE = `
.hodos-install {
  position: fixed;
  left: 16px;
  right: 16px;
  bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  z-index: 60;
  max-width: 420px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px 20px 18px;
  border-radius: 22px;
  background: #fffdf8;
  color: #1c1a17;
  box-shadow: 0 18px 48px rgba(28, 26, 23, 0.18);
  font-family: "Overpass Variable", "Overpass", -apple-system, "Segoe UI", system-ui, sans-serif;
  animation: hodos-install-in 0.32s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes hodos-install-in {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
.hodos-install-head {
  display: flex;
  align-items: center;
  gap: 11px;
}
.hodos-install-icon {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  display: block;
}
.hodos-install strong {
  font-size: 15.5px;
  font-weight: 750;
  letter-spacing: -0.01em;
}
.hodos-install p {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.55;
  color: #736d61;
}
.hodos-install-share {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin: 0 2px;
  vertical-align: -2px;
  color: #b45309;
}
.hodos-install-row {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}
.hodos-install-btn {
  flex: 1;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  padding: 12px 16px;
  border: 0;
  border-radius: 999px;
  background: #1c1a17;
  color: #faf8f2;
  cursor: pointer;
}
.hodos-install-skip {
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  padding: 12px 16px;
  border: 0;
  border-radius: 999px;
  background: #f1ede3;
  color: #1c1a17;
  cursor: pointer;
}
.hodos-install-btn:hover { background: #d97706; color: #fff; }
.hodos-install-skip:hover { background: #e9e4d8; }
@media (prefers-reduced-motion: reduce) {
  .hodos-install { animation: none; }
}
`;

const SHARE_GLYPH =
  '<svg class="hodos-install-share" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4"/><path d="M8 8l4-4 4 4"/><path d="M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/></svg>';

function showHint(options: {
  title: string;
  body: string;
  actionLabel: string;
  onAction?: () => void;
}) {
  if (document.querySelector(".hodos-install")) return;

  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);

  const card = document.createElement("div");
  card.className = "hodos-install";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Install Hodos");

  const head = document.createElement("div");
  head.className = "hodos-install-head";
  const icon = document.createElement("img");
  icon.className = "hodos-install-icon";
  icon.src = "/icon-192.png";
  icon.alt = "";
  const title = document.createElement("strong");
  title.textContent = options.title;
  head.append(icon, title);

  const body = document.createElement("p");
  body.innerHTML = options.body;

  const row = document.createElement("div");
  row.className = "hodos-install-row";

  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "hodos-install-skip";
  skip.textContent = "Not now";

  const close = () => {
    rememberDismissal();
    card.remove();
  };
  skip.addEventListener("click", close);

  const action = document.createElement("button");
  action.type = "button";
  action.className = "hodos-install-btn";
  action.textContent = options.actionLabel;
  action.addEventListener("click", () => {
    if (options.onAction) {
      options.onAction();
    } else {
      close();
    }
  });

  row.append(action, skip);
  card.append(head, body, row);
  document.body.append(card);
}

let deferredPrompt: InstallPromptEvent | null = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event as InstallPromptEvent;
  if (isStandalone() || recentlyDismissed()) return;
  window.setTimeout(() => {
    showHint({
      title: "Keep Hodos on your phone",
      body: "Install it to open the live map in one tap, and to keep working when the signal drops.",
      actionLabel: "Install",
      onAction: async () => {
        const prompt = deferredPrompt;
        deferredPrompt = null;
        document.querySelector(".hodos-install")?.remove();
        if (!prompt) return;
        await prompt.prompt();
        const choice = await prompt.userChoice.catch(() => ({ outcome: "dismissed" as const }));
        if (choice.outcome === "dismissed") rememberDismissal();
      }
    });
  }, 5000);
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  document.querySelector(".hodos-install")?.remove();
});

function registerWorker() {
  if (!("serviceWorker" in navigator)) return;
  const swUrl = "/sw.js";
  void navigator.serviceWorker
    .getRegistrations()
    .then((items) =>
      // Legacy Hodos builds shipped a service worker and then removed it. Drop
      // only those; ours must survive.
      Promise.all(
        items
          .filter((item) => !item.active?.scriptURL.endsWith(swUrl))
          .map((item) => item.unregister())
      )
    )
    .catch(() => {});

  window.addEventListener("load", () => {
    navigator.serviceWorker.register(swUrl, { scope: "/" }).catch(() => {});
  });
}

function offerIosHint() {
  if (!isIos() || !isSafari() || isStandalone() || recentlyDismissed()) return;
  window.setTimeout(() => {
    showHint({
      title: "Add Hodos to your Home Screen",
      body: `Tap ${SHARE_GLYPH} in Safari, then <strong>Add to Home Screen</strong>. It opens full screen, like any other app.`,
      actionLabel: "Got it"
    });
  }, 6000);
}

registerWorker();
offerIosHint();
