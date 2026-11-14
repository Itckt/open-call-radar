import {
  CATEGORIES, STATUSES, PROFILE_LABELS, toCompetitions, toSites, escapeHTML as esc,
  safeUrl, deadlineInfo, deadlineMs, inCategory, profileMatch, analyseQuery, queryScore,
  filterCompetitions, prizeSummary, normaliseSaved, buildCalendar
} from "./radar-core.js";

const $ = id => document.getElementById(id);
const ICONS = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  bookmark: '<path d="M6 4h12v17l-6-4-6 4V4Z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18M8 15h2m4 0h2"/>',
  arrow: '<path d="M6 18 18 6M7 6h11v11"/>',
  share: '<path d="M9 15 15 9"/><path d="m7 17-1 1a4.2 4.2 0 0 1-6-6l5-5a4.2 4.2 0 0 1 6 0m2 10a4.2 4.2 0 0 0 6 0l5-5a4.2 4.2 0 0 0-6-6l-1 1" transform="translate(2 0) scale(.85)"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/>',
  empty: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="m12 12 6-6"/>'
};
const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + "</svg>";
document.querySelector(".search-icon").innerHTML = icon("search");
$("share-search").innerHTML = icon("share");

function readStorage(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function writeStorage(key, value, notify = false) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch {
    if (notify) toast("瀏覽器未能儲存清單。請先下載備份，避免關頁後遺失。");
    return false;
  }
}
const preferences = readStorage("ocr-v2-preferences", {});
const params = new URLSearchParams(location.search);
const validProfile = value => Object.hasOwn(PROFILE_LABELS, value) ? value : "all";
const state = {
  view: params.get("view") === "saved" ? "saved" : "explore",
  q: (params.get("q") || "").slice(0, 160),
  profile: validProfile(params.has("profile") ? params.get("profile") : preferences.profile),
  category: CATEGORIES.some(item => item.id === params.get("category")) ? params.get("category") : "all",
  free: params.get("free") === "1",
  days: ["7", "30", "90"].includes(params.get("days")) ? Number(params.get("days")) : 0,
  sort: ["deadline", "relevance", "later"].includes(params.get("sort")) ? params.get("sort") : "deadline",
  shown: 20
};
let theme = ["light", "dark"].includes(preferences.theme) ? preferences.theme : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
let saved = normaliseSaved(readStorage("ocr-v2-saved", {}));
let recent = readStorage("ocr-recent", []);
if (!Array.isArray(recent)) recent = [];
recent = recent.filter(value => typeof value === "string").slice(0, 6);
let competitions = [], sites = [], loading = true, loadingPromise = null;
let competitionsFailed = false, siteFailed = false, notices = [], activeSuggestion = -1, searchTimer, toastTimer, undoAction;
const openCards = new Set();
$("q").value = state.q;

function rememberPreferences() { writeStorage("ocr-v2-preferences", { profile: state.profile, theme }); }
function renderTheme() {
  document.documentElement.dataset.theme = theme;
  $("theme-toggle").innerHTML = icon(theme === "dark" ? "sun" : "moon");
  const label = theme === "dark" ? "切換淺色模式" : "切換深色模式";
  $("theme-toggle").setAttribute("aria-label", label);
  $("theme-toggle").title = label;
}
renderTheme();

function toast(message, undo) {
  clearTimeout(toastTimer);
  $("toast-text").textContent = message;
  $("toast-undo").hidden = !undo;
  undoAction = undo;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => { $("toast").hidden = true; undoAction = null; }, undo ? 9000 : 5500);
}
$("toast-undo").addEventListener("click", () => {
  const action = undoAction;
  $("toast").hidden = true; undoAction = null;
  if (action) action();
});
function syncURL() {
  const url = new URL(location.href);
  url.search = "";
  if (state.q) url.searchParams.set("q", state.q);
  if (state.profile !== "all") url.searchParams.set("profile", state.profile);
  if (state.category !== "all") url.searchParams.set("category", state.category);
  if (state.free) url.searchParams.set("free", "1");
  if (state.days) url.searchParams.set("days", String(state.days));
  if (state.sort !== "deadline") url.searchParams.set("sort", state.sort);
  if (state.view === "saved") url.searchParams.set("view", "saved");
  try { history.replaceState(null, "", url); } catch { /* Some browsers restrict file-origin history in the standalone preview. */ }
}
function changeFilters(change) {
  Object.assign(state, change, { shown: 20 });
  closeSuggestions(); render(); syncURL();
}
function resetFilters() {
  $("q").value = "";
  changeFilters({ q: "", profile: "all", category: "all", free: false, days: 0, sort: "deadline" });
  rememberPreferences();
}
function saveChanges() { return writeStorage("ocr-v2-saved", saved, true); }
function findRecord(id) { return competitions.find(record => record.id === id) || saved[id]?.record; }

function renderControls() {
  const isSaved = state.view === "saved";
  document.querySelectorAll("[data-view]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.view === state.view)));
  $("saved-count").textContent = Object.keys(saved).length;
  $("page-title").innerHTML = isSaved ? '留低機會，慢慢做好<span class="pink-dot">。</span>' : '搵你嘅下一個機會<span class="pink-dot">。</span>';
  $("intro-caption").innerHTML = isSaved ? '由靈感，到交件。<br><span>每一步，都記低。</span>' : '比賽 · 徵件 · 展覽<br><span>留返時間，俾創作。</span>';
  $("filters").hidden = isSaved;
  $("saved-tools").hidden = !isSaved;
  $("share-search").hidden = isSaved || location.protocol === "file:";
  $("profile").value = state.profile;
  $("days").value = state.days;
  $("sort").value = state.sort;
  $("free-filter").setAttribute("aria-pressed", String(state.free));
  $("clear-search").hidden = !state.q;
  $("reset-filters").hidden = !(state.q || state.profile !== "all" || state.free || state.days || state.category !== "all");
  $("categories").innerHTML = CATEGORIES.map(category =>
    '<button type="button" id="category-' + category.id + '" data-category="' + category.id + '" aria-pressed="' + (state.category === category.id) + '">' + category.label + "</button>").join("");
  const analysis = analyseQuery(state.q);
  const scope = analysis.profile || state.profile;
  const inferred = [analysis.profile ? PROFILE_LABELS[analysis.profile] : "", analysis.free ? "免費" : "", analysis.days ? "7 日內截止" : ""].filter(Boolean);
  $("scope-note").textContent = (inferred.length ? "搜尋已套用：" + inferred.join(" · ") + "。 " : "")
    + (scope !== "all" ? "按學校／學段初篩；年齡、地區等附加限制請睇參賽詳情。" : "");
  $("scope-note").hidden = isSaved || (!inferred.length && scope === "all");
  $("export-calendar").disabled = !Object.keys(saved).some(id => {
    const record = competitions.find(item => item.id === id);
    return record && deadlineInfo(record).state !== "closed";
  });
  $("export-backup").disabled = !Object.keys(saved).length;
}
function cardHTML(record, isSavedView = false) {
  const entry = saved[record.id];
  const deadline = deadlineInfo(record);
  const archived = isSavedView && !competitions.some(item => item.id === record.id);
  const canApply = !archived && deadline.state !== "closed" && deadline.state !== "unknown" && safeUrl(record.apply);
  const targets = record.target ? [record.target] : [];
  const fullDate = record.deadline + (record.time ? " · " + record.time + " HKT" : " · 未列明時間");
  const facts = [
    ["截止", fullDate], ["資格", record.eligibility || record.target || "見主辦方詳情"],
    ["地區", record.region], ["費用", record.fee || "未列明"],
    ["冠軍", record.p1], ["亞軍", record.p2], ["季軍", record.p3], ["優異獎", record.merit]
  ].filter(([, value]) => value);
  const source = safeUrl(record.url);
  const label = entry ? "取消收藏 " : "收藏 ";
  return '<article class="comp-card" id="' + record.id + '">' +
    '<div class="card-top"><span class="deadline-label ' + deadline.state + '" title="' + esc(fullDate) + '">' + esc(deadline.label) + '</span>' +
    '<button type="button" class="icon-button save-button" id="save-' + record.id + '" data-save="' + record.id + '" aria-pressed="' + !!entry + '" aria-label="' + esc(label + record.name) + '" title="' + label.trim() + '">' + icon("bookmark") + "</button></div>" +
    "<h3>" + esc(record.name) + '</h3><p class="organiser">' + esc(record.org) + '</p><p class="prize-summary">' + esc(prizeSummary(record)) + "</p>" +
    '<div class="badges">' + (record.fee ? '<span class="badge ' + (record.fee === "免費" ? "free" : "") + '">' + esc(record.fee) + "</span>" : '<span class="badge">費用未列明</span>') +
    targets.map(target => '<span class="badge audience">' + esc(target) + "</span>").join("") +
    (record.region ? '<span class="badge">' + esc(record.region) + "</span>" : "") +
    (archived ? '<span class="badge archived">已移出最新清單</span>' : "") + "</div>" +
    (record.eligibility ? '<p class="eligibility-preview">' + esc(record.eligibility) + "</p>" : "") +
    '<details class="card-details" data-detail="' + record.id + '"' + (openCards.has(record.id) ? " open" : "") + '><summary>參賽詳情<span class="chevron" aria-hidden="true"></span></summary><dl class="detail-list">' +
    facts.map(([label, value]) => "<dt>" + esc(label) + "</dt><dd>" + esc(value) + "</dd>").join("") +
    (source ? '<dt>來源</dt><dd><a href="' + esc(source) + '" target="_blank" rel="noopener noreferrer">主辦方比賽頁 ↗</a></dd>' : "") + "</dl></details>" +
    '<div class="card-actions">' +
    (canApply ? '<a class="apply-link" href="' + esc(record.apply) + '" target="_blank" rel="noopener noreferrer" aria-label="' + esc("前往報名：" + record.name) + '">前往報名' + icon("arrow") + "</a>" :
      '<span class="apply-link disabled">' + (archived ? "請到官網查看最新安排" : "報名已結束") + "</span>") +
    (canApply ? '<button type="button" class="calendar-button" data-calendar="' + record.id + '" aria-label="' + esc("下載截止日曆：" + record.name) + '">' + icon("calendar") + "加到日曆</button>" : "") + "</div>" +
    (isSavedView && entry ? '<div class="saved-editor"><label for="status-' + record.id + '">進度<select id="status-' + record.id + '" data-status-id="' + record.id + '" aria-label="' + esc(record.name + " 報名進度") + '">' +
      Object.entries(STATUSES).map(([value, text]) => '<option value="' + value + '"' + (entry.status === value ? " selected" : "") + ">" + text + "</option>").join("") +
      '</select></label><textarea id="note-' + record.id + '" data-note="' + record.id + '" maxlength="1000" aria-label="' + esc(record.name + " 私人筆記") + '" placeholder="記低構思、隊友、要準備嘅嘢…">' + esc(entry.note) + "</textarea></div>" : "") +
    "</article>";
}
function emptyHTML(title, body, action, button) {
  return '<div class="empty-state"><span class="empty-icon">' + icon("empty") + "</span><h3>" + title + "</h3><p>" + body + "</p>" +
    (action ? '<button type="button" class="primary-button" data-empty-action="' + action + '">' + button + "</button>" : "") + "</div>";
}
function renderSources() {
  const query = analyseQuery(state.q);
  if (state.view === "saved" || !query.terms.length || !sites.length) { $("sources-section").hidden = true; return; }
  const profile = query.profile || state.profile;
  const matches = sites.filter(site => queryScore(site, query) >= 0 && profileMatch({
    target: site.school, school: site.school, eligibility: ""
  }, profile).include).sort((a, b) => queryScore(b, query) - queryScore(a, query));
  $("sources-section").hidden = !matches.length;
  $("source-count").textContent = matches.length;
  $("sources").innerHTML = matches.slice(0, 30).map(site =>
    '<article><a class="source-link" href="' + esc(site.url) + '" target="_blank" rel="noopener noreferrer">' + esc(site.name) +
    ' ↗</a><p class="source-description">' + esc(site.description) + '</p><span class="source-domain">' + esc(new URL(site.url).hostname) + "</span></article>").join("");
}
function renderNotice() {
  $("data-notice").hidden = !notices.length;
  $("data-notice").innerHTML = notices.length ? "<span>" + notices.map(esc).join("；") + '</span><button type="button" class="text-button" id="retry-data">重新載入</button>' : "";
}
function render() {
  const focusId = document.activeElement?.id;
  renderControls(); renderNotice();
  if (loading) return;
  $("competitions").setAttribute("aria-busy", "false");
  const isSaved = state.view === "saved";
  let count = 0;
  if (isSaved) {
    const query = analyseQuery(state.q);
    const entries = Object.entries(saved).map(([id, entry]) => ({ ...entry, record: findRecord(id) }))
      .filter(entry => inCategory(entry.record, state.category) && queryScore(entry.record, query) >= 0
        && (!query.profile || profileMatch(entry.record, query.profile).include)
        && (!query.free || entry.record.fee === "免費")
        && (!query.days || ["open", "soon"].includes(deadlineInfo(entry.record).state) && deadlineInfo(entry.record).days <= query.days))
      .sort((a, b) => (state.sort === "later" ? -1 : 1) * (deadlineMs(a.record) - deadlineMs(b.record)));
    count = entries.length;
    $("results-heading").textContent = "我的清單";
    $("result-count").textContent = count + " 個";
    $("competitions").innerHTML = count
      ? Object.entries(STATUSES).map(([key, label]) => {
        const group = entries.filter(entry => entry.status === key);
        return group.length ? '<h3 class="status-heading" data-status="' + key + '">' + label + " <span>" + group.length + "</span></h3>" + group.map(entry => cardHTML(entry.record, true)).join("") : "";
      }).join("")
      : Object.keys(saved).length
        ? emptyHTML("呢個搜尋暫時冇收藏", "清除關鍵字或類別，就可以睇返成份清單。", "reset", "顯示全部收藏")
        : emptyHTML("留低一個值得出手嘅機會", "喺比賽卡撳收藏，就可以喺呢度記低進度同構思。", "explore", "去搵機會");
    $("more").hidden = true;
  } else {
    const matches = filterCompetitions(competitions, state);
    count = matches.length;
    $("results-heading").textContent = state.q || state.category !== "all" || state.profile !== "all" || state.free || state.days ? "篩選結果" : "正在開放";
    $("result-count").textContent = count + " 個機會";
    $("competitions").innerHTML = count ? matches.slice(0, state.shown).map(record => cardHTML(record)).join("")
      : competitionsFailed
        ? emptyHTML("比賽資料暫時載入唔到", "你嘅收藏仍然保留。可以重新載入，或者先睇自己的清單。", "retry", "再試一次")
        : emptyHTML("暫時未搵到啱嘅機會", "試吓放寬截止日期、轉一個類別，或者清除篩選。", "reset", "重設搜尋");
    $("more").hidden = matches.length <= state.shown;
    $("more").textContent = "再睇 " + Math.min(20, Math.max(0, matches.length - state.shown)) + " 個機會";
  }
  $("result-announcement").textContent = (isSaved ? "收藏" : "搜尋結果") + "：" + count + " 個";
  renderSources();
  if (focusId && document.activeElement?.id !== focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
}
async function readDataFile(file, parser) {
  const key = "ocr-v2-cache:" + file;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(file, { cache: "no-cache", signal: controller.signal });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const text = await response.text();
    const records = parser(text);
    writeStorage(key, { text, at: new Date().toISOString() });
    return { records, cached: false };
  } catch (error) {
    const cache = readStorage(key, null);
    if (cache && typeof cache.text === "string") {
      try { return { records: parser(cache.text), cached: true, at: cache.at }; } catch { /* Invalid cache must not hide a load failure. */ }
    }
    throw error;
  } finally { clearTimeout(timeout); }
}
async function loadData() {
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    const results = await Promise.allSettled([readDataFile("./competitions.csv", toCompetitions), readDataFile("./sites.csv", toSites)]);
    notices = [];
    competitionsFailed = results[0].status === "rejected";
    siteFailed = results[1].status === "rejected";
    if (!competitionsFailed) competitions = results[0].value.records;
    if (!siteFailed) sites = results[1].value.records;
    results.forEach((result, i) => {
      const label = i ? "主辦網站" : "比賽";
      if (result.status === "rejected") notices.push(label + "資料載入失敗");
      else if (result.value.cached) {
        const date = new Date(result.value.at);
        const timestamp = Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-HK", { timeZone: "Asia/Hong_Kong", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date) : "較早前";
        notices.push(label + "正使用 " + timestamp + " 讀取嘅離線資料，請到官網確認有冇更新");
      }
    });
    loading = false; render();
  })().finally(() => { loadingPromise = null; });
  return loadingPromise;
}

function rememberQuery() {
  const query = $("q").value.trim();
  if (!query) return;
  recent = [query, ...recent.filter(value => value !== query)].slice(0, 6);
  writeStorage("ocr-recent", recent);
}
function closeSuggestions() {
  $("suggestions").hidden = true;
  $("q").setAttribute("aria-expanded", "false");
  $("q").removeAttribute("aria-activedescendant");
  activeSuggestion = -1;
}
function showSuggestions() {
  const query = $("q").value.trim().toLowerCase();
  const examples = ["HKBU 免費", "攝影比賽", "設計 本週", "短片", "人工智能"];
  const choices = [...new Set([...recent, ...examples])].filter(value => !query || value.toLowerCase().includes(query)).slice(0, 5);
  $("suggestions").innerHTML = choices.map((value, i) => '<div class="suggestion" role="option" aria-selected="false" id="suggestion-' + i + '" data-query="' + esc(value) + '"><span>' + esc(value) + "</span><small>" + (recent.includes(value) ? "最近搜尋" : "試吓搜尋") + "</small></div>").join("");
  $("suggestions").hidden = !choices.length;
  $("q").setAttribute("aria-expanded", String(!!choices.length));
  $("q").removeAttribute("aria-activedescendant");
  activeSuggestion = -1;
}
function commitSearch(remember = false) {
  clearTimeout(searchTimer);
  state.q = $("q").value.trim(); state.shown = 20;
  if (remember) { rememberQuery(); closeSuggestions(); }
  render(); syncURL();
}
$("q").addEventListener("input", () => {
  clearTimeout(searchTimer);
  $("clear-search").hidden = !$("q").value;
  searchTimer = setTimeout(() => commitSearch(), 160);
  showSuggestions();
});
$("q").addEventListener("focus", showSuggestions);
$("q").addEventListener("blur", closeSuggestions);
$("q").addEventListener("keydown", event => {
  const options = [...$("suggestions").querySelectorAll('[role="option"]')];
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if ($("suggestions").hidden) { showSuggestions(); return; }
    if (!options.length) return;
    activeSuggestion = (activeSuggestion + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options.forEach((option, i) => option.setAttribute("aria-selected", String(i === activeSuggestion)));
    $("q").setAttribute("aria-activedescendant", options[activeSuggestion].id);
  } else if (event.key === "Escape") closeSuggestions();
  else if (event.key === "Enter" && !$("suggestions").hidden && activeSuggestion >= 0) {
    event.preventDefault(); $("q").value = options[activeSuggestion].dataset.query; commitSearch(true);
  }
});
$("search-form").addEventListener("submit", event => { event.preventDefault(); commitSearch(true); });
$("suggestions").addEventListener("mousedown", event => event.preventDefault());
$("suggestions").addEventListener("click", event => {
  const option = event.target.closest("[data-query]");
  if (option) { $("q").value = option.dataset.query; commitSearch(true); }
});
$("clear-search").addEventListener("click", () => { $("q").value = ""; commitSearch(); $("q").focus(); });
$("profile").addEventListener("change", event => { changeFilters({ profile: event.target.value }); rememberPreferences(); });
$("days").addEventListener("change", event => changeFilters({ days: Number(event.target.value) }));
$("sort").addEventListener("change", event => changeFilters({ sort: event.target.value }));
$("free-filter").addEventListener("click", () => changeFilters({ free: !state.free }));
$("reset-filters").addEventListener("click", resetFilters);
$("more").addEventListener("click", () => { state.shown += 20; render(); });
$("theme-toggle").addEventListener("click", () => { theme = theme === "dark" ? "light" : "dark"; renderTheme(); rememberPreferences(); });
function changeView(view) {
  clearTimeout(searchTimer);
  $("q").value = "";
  changeFilters({ view, q: "", category: "all" });
}
document.addEventListener("click", event => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) { changeView(viewButton.dataset.view); return; }
  const category = event.target.closest("[data-category]");
  if (category) { changeFilters({ category: category.dataset.category }); return; }
  const saveButton = event.target.closest("[data-save]");
  if (saveButton) {
    const id = saveButton.dataset.save;
    const record = findRecord(id);
    if (!record) return;
    if (saved[id]) {
      const previous = saved[id];
      delete saved[id];
      const persisted = saveChanges();
      render();
      if (persisted) toast("已移出清單", () => { saved[id] = previous; saveChanges(); render(); toast("已復原收藏"); });
    } else {
      saved[id] = { record: { ...record }, status: "interested", note: "", savedAt: new Date().toISOString() };
      const persisted = saveChanges();
      render();
      if (persisted) toast("已加入我的清單");
    }
    return;
  }
  const calendarButton = event.target.closest("[data-calendar]");
  if (calendarButton) {
    const record = findRecord(calendarButton.dataset.calendar);
    if (record) exportCalendar([record]);
    return;
  }
  const action = event.target.closest("[data-empty-action]")?.dataset.emptyAction;
  if (action === "reset") resetFilters();
  if (action === "explore") changeView("explore");
  if (action === "retry" || event.target.closest("#retry-data")) loadData();
});
document.addEventListener("toggle", event => {
  const id = event.target.dataset?.detail;
  if (id) event.target.open ? openCards.add(id) : openCards.delete(id);
}, true);
document.addEventListener("change", event => {
  const id = event.target.dataset.statusId;
  if (id && saved[id] && Object.hasOwn(STATUSES, event.target.value)) {
    saved[id].status = event.target.value;
    const persisted = saveChanges(); render();
    if (persisted) toast("進度已改為「" + STATUSES[saved[id].status] + "」");
  }
});
document.addEventListener("input", event => {
  const id = event.target.dataset.note;
  if (id && saved[id]) { saved[id].note = event.target.value.slice(0, 1000); saveChanges(); }
});
document.addEventListener("keydown", event => {
  const editing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if ((!editing && event.key === "/") || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k")) {
    event.preventDefault(); $("q").focus(); $("q").select();
  }
});
function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.hidden = true;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function exportCalendar(records) {
  const calendar = buildCalendar(records);
  if (!calendar.includes("BEGIN:VEVENT")) { toast("暫時冇未截止嘅機會可以匯出"); return; }
  download(calendar, "open-call-deadlines.ics", "text/calendar;charset=utf-8");
  toast("已下載日曆檔；匯入日曆後會喺截止前一日提醒");
}
$("export-calendar").addEventListener("click", () => exportCalendar(competitions.filter(record => saved[record.id])));
$("export-backup").addEventListener("click", () => {
  download(JSON.stringify({ app: "open-call-radar", version: 1, exportedAt: new Date().toISOString(), saved }, null, 2),
    "open-call-radar-backup.json", "application/json;charset=utf-8");
  toast("已下載收藏、進度同筆記備份");
});
$("import-backup").addEventListener("click", () => $("backup-file").click());
$("backup-file").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error("too large");
    const backup = JSON.parse(await file.text());
    if (backup.app !== "open-call-radar" || backup.version !== 1) throw new Error("format");
    const incoming = normaliseSaved(backup.saved);
    if (!Object.keys(incoming).length) throw new Error("empty");
    const added = Object.keys(incoming).filter(id => !saved[id]).length;
    saved = { ...incoming, ...saved }; // Existing notes and progress win when a backup overlaps.
    const persisted = saveChanges(); render();
    if (persisted) toast("已匯入 " + added + " 個收藏；現有筆記保持不變");
  } catch { toast("讀取唔到呢份備份，請選擇雷達匯出嘅 JSON 檔"); }
  event.target.value = "";
});
$("share-search").addEventListener("click", async () => {
  syncURL();
  // Include the explicit profile so another browser's saved preference cannot change this search.
  const url = new URL(location.href); url.searchParams.set("profile", state.profile);
  try { await navigator.clipboard.writeText(url.href); toast("搜尋連結已複製"); }
  catch { $("share-url").value = url.href; $("share-dialog").showModal(); $("share-url").select(); }
});
$("share-dialog").addEventListener("click", event => { if (event.target === $("share-dialog")) $("share-dialog").close(); });
window.addEventListener("storage", event => {
  if (event.key === "ocr-v2-saved") { saved = normaliseSaved(readStorage("ocr-v2-saved", {})); render(); }
});
document.addEventListener("visibilitychange", () => { if (!document.hidden && !loading) render(); });
setInterval(() => {
  if (!document.hidden && !loading && document.activeElement?.tagName !== "TEXTAREA") render();
}, 60000);
renderControls();
loadData();
