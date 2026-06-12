const DEFAULT_OPTIONS = {
  copyMode: "normal",
  quality: "80",
  backendUrl: "",
  maxDanmaku: "1200",
  maxTextLength: "80"
};

const form = document.getElementById("optionsForm");
const quality = document.getElementById("quality");
const backendUrl = document.getElementById("backendUrl");
const maxDanmaku = document.getElementById("maxDanmaku");
const maxTextLength = document.getElementById("maxTextLength");
const danmakuSettings = document.getElementById("danmakuSettings");
const statusText = document.getElementById("status");
let statusTimer = 0;

document.addEventListener("DOMContentLoaded", restoreOptions);
form.addEventListener("change", saveOptions);
form.addEventListener("input", handleInput);

function restoreOptions() {
  chrome.storage.sync.get(DEFAULT_OPTIONS, (items) => {
    const copyMode = items.copyMode === "danmaku" ? "danmaku" : DEFAULT_OPTIONS.copyMode;
    const selectedMode = form.querySelector(`input[name="copyMode"][value="${copyMode}"]`);
    if (selectedMode) {
      selectedMode.checked = true;
    }

    quality.value = ["80", "64", "32", "16"].includes(String(items.quality)) ? String(items.quality) : DEFAULT_OPTIONS.quality;
    backendUrl.value = typeof items.backendUrl === "string" ? items.backendUrl : "";
    maxDanmaku.value = positiveText(items.maxDanmaku, DEFAULT_OPTIONS.maxDanmaku);
    maxTextLength.value = positiveText(items.maxTextLength, DEFAULT_OPTIONS.maxTextLength);
    updateDanmakuVisibility();
  });
}

function saveOptions() {
  const selectedMode = form.querySelector('input[name="copyMode"]:checked');
  const options = {
    copyMode: selectedMode ? selectedMode.value : DEFAULT_OPTIONS.copyMode,
    quality: quality.value,
    backendUrl: backendUrl.value.trim(),
    maxDanmaku: positiveText(maxDanmaku.value, DEFAULT_OPTIONS.maxDanmaku),
    maxTextLength: positiveText(maxTextLength.value, DEFAULT_OPTIONS.maxTextLength)
  };

  maxDanmaku.value = options.maxDanmaku;
  maxTextLength.value = options.maxTextLength;
  updateDanmakuVisibility();

  chrome.storage.sync.set(options, () => {
    showStatus(chrome.runtime.lastError ? "保存失败" : "已保存");
  });
}

function handleInput(event) {
  if (event.target === backendUrl || event.target === maxDanmaku || event.target === maxTextLength) {
    saveOptions();
  }
}

function updateDanmakuVisibility() {
  const selectedMode = form.querySelector('input[name="copyMode"]:checked');
  const isDanmaku = selectedMode && selectedMode.value === "danmaku";
  danmakuSettings.classList.toggle("hidden", !isDanmaku);
}

function showStatus(text) {
  statusText.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusText.textContent = "";
  }, 1200);
}

function positiveText(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? String(number) : fallback;
}
