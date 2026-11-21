// MV3 content scripts can't be ES modules directly; load the module entry point.
import(chrome.runtime.getURL("src/content.js"));

// Fallback for the caption catcher. It is declared in the manifest to run in the page's
// own context at document_start, but on Prime it was observed not running at all (no
// patched fetch, no __sansIntercept) while this script ran fine. If it hasn't marked the
// page by now, inject it as a page script. Captions are fetched when playback starts,
// well after this point, so the later start still catches them.
const probe = document.createElement("script");
probe.textContent = "document.documentElement.dataset.sansIntercept = window.__sansIntercept ? 'manifest' : 'missing';";
(document.head || document.documentElement).appendChild(probe);
probe.remove();
if (document.documentElement.dataset.sansIntercept !== "manifest") {
  const s = document.createElement("script");
  s.src = chrome.runtime.getURL("intercept.js");
  s.onload = () => { document.documentElement.dataset.sansIntercept = "injected"; s.remove(); };
  s.onerror = () => { document.documentElement.dataset.sansIntercept = "blocked"; };
  (document.head || document.documentElement).appendChild(s);
}
