// Prime Video. Plays on primevideo.com and amazon.com/gp/video.
// SELECTORS ARE UNVERIFIED against the live site — confirm on first run with
// `window.__sansDebug` in the console and update here.
export const prime = {
  name: "prime",
  matches: (loc) => /primevideo\.com|amazon\.[a-z.]+\/(gp\/video|.*\/dp\/)/.test(loc.href),
  // The service's own stable ID for the title; maps are keyed on it.
  titleId(loc) {
    const m = loc.href.match(/\/(?:detail|dp)\/([A-Z0-9]{10})/i) || loc.href.match(/gti=([^&]+)/);
    return m ? m[1] : null;
  },
  captionSelector: ".atvwebplayersdk-captions-text",
  playerContainer: () => document.querySelector(".webPlayerSDKContainer, .dv-player-fullscreen"),
};
