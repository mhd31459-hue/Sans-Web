// Browser-level shortcut for "missed one" (Alt/Option+M; changeable at
// chrome://extensions/shortcuts). The browser handles it before the page, so a
// streaming player that swallows keystrokes can't block it. The content script
// opens the picker when this message arrives.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "report-missed" && tab?.id != null)
    chrome.tabs.sendMessage(tab.id, { sansReport: true }).catch(() => { /* not a streaming tab */ });
});
