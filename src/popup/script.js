const browser = require("webextension-polyfill");

document.getElementById("btn").addEventListener("click", async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    document.getElementById("output").textContent = `Active tab: ${tab.url}`;
});
