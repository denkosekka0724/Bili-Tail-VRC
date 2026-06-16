const DEFAULT_OPTIONS = {
  quality: "80",
  neteaseLevel: "standard"
};

const quality = document.getElementById("quality");
const neteaseLevel = document.getElementById("neteaseLevel");
const statusText = document.getElementById("status");
let statusTimer = 0;

document.addEventListener("DOMContentLoaded", restoreOptions);
quality.addEventListener("change", saveOptions);
neteaseLevel.addEventListener("change", saveOptions);

function restoreOptions() {
  chrome.storage.sync.get(DEFAULT_OPTIONS, (items) => {
    quality.value = ["80", "64", "32", "16"].includes(String(items.quality)) ? String(items.quality) : DEFAULT_OPTIONS.quality;
    neteaseLevel.value = normalizeNeteaseLevel(items.neteaseLevel);
  });
}

function saveOptions() {
  chrome.storage.sync.set({
    quality: quality.value,
    neteaseLevel: normalizeNeteaseLevel(neteaseLevel.value)
  }, () => {
    showStatus(chrome.runtime.lastError ? "保存失败" : "已保存");
  });
}

function normalizeNeteaseLevel(value) {
  const text = String(value || "").trim();
  return ["standard", "exhigh", "lossless", "hires", "sky", "jyeffect", "jymaster"].includes(text)
    ? text
    : DEFAULT_OPTIONS.neteaseLevel;
}

function showStatus(text) {
  statusText.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusText.textContent = "";
  }, 1200);
}
