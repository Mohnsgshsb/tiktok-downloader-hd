(function () {
  "use strict";

  const config = window.DOWNLOADER_CONFIG || {};
  const platformKey = String(config.platformKey || "").toLowerCase();
  const alwaysShowFallback = !!config.alwaysShowFallback;
  const state = {
    mode: config.defaultMode || "hd",
    media: null,
    sourceUrl: "",
    youtubeVideoId: ""
  };

  const urlInput = document.getElementById("urlInput");
  const pasteBtn = document.getElementById("pasteBtn");
  const findBtn = document.getElementById("findBtn");
  const modeButtons = Array.from(document.querySelectorAll(".mode-btn"));
  const statusBox = document.getElementById("statusBox");
  const previewEmpty = document.getElementById("previewEmpty");
  const resultBox = document.getElementById("resultBox");
  const thumb = document.getElementById("thumb");
  const metaTitle = document.getElementById("metaTitle");
  const metaSub = document.getElementById("metaSub");
  const downloadBtn = document.getElementById("downloadBtn");
  const progressBar = document.getElementById("progressBar");
  const progressFill = document.getElementById("progressFill");
  const altBtn = document.getElementById("altBtn");

  const trackingParams = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "feature",
    "si",
    "fbclid",
    "igshid",
    "ig_rid",
    "tt_from",
    "is_copy_url",
    "is_from_webapp",
    "sender_device"
  ];

  const validHosts = Array.isArray(config.validHosts) ? config.validHosts : [];
  if (!urlInput || !findBtn || !downloadBtn) return;

  function setStatus(message, type) {
    if (!message) {
      statusBox.textContent = "";
      statusBox.style.display = "none";
      return;
    }
    statusBox.textContent = message;
    statusBox.className = "status " + (type || "ok");
    statusBox.style.display = "block";
  }

  function setFindBusy(isBusy) {
    findBtn.disabled = isBusy;
    findBtn.textContent = isBusy ? "Finding..." : "Find Video";
  }

  function setDownloadBusy(isBusy) {
    downloadBtn.disabled = isBusy;
    downloadBtn.textContent = isBusy ? "Downloading..." : "Download Now";
  }

  function resetProgress() {
    progressFill.style.width = "0%";
    progressBar.style.display = "none";
  }

  function showProgress(percent) {
    progressBar.style.display = "block";
    progressFill.style.width = Math.max(0, Math.min(100, percent)) + "%";
  }

  function setAlternativeButtonVisible(isVisible) {
    if (!altBtn) return;
    const shouldShow = alwaysShowFallback || isVisible;
    altBtn.style.display = shouldShow ? "block" : "none";
  }

  function sanitizeFilename(value) {
    return (value || "downloaded_media")
      .replace(/[^a-z0-9]/gi, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "downloaded_media";
  }

  function extractYouTubeVideoId(input) {
    const raw = (input || "").trim();
    if (!raw) return "";
    const idPattern = /^[a-zA-Z0-9_-]{11}$/;
    if (idPattern.test(raw)) return raw;

    const withProtocol = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
    try {
      const parsed = new URL(withProtocol);
      const host = parsed.hostname.toLowerCase();
      if (host.endsWith("youtu.be")) {
        const segment = parsed.pathname.split("/").filter(Boolean)[0] || "";
        return idPattern.test(segment) ? segment : "";
      }
      if (host.includes("youtube.com")) {
        const watchId = parsed.searchParams.get("v") || "";
        if (idPattern.test(watchId)) return watchId;
        const pathParts = parsed.pathname.split("/").filter(Boolean);
        if (pathParts.length >= 2 && (pathParts[0] === "shorts" || pathParts[0] === "embed")) {
          return idPattern.test(pathParts[1]) ? pathParts[1] : "";
        }
      }
    } catch {
      return "";
    }
    return "";
  }

  function hostMatches(hostname) {
    if (!validHosts.length) return true;
    return validHosts.some((allowedHost) => {
      const normalizedHost = String(allowedHost || "").toLowerCase().trim();
      return hostname === normalizedHost || hostname.endsWith("." + normalizedHost);
    });
  }

  function normalizeInputUrl(input) {
    const raw = (input || "").trim();
    if (!raw) return "";

    if (platformKey === "youtube") {
      const videoId = extractYouTubeVideoId(raw);
      if (!videoId) return "";
      state.youtubeVideoId = videoId;
      return "https://www.youtube.com/watch?v=" + videoId;
    }

    const withProtocol = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
    try {
      const parsed = new URL(withProtocol);
      const hostname = parsed.hostname.toLowerCase();
      if (!hostMatches(hostname)) return "";
      trackingParams.forEach((param) => parsed.searchParams.delete(param));
      return parsed.toString();
    } catch {
      return "";
    }
  }

  function updateMode(nextMode) {
    state.mode = nextMode;
    modeButtons.forEach((btn) => {
      const active = btn.dataset.mode === nextMode;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
    if (state.media) {
      metaSub.textContent = "Mode: " + state.mode.toUpperCase();
    }
  }

  function pickMediaUrl(payload) {
    if (payload && typeof payload.url === "string" && payload.url) {
      return payload.url;
    }
    if (payload && Array.isArray(payload.picker) && payload.picker.length) {
      const pick = payload.picker.find((item) => item && (item.url || item.src)) || payload.picker[0];
      if (pick && pick.url) return pick.url;
      if (pick && pick.src) return pick.src;
    }
    return "";
  }

  function titleFromPayload(payload, fallbackUrl) {
    if (payload && typeof payload.filename === "string" && payload.filename) {
      return payload.filename.replace(/\.[a-z0-9]{2,5}$/i, "");
    }
    try {
      const parsed = new URL(fallbackUrl);
      return (config.platformName || "Social") + " - " + parsed.hostname;
    } catch {
      return (config.platformName || "Social") + " media";
    }
  }

  async function fetchFromCobalt(sourceUrl, mode) {
    const endpoints = Array.isArray(config.apiEndpoints) && config.apiEndpoints.length
      ? config.apiEndpoints
      : [config.apiEndpoint || "https://downloadapi.stuff.solutions/api/json"];

    const requestBody = {
      url: sourceUrl,
      isAudioOnly: mode === "audio",
      filenameStyle: "pretty"
    };

    if (mode === "audio") {
      requestBody.aFormat = "mp3";
    }

    let lastError = "Could not fetch media.";
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify(requestBody)
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.status === "error") {
          const details = payload && (payload.text || (payload.error && payload.error.code));
          lastError = details || "Could not fetch media.";
          continue;
        }

        const mediaUrl = pickMediaUrl(payload);
        if (!mediaUrl) {
          lastError = "No downloadable file was returned.";
          continue;
        }

        return {
          url: mediaUrl,
          title: titleFromPayload(payload, sourceUrl),
          cover: "logo.png",
          type: mode === "audio" ? "audio" : "video"
        };
      } catch (error) {
        lastError = (error && error.message) ? error.message : "Could not fetch media.";
      }
    }

    throw new Error(lastError);
  }

  async function responseToBlobWithProgress(response, onProgress) {
    if (!response.body || typeof response.body.getReader !== "function") {
      onProgress(100);
      return response.blob();
    }

    const totalSize = Number.parseInt(response.headers.get("content-length") || "0", 10);
    const reader = response.body.getReader();
    const chunks = [];
    let loadedSize = 0;

    while (true) {
      const part = await reader.read();
      if (part.done) break;
      chunks.push(part.value);
      loadedSize += part.value.byteLength;
      if (totalSize > 0) {
        onProgress(Math.round((loadedSize / totalSize) * 100));
      }
    }

    if (totalSize === 0) onProgress(95);
    return new Blob(chunks);
  }

  function fallbackOpenSource(url) {
    const openedWindow = window.open(url, "_blank", "noopener,noreferrer");
    if (!openedWindow) {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    }
  }

  function buildAlternativeUrl() {
    const fallbackTemplate = config.fallbackUrl || "https://download.stuff.solutions";
    if (fallbackTemplate.includes("{url}")) {
      return fallbackTemplate.replace("{url}", encodeURIComponent(state.sourceUrl || ""));
    }
    if (fallbackTemplate.includes("{id}")) {
      return fallbackTemplate.replace("{id}", encodeURIComponent(state.youtubeVideoId || ""));
    }
    return fallbackTemplate;
  }

  async function findMedia() {
    const normalizedUrl = normalizeInputUrl(urlInput.value);
    if (!normalizedUrl) {
      setStatus("Please enter a valid " + (config.platformName || "social") + " URL.", "err");
      previewEmpty.style.display = "block";
      resultBox.style.display = "none";
      state.media = null;
      downloadBtn.disabled = true;
      setAlternativeButtonVisible(false);
      return;
    }

    state.sourceUrl = normalizedUrl;
    urlInput.value = normalizedUrl;
    setFindBusy(true);
    setStatus("", "ok");
    setAlternativeButtonVisible(false);
    resetProgress();
    downloadBtn.disabled = true;

    try {
      const media = await fetchFromCobalt(normalizedUrl, state.mode);
      state.media = media;
      thumb.src = media.cover || "logo.png";
      thumb.alt = media.title + " preview";
      metaTitle.textContent = media.title;
      metaSub.textContent = "Mode: " + state.mode.toUpperCase();
      previewEmpty.style.display = "none";
      resultBox.style.display = "block";
      downloadBtn.disabled = false;
      setAlternativeButtonVisible(false);
      setStatus("Media found. Click Download Now.", "ok");
    } catch (error) {
      state.media = null;
      previewEmpty.style.display = "block";
      resultBox.style.display = "none";
      downloadBtn.disabled = true;
      setAlternativeButtonVisible(true);
      const fallbackMessage = alwaysShowFallback
        ? "Primary server is busy. Click Open Alternative Downloader."
        : (error.message || "Could not fetch media for this URL.");
      setStatus(fallbackMessage, "err");
    } finally {
      setFindBusy(false);
    }
  }

  async function downloadMedia() {
    if (!state.media || !state.media.url) {
      setStatus("Find media first.", "err");
      return;
    }

    setDownloadBusy(true);
    showProgress(0);

    try {
      const response = await fetch(state.media.url);
      if (!response.ok) throw new Error("download-fail");
      const blob = await responseToBlobWithProgress(response, showProgress);
      showProgress(100);

      const ext = state.media.type === "audio" ? "mp3" : "mp4";
      const filename = sanitizeFilename(state.media.title) + "_" + state.mode + "." + ext;
      const objectUrl = URL.createObjectURL(blob);

      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(objectUrl);

      setStatus("Downloaded: " + filename, "ok");
    } catch {
      setStatus("Direct download blocked by browser. Opening source URL instead.", "err");
      fallbackOpenSource(state.media.url);
    } finally {
      setDownloadBusy(false);
      setTimeout(resetProgress, 900);
    }
  }

  pasteBtn.addEventListener("click", async () => {
    try {
      const clipText = await navigator.clipboard.readText();
      urlInput.value = (clipText || "").trim();
      setStatus("", "ok");
    } catch {
      setStatus("Clipboard access is blocked in this browser.", "err");
    }
  });

  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => updateMode(btn.dataset.mode));
  });

  findBtn.addEventListener("click", findMedia);
  downloadBtn.addEventListener("click", downloadMedia);

  if (altBtn) {
    setAlternativeButtonVisible(false);
    altBtn.addEventListener("click", () => {
      const fallback = buildAlternativeUrl();
      fallbackOpenSource(fallback);
    });
  }

  urlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      findMedia();
    }
  });
})();
