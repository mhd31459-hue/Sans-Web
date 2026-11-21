// Runs in the PAGE's own JavaScript world (manifest: "world": "MAIN"), in every frame,
// because only there can it see responses the player receives. It looks for caption
// files (TTML for Prime, WebVTT for Disney+) and hands their TEXT to the content script
// in the top frame. Every other response is ignored after a cheap check; video data
// arrives encrypted and is never read.
(() => {
  if (window.__sansIntercept) return;
  const MAX = 3_000_000;
  // Diagnostics, readable from the console in the default "top" context:
  //   __sansIntercept
  const diag = window.__sansIntercept = { frame: location.href.slice(0, 120), fetches: 0, xhrs: 0, caught: 0, candidates: [] };
  const note = (kind, url, ct, size, matched) => {
    diag.candidates.push({ kind, url: String(url).slice(0, 160), ct, size, matched });
    if (diag.candidates.length > 40) diag.candidates.shift();
  };
  // URL hints alone are enough to look inside: Prime has been seen serving caption files
  // as generic binary, which a content-type check alone would skip.
  const URL_HINT = /subtitle|caption|timedtext|ttml|dfxp|\.vtt|webvtt|\/sub[s]?\//i;
  const TYPE_HINT = /xml|ttml|dfxp|vtt|text\/plain/i;
  const relevant = (ct, url) => TYPE_HINT.test(ct || "") || URL_HINT.test(url || "");

  const handOff = (text, url) => {
    const head = text.slice(0, 2000);
    const isCaptions = /^﻿?WEBVTT/.test(head) || /<(?:tt:)?tt[\s>]/.test(head);
    return isCaptions ? (diag.caught++,
      // Post to the TOP frame: the content script only runs there, and Prime's player
      // may live in an iframe on the same origin.
      window.top.postMessage({ __sansCaptions: true, text, url: String(url) }, location.origin), true) : false;
  };
  const inspect = (text, url, ct, kind) => {
    if (typeof text !== "string" || text.length > MAX) return note(kind, url, ct, text?.length, false);
    note(kind, url, ct, text.length, handOff(text, url));
  };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    diag.fetches++;
    try {
      const url = res.url || String(args[0]?.url || args[0]);
      const ct = res.headers.get("content-type");
      if (relevant(ct, url)) res.clone().text().then(t => inspect(t, url, ct, "fetch")).catch(() => {});
    } catch {}
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.addEventListener("load", () => {
      diag.xhrs++;
      try {
        const ct = this.getResponseHeader("content-type");
        if (!relevant(ct, url)) return;
        if (this.responseType === "" || this.responseType === "text") inspect(this.responseText, url, ct, "xhr");
        else if (this.responseType === "arraybuffer" && this.response?.byteLength < MAX)
          inspect(new TextDecoder().decode(this.response), url, ct, "xhr");
        else note("xhr", url, ct, null, false);
      } catch {}
    });
    return origOpen.call(this, method, url, ...rest);
  };
})();
