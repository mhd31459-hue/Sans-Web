// Runs in the PAGE's own JavaScript world (manifest: "world": "MAIN"), because only
// there can it see the responses the player receives. It watches for caption files
// (TTML for Prime, WebVTT for Disney+) and hands their TEXT to the content script.
// It reads nothing else: other responses are ignored after a cheap content check, and
// it never sees or touches video data (that arrives encrypted and is skipped by type).
(() => {
  const MAX = 3_000_000;            // a feature film's captions are well under this
  const post = (text, url) => window.postMessage({ __sansCaptions: true, text, url }, location.origin);
  const maybe = (text, url) => {
    if (typeof text !== "string" || text.length > MAX) return;
    const head = text.slice(0, 2000);
    if (/^﻿?WEBVTT/.test(head) || (/<(?:tt:)?tt[\s>]/.test(head))) post(text, url);
  };
  const isTextish = (ct, url) =>
    /xml|ttml|dfxp|vtt|text\/plain/i.test(ct || "") || /\.(dfxp|ttml2?|xml|vtt)(\?|$)/i.test(url || "");

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = res.url || String(args[0]?.url || args[0]);
      if (isTextish(res.headers.get("content-type"), url)) res.clone().text().then(t => maybe(t, url)).catch(() => {});
    } catch {}
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.addEventListener("load", () => {
      try {
        if (!isTextish(this.getResponseHeader("content-type"), url)) return;
        if (this.responseType === "" || this.responseType === "text") maybe(this.responseText, url);
        else if (this.responseType === "arraybuffer" && this.response?.byteLength < MAX)
          maybe(new TextDecoder().decode(this.response), url);
      } catch {}
    });
    return origOpen.call(this, method, url, ...rest);
  };
})();
