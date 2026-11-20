// Disney+. SELECTORS ARE UNVERIFIED against the live site — confirm and update.
export const disney = {
  name: "disney",
  matches: (loc) => /disneyplus\.com/.test(loc.hostname),
  titleId(loc) {
    const m = loc.pathname.match(/\/(?:video|play)\/([a-z0-9-]+)/i);
    return m ? m[1] : null;
  },
  captionSelector: ".dss-subtitle-renderer-line, .hive-subtitle-renderer-line",
  playerContainer: () => document.querySelector("#hudson-wrapper, .btm-media-player, disney-web-player"),
};
