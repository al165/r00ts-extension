const browser = require("webextension-polyfill");

console.log("Background.js runnnig");

browser.runtime.onMessage.addListener(async (msg, sender) => {
    console.log("Background.js received:", msg, "from", sender);
});

browser.webRequest.onBeforeRequest.addListener(
    async (details) => {
        console.log("Background.js onBeforeRequest", details.url);
    },
    { urls: ["<all_urls>"] }
);
