const DEFAULT_OPTIONS = {
  quality: "80"
};

const quality = document.getElementById("quality");
const statusText = document.getElementById("status");
let statusTimer = 0;

document.addEventListener("DOMContentLoaded", restoreOptions);
quality.addEventListener("change", saveOptions);

function restoreOptions() {
  chrome.storage.sync.get(DEFAULT_OPTIONS, (items) => {
    quality.value = ["80", "64", "32", "16"].includes(String(items.quality)) ? String(items.quality) : DEFAULT_OPTIONS.quality;
  });
}

function saveOptions() {
  chrome.storage.sync.set({ quality: quality.value }, () => {
    showStatus(chrome.runtime.lastError ? "保存失败" : "已保存");
  });
}

function showStatus(text) {
  statusText.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusText.textContent = "";
  }, 1200);
}
