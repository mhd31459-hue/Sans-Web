// Runs only on the Sans website (manifest: mhd31459-hue.github.io/Sans-Web/*).
// Lets the signed-in website link this extension to the account, and tells the page
// whether the extension is installed. Messages are accepted only from the page itself.
(async () => {
  const account = await import(chrome.runtime.getURL("src/account.js"));
  const ORIGIN = location.origin;

  const announce = async () => {
    const { account: a } = await chrome.storage.local.get("account");
    window.postMessage({ __sansExt: { version: chrome.runtime.getManifest().version, linked: a?.email ?? null } }, ORIGIN);
  };

  window.addEventListener("message", async (e) => {
    if (e.source !== window || e.origin !== ORIGIN || !e.data?.__sans) return;
    const m = e.data;
    try {
      if (m.__sans === "hello") await announce();
      else if (m.__sans === "link" && typeof m.token === "string" && m.token.startsWith("sd_")) {
        await account.link(m.token, String(m.email ?? "").slice(0, 200));
        await announce();
      } else if (m.__sans === "unlink") { await account.unlink(); await announce(); }
      else if (m.__sans === "profiles-changed") await account.refresh();
    } catch (err) {
      window.postMessage({ __sansExt: { error: String(err.message ?? err).slice(0, 200) } }, ORIGIN);
    }
  });
  await announce();
})();
