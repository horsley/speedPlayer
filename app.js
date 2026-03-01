const TRACK_CACHE_KEY = "speed_player_tracks_cache_v1";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const TRACK_COLLATOR = new Intl.Collator("zh-Hans-CN", {
  numeric: true,
  sensitivity: "base",
});

const searchButton = document.getElementById("search-btn");
const searchBox = document.getElementById("search-box");
const searchInput = document.getElementById("search-input");
const refreshButton = document.getElementById("refresh-btn");

const trackListEl = document.getElementById("track-list");
const nowPlayingEl = document.getElementById("now-playing");
const audio = document.getElementById("audio-player");
const playPauseButton = document.getElementById("play-pause");
const backwardButton = document.getElementById("backward");
const backToStartButton = document.getElementById("back-to-start");
const forwardButton = document.getElementById("forward");
const timeEl = document.getElementById("time");

const presetSpeedsEl = document.getElementById("preset-speeds");
const speedSlider = document.getElementById("speed-slider");
const speedLabel = document.getElementById("speed-label");

const state = {
  tracks: [],
  currentTrackIndex: -1,
  playbackRate: 1,
  isScanning: false,
  searchQuery: "",
};

let refreshIconResetTimer = null;
const searchIconUse = searchButton?.querySelector("use") || null;
const refreshIconUse = refreshButton?.querySelector("use") || null;
const playPauseIconUse = playPauseButton?.querySelector("use") || null;

function setButtonIcon(useElement, symbolId) {
  if (!useElement) {
    return;
  }

  const iconRef = `#${symbolId}`;
  useElement.setAttribute("href", iconRef);
  useElement.setAttributeNS(XLINK_NS, "xlink:href", iconRef);
}

function normalizeTracks(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((track) => track && typeof track.relativePath === "string" && track.relativePath.trim())
    .map((track) => {
      const relativePath = track.relativePath.trim();
      const fallbackName = relativePath.split("/").filter(Boolean).pop() || relativePath;
      const name = typeof track.name === "string" && track.name.trim() ? track.name.trim() : fallbackName;

      return {
        name,
        relativePath,
      };
    });
}

function sortTracks(input) {
  return [...input].sort((left, right) => {
    const byName = TRACK_COLLATOR.compare(left.name, right.name);
    if (byName !== 0) {
      return byName;
    }
    return TRACK_COLLATOR.compare(left.relativePath, right.relativePath);
  });
}

function readTrackCache() {
  try {
    const raw = localStorage.getItem(TRACK_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    const tracks = normalizeTracks(parsed?.tracks);
    return tracks.length ? tracks : null;
  } catch {
    return null;
  }
}

function saveTrackCache(tracks) {
  try {
    localStorage.setItem(
      TRACK_CACHE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        tracks: normalizeTracks(tracks),
      }),
    );
  } catch {
    // localStorage 在部分环境不可写，不影响主流程。
  }
}

function setRefreshButtonState(mode) {
  if (refreshIconResetTimer) {
    clearTimeout(refreshIconResetTimer);
    refreshIconResetTimer = null;
  }

  if (!refreshButton) {
    return;
  }

  if (mode === "loading") {
    refreshButton.classList.add("is-loading");
    setButtonIcon(refreshIconUse, "icon-refresh");
    refreshButton.setAttribute("aria-label", "正在刷新");
    refreshButton.title = "正在刷新";
    refreshButton.disabled = true;
    return;
  }

  refreshButton.classList.remove("is-loading");
  refreshButton.disabled = false;

  if (mode === "success") {
    setButtonIcon(refreshIconUse, "icon-check");
    refreshButton.setAttribute("aria-label", "刷新成功");
    refreshButton.title = "刷新成功";
    refreshIconResetTimer = setTimeout(() => setRefreshButtonState("idle"), 1200);
    return;
  }

  if (mode === "error") {
    setButtonIcon(refreshIconUse, "icon-alert");
    refreshButton.setAttribute("aria-label", "刷新失败");
    refreshButton.title = "刷新失败";
    refreshIconResetTimer = setTimeout(() => setRefreshButtonState("idle"), 1500);
    return;
  }

  setButtonIcon(refreshIconUse, "icon-refresh");
  refreshButton.setAttribute("aria-label", "刷新列表");
  refreshButton.title = "刷新列表";
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "00:00";
  }

  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainSeconds = total % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainSeconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(remainSeconds).padStart(2, "0")}`;
}

function updatePlayPauseLabel() {
  const canPause = Boolean(audio.src) && !audio.paused && !audio.ended;
  setButtonIcon(playPauseIconUse, canPause ? "icon-pause" : "icon-play");
  playPauseButton.setAttribute("aria-label", canPause ? "暂停" : "播放");
}

function updateTimeDisplay() {
  timeEl.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
}

function updateNowPlaying() {
  if (state.currentTrackIndex < 0 || state.currentTrackIndex >= state.tracks.length) {
    nowPlayingEl.textContent = "当前未选择歌曲";
    return;
  }

  const track = state.tracks[state.currentTrackIndex];
  nowPlayingEl.textContent = track.relativePath;
}

function renderTrackList() {
  trackListEl.innerHTML = "";

  if (!state.tracks.length) {
    return;
  }

  const keyword = state.searchQuery.trim().toLowerCase();
  const visibleTracks = state.tracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => {
      if (!keyword) {
        return true;
      }

      return (
        track.name.toLowerCase().includes(keyword) ||
        track.relativePath.toLowerCase().includes(keyword)
      );
    });

  if (!visibleTracks.length) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "track-empty";
    emptyItem.textContent = "没有匹配的歌曲";
    trackListEl.appendChild(emptyItem);
    return;
  }

  visibleTracks.forEach(({ track, index }) => {
    const item = document.createElement("li");
    item.className = "track-item";
    item.dataset.index = String(index);

    if (index === state.currentTrackIndex) {
      item.classList.add("active");
    }

    const name = document.createElement("span");
    name.className = "track-name";
    name.textContent = track.name;

    const path = document.createElement("span");
    path.className = "track-path";
    path.textContent = track.relativePath;

    item.append(name, path);
    trackListEl.appendChild(item);
  });
}

function applyPlaybackRate(rate) {
  const clamped = Math.min(1.5, Math.max(0.5, rate));
  state.playbackRate = clamped;
  audio.playbackRate = clamped;

  if ("preservesPitch" in audio) {
    audio.preservesPitch = true;
  }
  if ("webkitPreservesPitch" in audio) {
    audio.webkitPreservesPitch = true;
  }

  const percent = Math.round(clamped * 100);
  speedSlider.value = String(percent);
  speedLabel.textContent = `${percent}%`;

  const presetButtons = presetSpeedsEl.querySelectorAll("button[data-percent]");
  presetButtons.forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.percent) === percent);
  });
}

function streamUrlForTrack(track) {
  return `/api/stream?path=${encodeURIComponent(track.relativePath)}`;
}

function applyTrackList(tracks, { preserveCurrent = false } = {}) {
  const normalized = sortTracks(normalizeTracks(tracks));
  const currentPath = preserveCurrent ? state.tracks[state.currentTrackIndex]?.relativePath || "" : "";

  state.tracks = normalized;

  let keepCurrent = false;
  if (currentPath) {
    const matchedIndex = normalized.findIndex((track) => track.relativePath === currentPath);
    if (matchedIndex >= 0) {
      state.currentTrackIndex = matchedIndex;
      keepCurrent = true;
    }
  }

  if (!keepCurrent) {
    state.currentTrackIndex = -1;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }

  renderTrackList();
  updateNowPlaying();
  updatePlayPauseLabel();
  updateTimeDisplay();
}

function setSearchOpen(open) {
  if (!searchButton || !searchBox) {
    return;
  }

  searchButton.setAttribute("aria-expanded", String(open));
  searchBox.classList.toggle("open", open);
  searchBox.setAttribute("aria-hidden", String(!open));
  setButtonIcon(searchIconUse, open ? "icon-close" : "icon-search");

  if (open) {
    searchInput?.focus();
    return;
  }

  if (searchInput) {
    searchInput.value = "";
  }
  state.searchQuery = "";
  renderTrackList();
}

function restoreTrackListFromCache() {
  const tracks = readTrackCache();
  if (!tracks) {
    return false;
  }

  applyTrackList(tracks, { preserveCurrent: false });
  return true;
}

async function loadTrack(index, autoplay = true) {
  const track = state.tracks[index];
  if (!track) {
    return;
  }

  state.currentTrackIndex = index;
  audio.src = streamUrlForTrack(track);
  audio.playbackRate = state.playbackRate;
  renderTrackList();
  updateNowPlaying();

  if (autoplay) {
    try {
      await audio.play();
    } catch {
      console.warn("播放失败，请确认浏览器自动播放策略。");
    }
  }

  updatePlayPauseLabel();
}

async function fetchTracks({ forceRefresh = false } = {}) {
  if (state.isScanning) {
    return;
  }

  state.isScanning = true;
  setRefreshButtonState("loading");

  try {
    const response = await fetch("/api/tracks", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || `读取歌曲失败：HTTP ${response.status}`);
    }

    const tracks = normalizeTracks(payload.tracks);
    saveTrackCache(tracks);
    applyTrackList(tracks, { preserveCurrent: forceRefresh });
    setRefreshButtonState("success");
  } catch (error) {
    console.error(error);
    setRefreshButtonState("error");
  } finally {
    state.isScanning = false;
  }
}

refreshButton.addEventListener("click", async () => {
  await fetchTracks({ forceRefresh: true });
});

searchButton?.addEventListener("click", () => {
  const expanded = searchButton.getAttribute("aria-expanded") === "true";
  setSearchOpen(!expanded);
});

searchInput?.addEventListener("input", () => {
  state.searchQuery = searchInput.value.trim();
  renderTrackList();
});

searchInput?.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setSearchOpen(false);
  }
});

trackListEl.addEventListener("click", async (event) => {
  const item = event.target.closest(".track-item");
  if (!item) {
    return;
  }

  const index = Number(item.dataset.index);
  if (Number.isNaN(index)) {
    return;
  }

  await loadTrack(index, true);
});

playPauseButton.addEventListener("click", async () => {
  if (!state.tracks.length) {
    await fetchTracks({ forceRefresh: false });
    if (!state.tracks.length) {
      return;
    }
  }

  if (!audio.src || state.currentTrackIndex < 0) {
    await loadTrack(0, true);
    return;
  }

  if (audio.paused) {
    try {
      await audio.play();
    } catch {
      console.warn("播放失败，请确认浏览器自动播放策略。");
    }
  } else {
    audio.pause();
  }

  updatePlayPauseLabel();
});

backToStartButton.addEventListener("click", () => {
  if (!audio.src) {
    return;
  }

  audio.currentTime = 0;
});

backwardButton.addEventListener("click", () => {
  if (!audio.src) {
    return;
  }

  audio.currentTime = Math.max(0, audio.currentTime - 5);
});

forwardButton.addEventListener("click", () => {
  if (!audio.src) {
    return;
  }

  if (Number.isFinite(audio.duration)) {
    audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
  } else {
    audio.currentTime += 5;
  }
});

presetSpeedsEl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-percent]");
  if (!button) {
    return;
  }

  const percent = Number(button.dataset.percent);
  if (!Number.isFinite(percent)) {
    return;
  }

  applyPlaybackRate(percent / 100);
});

speedSlider.addEventListener("input", () => {
  const percent = Number(speedSlider.value);
  if (!Number.isFinite(percent)) {
    return;
  }

  applyPlaybackRate(percent / 100);
});

audio.addEventListener("loadedmetadata", updateTimeDisplay);
audio.addEventListener("timeupdate", updateTimeDisplay);
audio.addEventListener("play", updatePlayPauseLabel);
audio.addEventListener("pause", updatePlayPauseLabel);
audio.addEventListener("ended", updatePlayPauseLabel);
audio.addEventListener("error", () => {
  console.error("音频加载失败，请检查后端配置与 WebDAV 可读性。");
});

setRefreshButtonState("idle");
applyPlaybackRate(1);
renderTrackList();
updateNowPlaying();
updateTimeDisplay();
updatePlayPauseLabel();

if (!restoreTrackListFromCache()) {
  fetchTracks({ forceRefresh: false });
}
