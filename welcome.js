const steps = [
  {
    title: "解析普通视频",
    text: "普通模式打开视频页，单击小尾巴图标，会复制 91biliplayer 播放地址。",
    action: "single",
    address: "bilibili.com/video/BV1xx...",
    videoTitle: "我用 Open Design 跑通了按产品规范生成原型",
    meta: "普通视频 · P1/1 · 点击小尾巴复制",
    idle: "点击右上角小尾巴试试看",
    copied: "已复制 91biliplayer 播放地址啦"
  },
  {
    title: "普通视频拿直链",
    text: "普通模式下想拿 B 站临时直链时，快速双击小尾巴图标。",
    action: "double",
    address: "bilibili.com/video/BV1xx...",
    videoTitle: "普通视频双击演示",
    meta: "双击小尾巴 · 复制 B 站临时直链",
    idle: "快速双击右上角小尾巴",
    nudge: "这一步要快速双击，小尾巴还没复制哦",
    copied: "已复制 B 站临时直链啦"
  },
  {
    title: "分P、列表、直播自动拿直链",
    text: "普通模式会识别当前 P；列表页里的视频和直播间也会尽量自动拿直链。",
    action: "single",
    address: "bilibili.com/video/BV1xx...?p=2",
    videoTitle: "当前正在播放 P2",
    meta: "P2/4 · 自动复制当前分P直链",
    idle: "这类页面点一下就自动直链",
    copied: "已复制当前分P直链啦"
  },
  {
    title: "生成带弹幕 HLS",
    text: "切到带弹幕模式后，单击小尾巴会把当前视频交给你的后端，生成可复制的 HLS 地址。",
    action: "single",
    address: "bilibili.com/video/BV1xx...",
    videoTitle: "带弹幕版本正在生成",
    meta: "普通视频 · 后端烧录弹幕 · 复制 HLS",
    idle: "带弹幕模式需要先填后端地址",
    copied: "带弹幕地址复制好啦，放进 VRC 试试看"
  },
  {
    title: "切换小尾巴配置",
    text: "配置入口在扩展图标菜单里；这里会自动展开一次，认准“切换小尾巴配置”。",
    action: "menu",
    address: "chrome://extensions",
    videoTitle: "小尾巴配置入口",
    meta: "切换普通 / 弹幕模式 · 填写后端地址",
    idle: "右上角菜单里可以打开配置",
    copied: "配置入口在扩展图标菜单里"
  }
];

const stepCounter = document.getElementById("stepCounter");
const stepTitle = document.getElementById("stepTitle");
const stepText = document.getElementById("stepText");
const mockAddress = document.getElementById("mockAddress");
const mockExtension = document.getElementById("mockExtension");
const mockToast = document.getElementById("mockToast");
const mockVideoTitle = document.getElementById("mockVideoTitle");
const mockVideoMeta = document.getElementById("mockVideoMeta");
const browserShell = document.querySelector(".browser-shell");
const clickHint = document.getElementById("clickHint");
const extensionMenu = document.getElementById("extensionMenu");
const stepTabs = Array.from(document.querySelectorAll(".step-tab"));
const doneButton = document.getElementById("doneButton");
const prevButton = document.querySelector(".prev");
const nextButton = document.querySelector(".next");
let current = 0;
let hintTimer = 0;

stepTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => goTo(index));
});

prevButton.addEventListener("click", () => goTo(current - 1));
nextButton.addEventListener("click", () => goTo(current + 1));
mockExtension.addEventListener("click", handleMockExtensionClick);
mockExtension.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  showMenuState();
});
extensionMenu.addEventListener("click", (event) => {
  if (event.target.classList.contains("menu-primary")) {
    browserShell.classList.remove("copied", "nudged");
    browserShell.classList.add("menu-open");
    mockToast.textContent = "这里会打开模式和后端配置页";
  }
});
doneButton.addEventListener("click", () => {
  window.close();
  doneButton.textContent = "可以关闭这个标签页啦";
});

document.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") goTo(current - 1);
  if (event.key === "ArrowRight") goTo(current + 1);
});

function goTo(index) {
  current = Math.max(0, Math.min(index, steps.length - 1));
  const step = steps[current];

  stepCounter.textContent = `${current + 1} / ${steps.length}`;
  stepTitle.textContent = step.title;
  stepText.textContent = step.text;
  mockAddress.textContent = step.address;
  mockToast.textContent = step.idle;
  mockVideoTitle.textContent = step.videoTitle;
  mockVideoMeta.textContent = step.meta;
  browserShell.classList.remove("copied", "nudged", "menu-open");
  clickHint.textContent = step.action === "double" ? "双击这里" : step.action === "menu" ? "菜单已展开" : "点这里";
  prevButton.disabled = current === 0;
  nextButton.disabled = current === steps.length - 1;

  stepTabs.forEach((tab, tabIndex) => {
    if (tabIndex === current) {
      tab.setAttribute("aria-current", "step");
    } else {
      tab.removeAttribute("aria-current");
    }
  });

  if (step.action === "menu") {
    showMenuState();
  }
}

function handleMockExtensionClick(event) {
  const step = steps[current];

  if (step.action === "menu") {
    showMenuState();
    return;
  }

  if (step.action === "double" && event.detail < 2) {
    showNudgeState(step.nudge || "这一步要快速双击才会复制直链哦");
    return;
  }

  showCopiedState();
}

function showCopiedState() {
  const step = steps[current];
  browserShell.classList.remove("nudged", "menu-open");
  browserShell.classList.add("copied");
  mockToast.textContent = step.copied;
  clickHint.textContent = "成功";
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    if (browserShell.classList.contains("copied")) {
      clickHint.textContent = steps[current].action === "double" ? "双击这里" : "点这里";
    }
  }, 1200);
}

function showNudgeState(message) {
  browserShell.classList.remove("copied", "menu-open");
  browserShell.classList.add("nudged");
  mockToast.textContent = message;
  clickHint.textContent = "再点一下";
}

function showMenuState() {
  browserShell.classList.remove("copied", "nudged");
  browserShell.classList.add("menu-open");
  mockToast.textContent = "菜单里点“切换小尾巴配置”";
  clickHint.textContent = "菜单已展开";
}

goTo(0);
