import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

const DISMISS_KEY = "threadly-install-dismissed-at";
const DISMISS_DAYS = 14;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  // iPadOS 13+ identifies as "MacIntel" in the UA string but, unlike a real
  // Mac, reports touch points - that's the only reliable way to tell them
  // apart client-side.
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function wasDismissedRecently(): boolean {
  const raw = window.localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  const dismissedAt = Number(raw);
  if (!Number.isFinite(dismissedAt)) return false;
  return Date.now() - dismissedAt < DISMISS_DAYS * 24 * 60 * 60 * 1000;
}

// Prompts installing the PWA. Android/Chrome/Edge fire a real
// beforeinstallprompt event that can be triggered programmatically from a
// button click. iOS Safari never fires that event and exposes no install
// API at all - the only way to install there is the manual Share -> Add to
// Home Screen flow, so that's all we can do is point at it.
export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSHint, setShowIOSHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isStandalone() || wasDismissedRecently()) return;

    if (isIOS()) {
      setShowIOSHint(true);
      return;
    }

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
  }

  async function install() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome === "accepted") {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    }
  }

  if (dismissed || (!deferredPrompt && !showIOSHint)) return null;

  return (
    <div className="install-banner">
      {showIOSHint ? (
        <p>
          Install Threadly: tap <Share size={14} className="install-banner-inline-icon" /> then "Add to Home Screen".
        </p>
      ) : (
        <>
          <p>Install Threadly for quicker access and a full-screen inbox.</p>
          <button type="button" className="icon-label-button" onClick={install}>
            <Download size={15} />
            Install
          </button>
        </>
      )}
      <button type="button" className="icon-button install-banner-dismiss" title="Dismiss" aria-label="Dismiss" onClick={dismiss}>
        <X size={16} />
      </button>
    </div>
  );
}
