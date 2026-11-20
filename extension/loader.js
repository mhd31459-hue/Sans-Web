// MV3 content scripts can't be ES modules directly; load the module entry point.
import(chrome.runtime.getURL("src/content.js"));
