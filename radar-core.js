// Pure data helpers shared by the interface and the regression tests.
export const DAY = 86400000;
export const SCHOOLS = {
  HKU: "香港大學", CUHK: "香港中文大學", HKUST: "香港科技大學",
  PolyU: "香港理工大學", CityU: "香港城市大學", HKBU: "香港浸會大學",
  LingU: "嶺南大學", EdUHK: "香港教育大學", HKMU: "香港都會大學",
  HKDI: "香港知專設計學院", HKAPA: "香港演藝學院"
};
export const CATEGORIES = [
  { id: "all", label: "全部", words: [] },
  { id: "design", label: "設計", words: ["設計", "design", "資訊圖表", "信息圖", "廣告"] },
  { id: "art", label: "藝術", words: ["藝術", "繪畫", "填色", "插畫", "手工", "手作", "art", "drawing"] },
  { id: "photo", label: "攝影", words: ["攝影", "photography", "photo", "小誌"] },
  { id: "film", label: "影像", words: ["短片", "影片", "電影", "影像", "動畫", "film", "video", "reels"] },
  { id: "digital", label: "數碼 / AI", words: ["數碼", "電繪", "人工智能", "生成式", "ai", "digital", "應用程式"] }
];
export const STATUSES = {
  interested: "想參加",
  preparing: "準備中",
  submitted: "已報名"
};
export const PROFILE_LABELS = {
  all: "全部對象", tertiary: "大專生", secondary: "中學生", primary: "小學生",
  ...Object.fromEntries(Object.keys(SCHOOLS).map(code => [code, code]))
};

export function parseCSV(source) {
  const text = String(source).replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (quoted) throw new Error("CSV 引號未完成");
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(cells => cells.some(value => value.trim()));
}

function records(text, required) {
  const rows = parseCSV(text);
  if (!rows.length) throw new Error("資料檔案係空白");
  const columns = rows[0].map(value => value.trim());
  if (required.some(key => !columns.includes(key))) throw new Error("資料欄位未齊");
  return rows.slice(1).map(row => Object.fromEntries(columns.map((key, i) => [key, (row[i] || "").trim()])));
}
const FIELDS = {
  name: "比賽名稱", org: "主辦", deadline: "截止日期", time: "截止時間",
  p1: "冠軍", p2: "亞軍", p3: "季軍", merit: "優異獎", total: "獎品總值",
  kind: "價值類型", prizeType: "獎品類別", target: "對象", fee: "標籤",
  eligibility: "適用對象", apply: "報名連結", url: "網址", school: "學校", region: "地區"
};
export function stableId(record) {
  const text = [record.name, record.org, record.apply].join("|").normalize("NFKC");
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  return "call-" + (hash >>> 0).toString(36);
}
export function toCompetitions(text) {
  const seen = new Set();
  return records(text, ["比賽名稱", "截止日期", "報名連結"]).flatMap(row => {
    const record = Object.fromEntries(Object.entries(FIELDS).map(([key, column]) => [key, row[column] || ""]));
    record.apply = safeUrl(record.apply);
    record.url = safeUrl(record.url);
    if (!record.name || !record.apply || !Number.isFinite(deadlineMs(record))) return [];
    record.id = stableId(record);
    if (seen.has(record.id)) return [];
    seen.add(record.id);
    return [record];
  });
}
export function toSites(text) {
  return records(text, ["名稱", "網址"]).map(row => ({
    name: row["名稱"], url: safeUrl(row["網址"]), description: row["介紹"] || "",
    tags: (row["標籤"] || "").split(/[;；、/|]/).filter(Boolean),
    school: row["學校"] || ""
  })).filter(record => record.name && record.url);
}
export function safeUrl(value) {
  const input = String(value || "").trim();
  if (!input || /[\u0000-\u001f\s]/.test(input)) return "";
  try {
    const url = new URL(input);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}
export function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}
export function deadlineMs(record) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(record.deadline || "");
  if (!match) return NaN;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return NaN;
  if (!record.time) return date.getTime() + DAY - 8 * 3600000 - 1;
  const time = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(record.time);
  if (!time) return NaN;
  return date.getTime() + (Number(time[1]) - 8) * 3600000 + Number(time[2]) * 60000;
}
function hkDay(ms) { return Math.floor((ms + 8 * 3600000) / DAY); }
export function deadlineInfo(record, now = Date.now()) {
  const end = deadlineMs(record);
  if (!Number.isFinite(end)) return { state: "unknown", days: Infinity, label: "截止待確認", end };
  const days = hkDay(end) - hkDay(now);
  if (now > end) return { state: "closed", days, label: "已截止", end };
  const label = days === 0 ? "今日截止" : days === 1 ? "聽日截止" : days + " 日後";
  return { state: days <= 7 ? "soon" : "open", days, label, end };
}
export function inCategory(record, category) {
  const entry = CATEGORIES.find(item => item.id === category);
  if (!entry || entry.id === "all") return true;
  const text = [record.name, record.org, record.eligibility, record.prizeType].join(" ").toLowerCase();
  return entry.words.some(word => word === "ai" ? /\bai\b/i.test(text) : text.includes(word));
}
function schoolCodes(text) {
  const tokens = String(text || "").split(/[;；、,\s]+/);
  return Object.keys(SCHOOLS).filter(code => tokens.some(token =>
    token.toLowerCase() === code.toLowerCase() || token === SCHOOLS[code]));
}
export function profileMatch(record, profile = "all") {
  if (profile === "all") return { include: true, rank: 3, reason: record.target || "資格見詳情" };
  const selectedSchool = SCHOOLS[profile] ? profile : "";
  const level = selectedSchool ? "tertiary" : profile;
  const restricted = [...new Set([...schoolCodes(record.school), ...schoolCodes(record.target)])];
  if (restricted.length) {
    if (level !== "tertiary" || (selectedSchool && !restricted.includes(selectedSchool)))
      return { include: false, rank: 9, reason: "限 " + restricted.join(" / ") };
    return { include: true, rank: selectedSchool ? 0 : 2, reason: "限 " + restricted.join(" / ") };
  }
  const target = record.target;
  if (target === "小學生" && level !== "primary") return { include: false, rank: 9, reason: "限小學生" };
  if (target === "中學生" && level !== "secondary") return { include: false, rank: 9, reason: "限中學生" };
  if (target === "大學、大專生" && level !== "tertiary") return { include: false, rank: 9, reason: "限大專生" };
  const details = record.eligibility || "";
  const tertiary = /大專|大學|本科|研究生|專上/.test(details);
  const secondary = /中學|初中|高中|中[一二三四五六]/.test(details);
  const primary = /小學|初小|高小|小[一二三四五六]/.test(details);
  const openGroup = /公開組|不限年齡|年齡不限|16歲或以上|18歲或以上/.test(details);
  const schoolGroups = /組|學生|小一|中一/.test(details) && (primary || secondary || tertiary);
  if (schoolGroups && !openGroup) {
    if (level === "tertiary" && !tertiary && (primary || secondary))
      return { include: false, rank: 9, reason: "限中小學組別" };
    if (level === "secondary" && !secondary && (primary || tertiary))
      return { include: false, rank: 9, reason: "未列中學組別" };
    if (level === "primary" && !primary && (secondary || tertiary))
      return { include: false, rank: 9, reason: "未列小學組別" };
  }
  return {
    include: true,
    rank: target === "公開" ? 3 : 1,
    reason: target === "公開" ? "公開組 · 留意附加條件" : "學段相關 · 資格見詳情"
  };
}

const GROUPS = [
  ["攝影", "摄影", "photography", "photo", "photos"],
  ["設計", "设计", "design"],
  ["藝術", "艺术", "art", "arts", "繪畫", "drawing", "painting"],
  ["影像", "短片", "電影", "film", "video", "reels"],
  ["動畫", "动画", "animation"],
  ["數碼", "数码", "digital", "電繪"],
  ["人工智能", "生成式", "ai"],
  ["學生", "学生", "student", "students"],
  ["插畫", "插画", "illustration"],
  ["徵集", "徵稿", "open call", "展覽", "exhibition"]
];
const SCHOOL_ALIASES = {
  HKU: ["hku", "港大", "香港大學"], CUHK: ["cuhk", "中大", "香港中文大學"],
  HKUST: ["hkust", "科大"], PolyU: ["polyu", "理大"], CityU: ["cityu", "城大"],
  HKBU: ["hkbu", "浸大", "香港浸會大學"], LingU: ["lingu", "嶺大"],
  EdUHK: ["eduhk", "教大"], HKMU: ["hkmu", "都大"], HKDI: ["hkdi", "知專"], HKAPA: ["hkapa", "演藝"]
};
export function analyseQuery(query = "") {
  let text = String(query).normalize("NFKC").toLowerCase().trim();
  let profile = "";
  const aliases = Object.entries(SCHOOL_ALIASES).flatMap(([code, list]) => list.map(word => [code, word]));
  aliases.push(["tertiary", "大專生"], ["tertiary", "大學生"], ["tertiary", "tertiary"],
    ["tertiary", "university"], ["secondary", "中學生"], ["primary", "小學生"]);
  for (const [code, word] of aliases.sort((a, b) => b[1].length - a[1].length)) {
    const pattern = /^[a-z]+$/.test(word) ? new RegExp("\\b" + word + "\\b", "i") : new RegExp(word, "i");
    if (pattern.test(text)) { profile = code; text = text.replace(pattern, " "); break; }
  }
  const free = /免費|免费|\bfree\b/.test(text);
  text = text.replace(/免費|免费|\bfree\b/g, " ");
  const days = /本週|本周|7日內|7日内|\bthis week\b/.test(text) ? 7 : 0;
  text = text.replace(/本週|本周|7日內|7日内|\bthis week\b/g, " ");
  text = text.replace(/比賽|比赛|\bcompetitions?\b|\bcontests?\b/g, " ");
  // Split known Chinese compounds without breaking English phrases.
  const words = GROUPS.flat().filter(word => /[\u3400-\u9fff]/.test(word)).sort((a, b) => b.length - a.length);
  const matcher = new RegExp("(" + [...new Set(words)].join("|") + ")", "g");
  text = text.replace(matcher, " $1 ").replace(/\bopen\s+call\b/g, "opencall");
  const terms = text.split(/\s+/).filter(Boolean).map(term => term === "opencall" ? "open call" : term);
  return { profile, free, days, terms };
}
export function queryScore(record, query) {
  const analysis = typeof query === "string" ? analyseQuery(query) : query;
  const title = (record.name || "").toLowerCase();
  const haystack = [record.name, record.org, record.target, record.eligibility, record.prizeType,
    record.region, record.description, ...(record.tags || [])].join(" ").toLowerCase();
  let score = 0;
  for (const term of analysis.terms) {
    const choices = GROUPS.find(group => group.includes(term)) || [term];
    if (choices.some(word => containsTerm(haystack, word))) {
      score += choices.some(word => containsTerm(title, word)) ? 3 : 1;
    } else if (!fuzzyMatch(haystack, term)) return -1;
  }
  return score;
}
function containsTerm(text, word) {
  return /^[a-z0-9 ]+$/i.test(word)
    ? new RegExp("\\b" + word.replace(/[.*+?^$()|[\]\\]/g, "\\$&") + "\\b", "i").test(text)
    : text.includes(word);
}
function fuzzyMatch(text, term) {
  if (!/^[a-z]{5,}$/i.test(term)) return false;
  const limit = term.length >= 9 ? 2 : 1;
  return (text.match(/[a-z]{4,}/g) || []).some(word => {
    if (word[0] !== term[0] || Math.abs(word.length - term.length) > limit) return false;
    const distance = Array.from({ length: term.length + 1 }, (_, i) => [i]);
    for (let j = 0; j <= word.length; j++) distance[0][j] = j;
    for (let i = 1; i <= term.length; i++) for (let j = 1; j <= word.length; j++) {
      distance[i][j] = Math.min(distance[i - 1][j] + 1, distance[i][j - 1] + 1,
        distance[i - 1][j - 1] + (term[i - 1] === word[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && term[i - 1] === word[j - 2] && term[i - 2] === word[j - 1])
        distance[i][j] = Math.min(distance[i][j], distance[i - 2][j - 2] + 1);
    }
    return distance[term.length][word.length] <= limit;
  });
}
export function filterCompetitions(records, filters = {}, now = Date.now()) {
  const query = analyseQuery(filters.q);
  const profile = query.profile || filters.profile || "all";
  const days = query.days || Number(filters.days) || 0;
  const result = records.filter(record => {
    const deadline = deadlineInfo(record, now);
    return deadline.state !== "closed" && deadline.state !== "unknown"
      && profileMatch(record, profile).include
      && (!(filters.free || query.free) || record.fee === "免費")
      && (!days || deadline.days <= days)
      && inCategory(record, filters.category)
      && queryScore(record, query) >= 0;
  });
  return result.sort((a, b) => {
    if (filters.sort === "relevance") {
      const difference = queryScore(b, query) - queryScore(a, query)
        || profileMatch(a, profile).rank - profileMatch(b, profile).rank;
      if (difference) return difference;
    }
    return (filters.sort === "later" ? -1 : 1) * (deadlineMs(a) - deadlineMs(b))
      || a.name.localeCompare(b.name, "zh-HK");
  });
}
export function prizeSummary(record) {
  const amount = Number(record.total.replace(/[,\s]/g, ""));
  const prefix = { "現金": "獎金 ", "估計": "獎金約 ", "至少": "獎金至少 ", "獎金池": "總獎金 " }[record.kind];
  return amount > 0 && prefix
    ? prefix + "HK$" + amount.toLocaleString("en-US") + (record.kind === "獎金池" ? "（獎金池）" : "")
    : record.prizeType || "獎項詳情見官網";
}
export function normaliseSaved(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([id, item]) => {
    if (!/^call-[a-z0-9]+$/.test(id) || !item || !item.record || typeof item.record !== "object") return [];
    const record = Object.fromEntries(Object.keys(FIELDS).map(key =>
      [key, typeof item.record[key] === "string" ? item.record[key].slice(0, 10000) : ""]));
    record.apply = safeUrl(record.apply); record.url = safeUrl(record.url); record.id = id;
    if (!record.name || !record.apply || !Number.isFinite(deadlineMs(record)) || stableId(record) !== id) return [];
    return [[id, {
      record, status: Object.hasOwn(STATUSES, item.status) ? item.status : "interested",
      note: typeof item.note === "string" ? item.note.slice(0, 1000) : "",
      savedAt: typeof item.savedAt === "string" ? item.savedAt : ""
    }]];
  }));
}
function icsEscape(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}
function utcStamp(ms) { return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }
function foldLine(line) {
  const result = [];
  let part = "", bytes = 0;
  for (const char of line) {
    const length = new TextEncoder().encode(char).length;
    if (bytes + length > 75) { result.push(part); part = " "; bytes = 1; }
    part += char; bytes += length;
  }
  result.push(part);
  return result.join("\r\n");
}
export function buildCalendar(records, now = Date.now()) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Open Call Radar//HK//ZH", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  const unique = [...new Map(records.map(record => [record.id || stableId(record), record])).values()];
  for (const record of unique) {
    const deadline = deadlineInfo(record, now);
    if (deadline.state === "closed" || deadline.state === "unknown") continue;
    lines.push("BEGIN:VEVENT", "UID:" + (record.id || stableId(record)) + "@open-call-radar",
      "DTSTAMP:" + utcStamp(now));
    if (record.time) {
      lines.push("DTSTART:" + utcStamp(deadline.end), "DTEND:" + utcStamp(deadline.end + 15 * 60000));
    } else {
      const date = record.deadline.replace(/-/g, "");
      const following = new Date(Date.parse(record.deadline + "T00:00:00Z") + DAY).toISOString().slice(0, 10).replace(/-/g, "");
      lines.push("DTSTART;VALUE=DATE:" + date, "DTEND;VALUE=DATE:" + following);
    }
    lines.push("SUMMARY:" + icsEscape("截止 · " + record.name),
      "DESCRIPTION:" + icsEscape([record.org, record.eligibility,
        record.time ? "香港時間 " + record.deadline + " " + record.time : "截止日期 " + record.deadline + "；主辦方未列明時間",
        safeUrl(record.apply)].filter(Boolean).join("\n")),
      "URL:" + safeUrl(record.apply), "TRANSP:TRANSPARENT",
      "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", "DESCRIPTION:比賽即將截止", "END:VALARM", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
