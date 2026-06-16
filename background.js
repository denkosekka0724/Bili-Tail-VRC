const BILI_PLAYER_PREFIX = "https://biliplayer.91vrchat.com/player/?url=";
const ZNNU_BASE_URL = "https://music.znnu.com";
const ZNNU_REFERER = "musicParser";
const ZNNU_SIGNATURE_SECRET = "a09d0f3700a279584e1515354fbe08a7ee1c617f919543142fa625b82f1b5ad0";
const DEFAULT_OPTIONS = {
  quality: "80",
  neteaseLevel: "standard"
};
const DOUBLE_CLICK_MS = 420;
const CONFIG_MENU_ID = "open-bili-tail-config";
const pendingClicks = new Map();
let znnuKeySession = null;
let znnuIp = null;

chrome.runtime.onInstalled.addListener((details) => {
  setupConfigMenu();
  if (details && details.reason === "install") {
    openWelcomePage();
  }
});
chrome.runtime.onStartup.addListener(setupConfigMenu);

chrome.action.onClicked.addListener((tab) => {
  const tabId = tab && tab.id;
  if (!tabId) return;

  const existing = pendingClicks.get(tabId);
  if (existing) {
    clearTimeout(existing.timer);
    pendingClicks.delete(tabId);
    handleActionClick(tab, "direct").catch((error) => {
      console.warn("[Bili小尾巴 VRC解析] double click failed", error && error.message ? error.message : error);
      showToastOnly(tabId, makeUserErrorMessage(error), true);
    });
    return;
  }

  const timer = setTimeout(() => {
    pendingClicks.delete(tabId);
    handleActionClick(tab, "normal").catch((error) => {
      console.warn("[Bili小尾巴 VRC解析] click failed", error && error.message ? error.message : error);
      showToastOnly(tabId, makeUserErrorMessage(error), true);
    });
  }, DOUBLE_CLICK_MS);

  pendingClicks.set(tabId, { timer, createdAt: Date.now() });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === CONFIG_MENU_ID) {
    openConfigPage();
  }
});

function setupConfigMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONFIG_MENU_ID,
      title: "切换小尾巴配置",
      contexts: ["action"]
    });
  });
}

function openConfigPage() {
  chrome.tabs.create({
    url: chrome.runtime.getURL("options.html")
  });
}

function openWelcomePage() {
  chrome.tabs.create({
    url: chrome.runtime.getURL("welcome.html")
  });
}

async function handleActionClick(tab, clickMode) {
  const tabId = tab && tab.id;
  const tabUrl = tab && tab.url ? tab.url : "";
  if (!tabId) return;

  const options = await getSavedOptions();
  if (isNeteasePageUrl(tabUrl)) {
    await handleNeteaseAction(tabId, tabUrl, options);
    return;
  }

  if (!isBiliPageUrl(tabUrl)) {
    throw new Error("请在 B 站视频、直播间或网易云单曲页使用小尾巴");
  }

  const isLiveRoom = isLiveBiliRoomUrl(tabUrl);
  const pageContext = isLiveRoom ? {} : await getCurrentVideoPageContext(tabId);
  const effectiveUrl = isLiveRoom ? tabUrl : applyVideoPageContextToUrl(tabUrl, pageContext);
  const isMultipage = isLiveRoom ? false : await isMultipageVideoUrl(effectiveUrl, pageContext);
  const input = parseBilibiliUrl(effectiveUrl, pageContext);

  if (!input) {
    throw new Error("没有识别到这个 B 站视频");
  }

  if (isLiveRoom || isMultipage || input.fromListLikePage || clickMode === "direct") {
    const directUrl = await getBestDirectUrl(tabId, effectiveUrl, pageContext, options);
    if (!directUrl) {
      throw new Error("没有拿到 B 站临时直链");
    }

    await copyTextAndToast(tabId, directUrl, directMessage(isLiveRoom, isMultipage, input.fromListLikePage), false);
    return;
  }

  const playerUrl = buildPlayerUrl(effectiveUrl);
  await copyTextAndToast(tabId, playerUrl, "已复制 91biliplayer 播放地址啦", false);
}

function isBiliPageUrl(url = "") {
  return url.startsWith("https://www.bilibili.com/") || url.startsWith("https://live.bilibili.com/");
}

function isNeteasePageUrl(rawUrl = "") {
  try {
    const url = new URL(rawUrl);
    return url.hostname === "music.163.com" || url.hostname === "y.music.163.com";
  } catch {
    return false;
  }
}

function isLiveBiliRoomUrl(rawUrl = "") {
  try {
    const url = new URL(rawUrl);
    return url.hostname === "live.bilibili.com" && Boolean(parseLiveRoomId(url));
  } catch {
    return false;
  }
}

function directMessage(isLiveRoom, isMultipage, fromListLikePage) {
  if (isLiveRoom) return "已复制直播直链啦";
  if (isMultipage) return "已复制当前分P直链啦";
  if (fromListLikePage) return "已识别列表里的视频并复制直链啦";
  return "已复制 B 站临时直链啦";
}

function buildPlayerUrl(rawUrl) {
  return BILI_PLAYER_PREFIX + encodeURIComponent(rawUrl);
}

async function handleNeteaseAction(tabId, tabUrl, options) {
  const input = parseNeteaseUrl(tabUrl);
  if (!input) {
    throw new Error("请打开网易云单曲页再点小尾巴");
  }

  const directUrl = await getNeteaseDirectUrl(input, options);
  if (!directUrl) {
    throw new Error("网易云后端没有返回可用音频直链");
  }

  await copyTextAndToast(tabId, directUrl, "已复制网易云音频直链啦", false);
}

function parseNeteaseUrl(rawUrl = "") {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const candidates = [{ pathname: url.pathname, searchParams: url.searchParams }];
  const hash = url.hash ? url.hash.replace(/^#\/?/, "/") : "";
  if (hash) {
    try {
      const hashUrl = new URL(hash, "https://music.163.com");
      candidates.push({ pathname: hashUrl.pathname, searchParams: hashUrl.searchParams });
    } catch {}
  }

  for (const candidate of candidates) {
    const path = candidate.pathname || "";
    const isSongPath = /(^|\/)song(\/|$)/.test(path) || path.includes("/song/media/outer/url");
    const id = normalizeAid(candidate.searchParams.get("id") || "");
    if (isSongPath && id) {
      return { type: "song", id, url: rawUrl };
    }
  }

  return null;
}

async function getNeteaseDirectUrl(input, options) {
  const level = normalizeNeteaseLevel(options.neteaseLevel);
  const session = await getZnnuKeySession();
  const ip = await getZnnuIp();
  const payload = {
    act: "song",
    id: input.id,
    level,
    rawInput: input.id,
    ip
  };
  const signed = await signZnnuPayload(payload);
  const body = new URLSearchParams({
    ...payload,
    signature: signed.signature,
    timestamp: String(signed.timestamp),
    domain: signed.domain
  });
  const json = await postZnnuForm("/api/song", body, session.keyToken);
  const decoded = await decodeZnnuResponse(json, session.key);

  if (decoded && decoded.code !== 200) {
    throw new Error(decoded.msg || decoded.message || "网易云解析失败");
  }

  return extractNeteaseDirectUrl(decoded);
}

function extractNeteaseDirectUrl(json) {
  if (!json || typeof json !== "object") return "";

  const candidates = [
    json.url,
    json.data && json.data.url,
    json.data && json.data.audioUrl,
    json.data && json.data.data && Array.isArray(json.data.data) && json.data.data[0] && json.data.data[0].url,
    Array.isArray(json.data) && json.data[0] && json.data[0].url
  ];

  for (const candidate of candidates) {
    const normalized = typeof candidate === "string" ? candidate.replace(/`/g, "").trim() : "";
    if (/^https?:\/\//i.test(normalized)) {
      return normalized;
    }
  }

  return "";
}

async function getZnnuKeySession() {
  const now = Math.floor(Date.now() / 1000);
  if (znnuKeySession && positiveInt(znnuKeySession.expireAt, 0) - 5 > now) {
    return znnuKeySession;
  }

  const json = await getZnnuJson("/api/key");
  const data = json && json.data ? json.data : null;
  if (json.code !== 200 || !data || !data.key || !data.keyToken || !data.expireAt) {
    throw new Error(json.msg || json.message || "获取网易云解析密钥失败");
  }

  znnuKeySession = {
    key: data.key,
    keyToken: data.keyToken,
    expireAt: positiveInt(data.expireAt, 0)
  };
  return znnuKeySession;
}

async function getZnnuIp() {
  if (znnuIp !== null) return znnuIp;

  try {
    const json = await getZnnuJson("/api/ip");
    znnuIp = json && typeof json.ip === "string" ? json.ip : "";
  } catch {
    znnuIp = "";
  }

  return znnuIp;
}

async function getZnnuJson(path) {
  const response = await fetch(ZNNU_BASE_URL + path, {
    method: "GET",
    credentials: "omit",
    headers: {
      "Accept": "application/json, text/plain, */*",
      "X-Referer": ZNNU_REFERER
    }
  });

  if (!response.ok) {
    throw new Error(`网易云解析请求失败: HTTP ${response.status}`);
  }

  return response.json();
}

async function postZnnuForm(path, body, keyToken) {
  const response = await fetch(ZNNU_BASE_URL + path, {
    method: "POST",
    credentials: "omit",
    headers: {
      "Accept": "application/json, text/plain, */*",
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Referer": ZNNU_REFERER,
      "X-Key-Token": keyToken
    },
    body
  });

  if (!response.ok) {
    throw new Error(`网易云解析请求失败: HTTP ${response.status}`);
  }

  return response.json();
}

async function signZnnuPayload(payload) {
  const timestamp = Math.floor(Date.now() / 1000);
  const domain = "music.znnu.com";
  const cleanPayload = { ...payload };
  delete cleanPayload.signature;
  delete cleanPayload.timestamp;
  delete cleanPayload.domain;
  delete cleanPayload.ver;

  const signString = Object.keys(cleanPayload)
    .sort()
    .reduce((result, key) => result + key + "=" + cleanPayload[key], String(timestamp) + domain);

  const signature = await hmacSha256Hex(ZNNU_SIGNATURE_SECRET, signString);
  return { signature, timestamp, domain };
}

async function hmacSha256Hex(secret, text) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(text));
  return bytesToHex(new Uint8Array(signature));
}

async function decodeZnnuResponse(json, keyBase64) {
  if (!json || !json.data || json.data.enc !== 1 || json.data.alg !== "AES-256-GCM") {
    return json;
  }

  const keyBytes = base64ToBytes(keyBase64);
  const iv = base64ToBytes(json.data.iv);
  const ciphertext = base64ToBytes(json.data.ciphertext);
  const tag = base64ToBytes(json.data.tag);
  const encrypted = new Uint8Array(ciphertext.length + tag.length);
  encrypted.set(ciphertext, 0);
  encrypted.set(tag, ciphertext.length);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
  const data = JSON.parse(new TextDecoder().decode(new Uint8Array(decrypted)));
  return { ...json, data };
}

function base64ToBytes(value) {
  const binary = atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeNeteaseLevel(value) {
  const text = String(value || "").trim();
  return ["standard", "exhigh", "lossless", "hires", "sky", "jyeffect", "jymaster"].includes(text)
    ? text
    : DEFAULT_OPTIONS.neteaseLevel;
}

function getSavedOptions() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_OPTIONS, (items) => {
      if (chrome.runtime.lastError) {
        resolve({ ...DEFAULT_OPTIONS });
        return;
      }

      resolve({
        quality: ["80", "64", "32", "16"].includes(String(items.quality)) ? String(items.quality) : DEFAULT_OPTIONS.quality,
        neteaseLevel: normalizeNeteaseLevel(items.neteaseLevel)
      });
    });
  });
}

async function getBestDirectUrl(tabId, tabUrl, pageContext, options) {
  const context = pageContext || await getCurrentVideoPageContext(tabId);
  return getDirectUrlFromApi(tabUrl, context, options);
}

async function getCurrentVideoPageContext(tabId) {
  if (!tabId) return {};

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        function positiveInt(value, fallback = 0) {
          const number = Number.parseInt(value, 10);
          return Number.isFinite(number) && number > 0 ? number : fallback;
        }

        function normalizeBvid(value) {
          const text = String(value || "").trim();
          const match = text.match(/^(BV[0-9A-Za-z]+)/i);
          return match ? match[1] : "";
        }

        function normalizeAid(value) {
          const text = String(value || "").trim();
          const match = text.match(/^(?:av)?(\d+)$/i);
          return match ? match[1] : "";
        }

        function findActivePageIndex() {
          const activeSelectors = [
            ".video-pod__item.active",
            ".video-pod__item--active",
            ".video-pod__item.on",
            ".multi-page .cur-list .on",
            ".list-box li.on",
            ".cur-list li.on",
            "[class*='video-pod__item'][class*='active']",
            "[class*='video-pod__item'][class*='current']"
          ];

          const itemSelectors = [
            ".video-pod__item",
            ".multi-page .cur-list li",
            ".list-box li",
            ".cur-list li",
            "[class*='video-pod__item']"
          ];

          for (const selector of activeSelectors) {
            const active = document.querySelector(selector);
            if (!active) continue;

            const attrPage = positiveInt(
              active.getAttribute("data-page") ||
              active.getAttribute("data-p") ||
              active.getAttribute("page"),
              0
            );
            if (attrPage) return attrPage;

            const attrIndex = positiveInt(
              active.getAttribute("data-index") ||
              active.getAttribute("data-idx"),
              0
            );
            if (attrIndex) return attrIndex + 1;

            for (const itemSelector of itemSelectors) {
              const item = active.closest(itemSelector);
              if (!item) continue;
              const items = Array.from(document.querySelectorAll(itemSelector));
              const index = items.indexOf(item);
              if (index >= 0) return index + 1;
            }
          }

          return 0;
        }

        let urlPage = 0;
        try {
          urlPage = positiveInt(new URL(location.href).searchParams.get("p"), 0);
        } catch {}

        const state = window.__INITIAL_STATE__ || {};
        const videoData = state.videoData || state.videoInfo || {};
        const pages = Array.isArray(videoData.pages)
          ? videoData.pages
          : Array.isArray(state.pages)
          ? state.pages
          : [];

        const stateCid = positiveInt(state.cid || videoData.cid || (state.player && state.player.cid), 0);
        const statePage = positiveInt(state.p || state.page || videoData.page, 0);
        const pageByCid = stateCid && pages.length
          ? pages.findIndex((item) => String(item.cid) === String(stateCid)) + 1
          : 0;
        const domPage = findActivePageIndex();
        const page = urlPage || domPage || pageByCid || statePage || 0;
        const pageInfo = page && pages[page - 1] ? pages[page - 1] : null;
        const cid = positiveInt((pageInfo && pageInfo.cid) || stateCid, 0);

        return {
          page,
          cid,
          pagesCount: pages.length,
          bvid: normalizeBvid(state.bvid || videoData.bvid),
          aid: normalizeAid(state.aid || videoData.aid),
          source: urlPage ? "url" : domPage ? "dom" : pageByCid ? "state-cid" : statePage ? "state" : ""
        };
      }
    });

    return result && result.result && typeof result.result === "object" ? result.result : {};
  } catch (error) {
    console.warn("[Bili小尾巴 VRC解析] read page context failed", error && error.message ? error.message : error);
    return {};
  }
}

function applyVideoPageContextToUrl(rawUrl, pageContext = {}) {
  const page = positiveInt(pageContext.page, 0);
  if (!page || page <= 1) return rawUrl;

  try {
    const url = new URL(rawUrl);
    const hasVideoIdentity =
      /\/video\/(?:BV|av)/i.test(url.pathname) ||
      url.searchParams.has("bvid") ||
      url.searchParams.has("aid") ||
      url.searchParams.has("avid") ||
      url.searchParams.has("oid");

    if (url.hostname !== "www.bilibili.com" || !hasVideoIdentity) {
      return rawUrl;
    }

    if (positiveInt(url.searchParams.get("p"), 0) === page) {
      return rawUrl;
    }

    url.searchParams.set("p", String(page));
    return url.href;
  } catch {
    return rawUrl;
  }
}

async function isMultipageVideoUrl(rawUrl, pageContext = {}) {
  const contextPagesCount = positiveInt(pageContext.pagesCount, 0);
  if (contextPagesCount > 1) return true;

  const input = parseBilibiliUrl(rawUrl, pageContext);
  if (!input || input.type !== "video") return false;
  if (positiveInt(input.page, 1) > 1 || positiveInt(pageContext.page, 0) > 1) {
    return true;
  }

  try {
    const view = await getViewInfo(input);
    const pages = Array.isArray(view.pages) ? view.pages : [];
    return positiveInt(view.videos, pages.length) > 1 || pages.length > 1;
  } catch (error) {
    console.warn("[Bili小尾巴 VRC解析] multipage check failed", error && error.message ? error.message : error);
    return false;
  }
}

function parseBilibiliUrl(rawUrl, pageContext = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const path = url.pathname;
  const host = url.hostname;

  if (host === "live.bilibili.com") {
    const roomId = parseLiveRoomId(url);
    if (roomId) {
      return {
        type: "live",
        roomId,
        url: rawUrl
      };
    }
  }

  const bvFromPath = path.match(/\/video\/(BV[0-9A-Za-z]+)/i);
  const avFromPath = path.match(/\/video\/av(\d+)/i);
  const ep = path.match(/\/bangumi\/play\/ep(\d+)/i);
  const bvidFromQuery = url.searchParams.get("bvid") || "";
  const aidFromQuery = url.searchParams.get("aid") || url.searchParams.get("avid") || url.searchParams.get("oid") || "";
  const bvid = bvFromPath ? bvFromPath[1] : normalizeBvid(bvidFromQuery) || normalizeBvid(pageContext.bvid);
  const aid = avFromPath ? avFromPath[1] : normalizeAid(aidFromQuery) || normalizeAid(pageContext.aid);
  const urlPage = positiveInt(url.searchParams.get("p"), 0);
  const contextPage = positiveInt(pageContext.page, 0);
  const contextCid = positiveInt(pageContext.cid, 0);

  if (bvid || aid) {
    return {
      type: "video",
      bvid,
      aid,
      page: urlPage || contextPage || 1,
      cid: contextCid || 0,
      url: rawUrl,
      fromListLikePage: !bvFromPath && !avFromPath
    };
  }

  if (ep) {
    return {
      type: "bangumi",
      epid: ep[1],
      page: 1,
      url: rawUrl
    };
  }

  return null;
}

function parseLiveRoomId(url) {
  const fromQuery = normalizeAid(url.searchParams.get("room_id") || url.searchParams.get("roomid") || "");
  if (fromQuery) return fromQuery;

  const segments = url.pathname
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const match = segment.match(/^(\d+)$/);
    if (match) return match[1];
  }

  return "";
}

function normalizeBvid(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(BV[0-9A-Za-z]+)/i);
  return match ? match[1] : "";
}

function normalizeAid(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(?:av)?(\d+)$/i);
  return match ? match[1] : "";
}

async function getDirectUrlFromApi(tabUrl, pageContext, options) {
  const input = parseBilibiliUrl(tabUrl, pageContext);
  if (!input) return "";

  if (input.type === "live") {
    return parseLiveDirect(input, { quality: 10000 });
  }

  if (input.type === "video") {
    return parseStandardVideoDirect(input, { quality: positiveInt(options.quality, 80), format: "mp4" });
  }

  throw new Error("番剧/课程页面暂不支持直链");
}

async function parseStandardVideoDirect(input, options) {
  const view = await getViewInfo(input);
  const page = selectVideoPage(view, input);
  if (!page || !page.cid) {
    throw new Error("没有找到当前分P的 cid");
  }

  const quality = positiveInt(options.quality, 80);
  const format = options.format === "dash" ? "dash" : "mp4";
  const play = await getPlayUrl({
    aid: view.aid || input.aid,
    bvid: view.bvid || input.bvid,
    cid: page.cid,
    quality,
    format
  });

  const direct = normalizePlayResult(play, format, quality);
  return direct.directUrl || "";
}

function selectVideoPage(view, input) {
  const pages = Array.isArray(view.pages) ? view.pages : [];
  if (!pages.length) return null;

  const currentCid = positiveInt(input.cid, 0);
  if (currentCid) {
    const byCid = pages.find((page) => String(page.cid) === String(currentCid));
    if (byCid) return byCid;
  }

  const pageIndex = Math.max(0, Math.min((input.page || 1) - 1, pages.length - 1));
  return pages[pageIndex];
}

async function parseLiveDirect(input, options) {
  const room = await getLiveRoomInfo(input.roomId);
  if (!room || !room.room_id) {
    throw new Error("没有找到直播间信息");
  }

  if (room.live_status !== 1) {
    throw new Error("这个直播间现在没有开播");
  }

  const playInfo = await getLivePlayInfo(room.room_id, positiveInt(options.quality, 10000));
  const direct = normalizeLivePlayResult(playInfo);
  if (!direct.directUrl) {
    throw new Error("没有找到直播流地址");
  }

  return direct.directUrl;
}

async function getLiveRoomInfo(roomId) {
  const params = new URLSearchParams({ id: String(roomId) });
  const json = await getJson(`https://api.live.bilibili.com/room/v1/Room/room_init?${params}`);
  if (json.code !== 0 || !json.data) {
    throw new Error(json.message || json.msg || "获取直播间信息失败");
  }
  return json.data;
}

async function getLivePlayInfo(realRoomId, quality) {
  const params = new URLSearchParams({
    room_id: String(realRoomId),
    protocol: "0,1",
    format: "1",
    codec: "0,1",
    qn: String(quality),
    platform: "h5",
    ptype: "8"
  });

  const json = await getJson(`https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?${params}`);
  if (json.code !== 0 || !json.data) {
    throw new Error(json.message || json.msg || "获取直播流失败");
  }
  return json.data;
}

async function getViewInfo(input) {
  const params = new URLSearchParams();
  if (input.bvid) params.set("bvid", input.bvid);
  if (input.aid) params.set("aid", input.aid);

  const json = await getJson(`https://api.bilibili.com/x/web-interface/view?${params}`);
  if (json.code !== 0 || !json.data) {
    throw new Error(json.message || "获取视频信息失败");
  }

  if (!Array.isArray(json.data.pages) || json.data.pages.length === 0) {
    throw new Error("视频没有可用分P信息");
  }

  return json.data;
}

async function getPlayUrl({ aid, bvid, cid, quality, format }) {
  const params = new URLSearchParams({
    avid: aid ? String(aid) : "",
    bvid: bvid || "",
    cid: String(cid),
    qn: String(quality),
    type: format,
    otype: "json",
    fnver: "0",
    fnval: format === "dash" ? "4048" : "0",
    fourk: "1"
  });

  if (format === "mp4") {
    params.set("platform", "html5");
    params.set("high_quality", quality >= 80 ? "1" : "0");
  }

  const json = await getJson(`https://api.bilibili.com/x/player/playurl?${params}`);
  if (json.code !== 0 || !json.data) {
    throw new Error(json.message || "获取播放地址失败");
  }

  return json.data;
}

async function getJson(url) {
  const response = await fetch(url, {
    method: "GET",
    credentials: "omit",
    headers: {
      "Accept": "application/json, text/plain, */*"
    }
  });

  if (!response.ok) {
    throw new Error(`请求失败: HTTP ${response.status}`);
  }

  return response.json();
}

function normalizePlayResult(data, format, requestedQuality) {
  if (format === "dash" && data.dash) {
    const videos = Array.isArray(data.dash.video) ? data.dash.video : [];
    const audio = Array.isArray(data.dash.audio) ? data.dash.audio[0] : null;
    const selected = videos.find((item) => item.id <= requestedQuality) || videos[0];

    return {
      actualQuality: selected ? selected.id : data.quality,
      acceptQuality: data.accept_quality || [],
      directUrl: selected ? selected.baseUrl || selected.base_url : "",
      videoUrl: selected ? selected.baseUrl || selected.base_url : "",
      audioUrl: audio ? audio.baseUrl || audio.base_url : "",
      backupUrls: selected ? selected.backupUrl || selected.backup_url || [] : []
    };
  }

  const first = Array.isArray(data.durl) ? data.durl[0] : null;
  return {
    actualQuality: data.quality,
    acceptQuality: data.accept_quality || [],
    directUrl: first ? first.url : "",
    videoUrl: first ? first.url : "",
    audioUrl: "",
    backupUrls: first ? first.backup_url || first.backupUrl || [] : []
  };
}

function normalizeLivePlayResult(data) {
  const streams = data && data.playurl_info && data.playurl_info.playurl && data.playurl_info.playurl.stream;
  if (!Array.isArray(streams)) {
    return { directUrl: "", actualQuality: 0, backupUrls: [] };
  }

  const candidates = [];

  for (const stream of streams) {
    const protocolName = stream && stream.protocol_name ? stream.protocol_name : "";
    const formats = Array.isArray(stream && stream.format) ? stream.format : [];

    for (const format of formats) {
      const formatName = format && format.format_name ? format.format_name : "";
      const codecs = Array.isArray(format && format.codec) ? format.codec : [];

      for (const codec of codecs) {
        const baseUrl = (codec && (codec.base_url || codec.baseUrl)) || "";
        const urlInfos = Array.isArray(codec && codec.url_info) ? codec.url_info : [];
        const codecName = codec && codec.codec_name ? codec.codec_name : "";
        const quality = positiveInt(codec && codec.current_qn, 0);

        for (const urlInfo of urlInfos) {
          const fullUrl = combineLiveUrl((urlInfo && urlInfo.host) || "", baseUrl, (urlInfo && urlInfo.extra) || "");
          if (!fullUrl) continue;

          candidates.push({
            url: fullUrl,
            quality,
            score: liveCandidateScore(protocolName, formatName, codecName, quality)
          });
        }
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const selected = candidates[0];

  return {
    directUrl: selected ? selected.url : "",
    actualQuality: selected ? selected.quality : 0,
    backupUrls: candidates.slice(1, 6).map((item) => item.url)
  };
}

function combineLiveUrl(host, baseUrl, extra) {
  if (!host || !baseUrl) return "";
  const normalizedHost = host.endsWith("/") ? host.slice(0, -1) : host;
  const normalizedBase = baseUrl.startsWith("/") ? baseUrl : "/" + baseUrl;
  return normalizedHost + normalizedBase + (extra || "");
}

function liveCandidateScore(protocolName, formatName, codecName, quality) {
  let score = positiveInt(quality, 0);
  if (protocolName === "http_hls") score += 100000;
  if (formatName === "fmp4") score += 20000;
  if (formatName === "ts") score += 10000;
  if (formatName === "flv") score += 1000;
  if (codecName === "avc") score += 500;
  if (codecName === "hevc") score += 100;
  return score;
}

async function copyTextAndToast(tabId, text, message, isError) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: copyTextAndShowToast,
    args: [text, message, isError]
  });
}

async function showToastOnly(tabId, message, isError) {
  try {
    await copyTextAndToast(tabId, "", message, isError);
  } catch (error) {
    console.warn("[Bili小尾巴 VRC解析] toast failed", error && error.message ? error.message : error);
  }
}

async function copyTextAndShowToast(text, message, isError) {
  const toastId = "bili-tail-vrc-toast";

  async function copyText(value) {
    if (!value) {
      return;
    }

    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(value);
        return;
      } catch {
        // Fall through to the selection-based copy path.
      }
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.documentElement.appendChild(textarea);
    textarea.focus();
    textarea.select();

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } finally {
      textarea.remove();
    }

    if (!copied) {
      throw new Error("无法写入剪贴板");
    }
  }

  function showToast() {
    let toast = document.getElementById(toastId);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = toastId;
      document.documentElement.appendChild(toast);
    }

    toast.textContent = message;
    toast.setAttribute("role", "status");
    toast.style.position = "fixed";
    toast.style.top = "18px";
    toast.style.left = "50%";
    toast.style.zIndex = "2147483647";
    toast.style.maxWidth = "min(520px, calc(100vw - 32px))";
    toast.style.padding = "11px 16px";
    toast.style.border = isError ? "1px solid #f0aaa0" : "1px solid #9de2b9";
    toast.style.borderRadius = "14px";
    toast.style.background = isError ? "#fff0ed" : "#e8f8ee";
    toast.style.color = isError ? "#9d3f34" : "#1f6b42";
    toast.style.boxShadow = "0 12px 28px rgba(50, 84, 63, 0.16)";
    toast.style.font = "650 14px/1.38 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    toast.style.letterSpacing = "0";
    toast.style.pointerEvents = "none";
    toast.style.opacity = "0";
    toast.style.textAlign = "center";
    toast.style.transform = "translate(-50%, -8px)";
    toast.style.transition = "opacity 140ms ease, transform 140ms ease";

    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translate(-50%, 0)";
    });

    clearTimeout(window.__biliTailVrcToastTimer);
    window.__biliTailVrcToastTimer = setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translate(-50%, -8px)";
      setTimeout(() => {
        toast.remove();
      }, 180);
    }, 2000);
  }

  await copyText(text);
  showToast();
}

function makeUserErrorMessage(error) {
  const message = error && error.message ? error.message : "";
  if (message.includes("网易云后端没有返回")) return "网易云没有给到直链，可能是歌曲版权、会员权限或临时限制";
  if (message.includes("获取网易云解析密钥")) return "网易云解析通道暂时没准备好，稍后再试一下";
  if (message.includes("网易云解析失败")) return message;
  if (message.includes("歌曲无法播放") || message.includes("VIP") || message.includes("已下架")) return message;
  if (message.includes("网易云单曲页")) return message;
  if (message.includes("Failed to fetch")) return "网易云解析通道暂时没连上，稍后再试一下";
  if (message.includes("没有开播")) return "这个直播间还没开播，暂时拿不到直链";
  if (message.includes("不是 B 站") || message.includes("请在 B 站") || message.includes("请在 B 站视频")) return "先打开 B 站视频、直播间或网易云单曲页，再点小尾巴就好啦";
  if (message.includes("HTTP") || message.includes("请求失败")) return "解析接口刚刚没回应，刷新页面或检查本机服务后再试一下";
  if (message.includes("获取播放地址失败")) return "B 站暂时没给到播放地址，可能是权限或网络限制";
  if (message.includes("番剧") || message.includes("课程")) return message;
  if (message.includes("直链") || message.includes("分P") || message.includes("直播")) return message;
  return "解析失败啦：刷新页面再试一次；还是不行就联系我。";
}

function positiveInt(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
