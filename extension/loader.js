// MV3 content scripts can't be ES modules directly; load the module entry point.
import(chrome.runtime.getURL("src/content.js"));

// Fallback for the caption catcher. It is declared in the manifest to run in the page's
// own context at document_start, but on Prime it was observed not running at all. It
// marks <html data-sans-intercept> when it starts; if that's missing by now, inject it
// as a page script. Captions are fetched when playback starts, well after this point.
//
// No inline code here: Netflix enforces Trusted Types and threw on the earlier inline
// probe. Everything is wrapped so a refusal is recorded, never thrown.
try {
  if (!document.documentElement.dataset.sansIntercept) {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("intercept.js");
    s.onerror = () => { document.documentElement.dataset.sansIntercept = "blocked"; };
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  }
} catch (err) {
  document.documentElement.dataset.sansIntercept = "blocked: " + String(err).slice(0, 80);
}
