// Netflix. Verified 2026-11-21: title ID, caption selector, and caption-file catch.
// Each episode has its own /watch/<id>, so maps are naturally per-episode.
export const netflix = {
  name: "netflix",
  matches: (loc) => /(^|\.)netflix\.com$/.test(loc.hostname),
  titleId(loc) {
    const m = loc.pathname.match(/\/watch\/(\d+)/);
    return m ? m[1] : null;
  },
  captionSelector: ".player-timedtext-text-container",
  playerContainer: () => document.querySelector(".watch-video--player-view, .watch-video, [data-uia='video-canvas']"),
  // Netflix's player crashes (error M7375) if video.currentTime is set directly, so
  // seeks go through its own player API, which only exists in the page's context.
  seekViaPage: true,
};
