import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  parseCSV, toCompetitions, toSites, safeUrl, escapeHTML, deadlineMs, deadlineInfo,
  profileMatch, analyseQuery, queryScore, filterCompetitions, inCategory,
  stableId, normaliseSaved, buildCalendar, prizeSummary
} from "../radar-core.js";

const NOW = Date.parse("2026-11-14T01:00:00Z");
const base = {
  name: "香港攝影比賽", org: "創作機構", deadline: "2026-11-20", time: "18:00",
  p1: "US$1,000", p2: "", p3: "", merit: "", total: "", kind: "", prizeType: "相機、證書",
  target: "公開", fee: "免費", eligibility: "設公開組，18歲或以上", school: "", region: "香港",
  apply: "https://example.org/apply", url: "https://example.org/details"
};
const record = patch => { const item = { ...base, ...patch }; return { ...item, id: stableId(item) }; };
const unfold = value => value.replace(/\r\n[ \t]/g, "");

test("CSV: BOM, commas, escaped quotes, CRLF and quoted multiline values", () => {
  assert.deepEqual(parseCSV('\uFEFFname,value\r\n"hello,world","a ""quote""\nnext"\r\n'), [["name","value"], ["hello,world",'a "quote"\nnext']]);
  assert.throws(() => parseCSV('name,value\n"unfinished,abc'), /引號/);
});
test("CSV: no-data and missing-column failures are explicit", () => {
  assert.throws(() => toCompetitions(""), /空白/);
  assert.throws(() => toCompetitions("名稱,日期\n作品,2026-11-20"), /欄位/);
});
test("URLs reject script, data, credentials and control characters", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,hi", "https://a:b@example.org", "https://example.org/\nabc", "//example.org"]) assert.equal(safeUrl(url), "");
  assert.equal(safeUrl("https://example.org/?a=1&b=2"), "https://example.org/?a=1&b=2");
  assert.equal(escapeHTML('"><img src=x onerror=alert(1)>'), "&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
});
test("Exact deadlines convert Hong Kong time independently of device timezone", () => {
  assert.equal(deadlineMs(record({ deadline: "2026-11-14", time: "18:30" })), Date.parse("2026-11-14T10:30:00Z"));
});
test("Date-only deadline remains open through the last Hong Kong millisecond", () => {
  const item = record({ deadline: "2026-11-14", time: "" });
  assert.equal(deadlineInfo(item, Date.parse("2026-11-14T15:59:59.999Z")).state, "soon");
  assert.equal(deadlineInfo(item, Date.parse("2026-11-14T16:00:00Z")).state, "closed");
});
test("Countdown changes on the Hong Kong date boundary", () => {
  const item = record({ deadline: "2026-11-15", time: "" });
  assert.equal(deadlineInfo(item, Date.parse("2026-11-14T15:59:00Z")).label, "聽日截止");
  assert.equal(deadlineInfo(item, Date.parse("2026-11-14T16:00:00Z")).label, "今日截止");
});
test("Invalid dates and invalid times never roll into a different date", () => {
  for (const patch of [{ deadline: "2026-02-29" }, { deadline: "2026-13-01" }, { time: "24:00" }, { time: "12:60" }]) assert.ok(Number.isNaN(deadlineMs(record(patch))));
  assert.ok(Number.isFinite(deadlineMs(record({ deadline: "2028-02-29" }))));
});
test("School filtering distinguishes HKU and HKUST and accepts multi-school entries", () => {
  assert.equal(profileMatch(record({ target: "HKU" }), "HKUST").include, false);
  assert.equal(profileMatch(record({ target: "HKU;HKBU" }), "HKBU").include, true);
  assert.equal(profileMatch(record({ target: "公開", school: "PolyU" }), "HKBU").include, false);
});
test("General tertiary filter retains school-specific opportunities with a restriction label", () => {
  const result = profileMatch(record({ target: "PolyU" }), "tertiary");
  assert.equal(result.include, true);
  assert.equal(result.reason, "限 PolyU");
});
test("Broad student labels do not make primary-only or secondary-only entries tertiary opportunities", () => {
  assert.equal(profileMatch(record({ target: "學生", eligibility: "設初小、高小、初中、高中組；須經學校推薦" }), "HKBU").include, false);
  assert.equal(profileMatch(record({ target: "學生", eligibility: "設初小、高小、初中、高中、大專組" }), "HKBU").include, true);
});
test("Open groups are retained without claiming that every condition is met", () => {
  const result = profileMatch(record({ eligibility: "設小一至二、小三至四、小五至六、中學及公開組；限45歲或以下" }), "HKBU");
  assert.equal(result.include, true);
  assert.match(result.reason, /附加條件/);
});
test("Chinese compound and bilingual searches produce equivalent competition results", () => {
  const item = record();
  assert.ok(queryScore(item, "攝影比賽") >= 0);
  assert.ok(queryScore(item, "photography") >= 0);
  assert.ok(queryScore(item, "摄影") >= 0);
  assert.equal(queryScore(item, "建築"), -1);
});
test("English search tolerates a typo but short terms do not match inside unrelated words", () => {
  assert.ok(queryScore(record({ name: "Photography Award" }), "photograhy") >= 0);
  assert.ok(queryScore(record({ name: "Design Award" }), "desgin") >= 0);
  assert.equal(queryScore(record({ name: "Mail Prize", org: "", eligibility: "" }), "ai"), -1);
});
test("Natural keyword filters recognise school, fee and deadline", () => {
  assert.deepEqual(analyseQuery("HKBU 免費 攝影 本週"), { profile: "HKBU", free: true, days: 7, terms: ["攝影"] });
  assert.equal(analyseQuery("HKUST photography").profile, "HKUST");
  assert.deepEqual(analyseQuery("open call").terms, ["open call"]);
});
test("Combined filtering excludes unknown fees, closed dates and other schools", () => {
  const valid = record();
  const items = [valid, record({ name: "已截止", deadline: "2026-11-13" }), record({ name: "收費", fee: "要報名費" }),
    record({ name: "未列明", fee: "" }), record({ name: "其他學校", school: "HKU" }),
    record({ name: "遲啲", deadline: "2026-12-30" })];
  assert.deepEqual(filterCompetitions(items, { q: "HKBU 免費 本週" }, NOW).map(item => item.id), [valid.id]);
});
test("Deadline ordering uses exact time, not just days remaining", () => {
  const late = record({ name: "Late", time: "18:00" });
  const early = record({ name: "Early", time: "09:00" });
  assert.equal(filterCompetitions([late, early], {}, NOW)[0].name, "Early");
  assert.equal(filterCompetitions([late, early], { sort: "later" }, NOW)[0].name, "Late");
});
test("Category inference handles AI as a word and keeps broad searches independent", () => {
  assert.equal(inCategory(record({ name: "AI-generated artwork" }), "digital"), true);
  assert.equal(inCategory(record({ name: "Mail illustration", org: "", eligibility: "" }), "digital"), false);
});
test("Bookmarks survive deadline corrections because IDs do not contain deadlines", () => {
  assert.equal(record({ deadline: "2026-11-20" }).id, record({ deadline: "2026-11-28" }).id);
});
test("Backup validation rejects malformed records and preserves notes safely", () => {
  const item = record();
  const restored = normaliseSaved({ [item.id]: { record: item, status: "preparing", note: "<script>hello</script>" }, "call-bad": { record: { name: "Bad" } } });
  assert.deepEqual(Object.keys(restored), [item.id]);
  assert.equal(restored[item.id].status, "preparing");
  assert.equal(restored[item.id].note, "<script>hello</script>");
  assert.deepEqual(normaliseSaved([]), {});
  assert.deepEqual(normaliseSaved({ [item.id]: { record: { ...item, apply: "javascript:alert(1)" } } }), {});
});
test("Calendar converts timed events to UTC and includes a one-day alarm", () => {
  const calendar = unfold(buildCalendar([record({ deadline: "2026-11-20", time: "18:00" })], NOW));
  assert.match(calendar, /DTSTART:20261120T100000Z/);
  assert.match(calendar, /DTEND:20261120T101500Z/);
  assert.match(calendar, /TRIGGER:-P1D/);
});
test("Date-only calendar entries are all-day and end on the following date", () => {
  const calendar = unfold(buildCalendar([record({ deadline: "2026-12-31", time: "" })], NOW));
  assert.match(calendar, /DTSTART;VALUE=DATE:20261231/);
  assert.match(calendar, /DTEND;VALUE=DATE:20270101/);
  assert.match(calendar, /未列明時間/);
});
test("Calendar deduplicates and omits expired records", () => {
  const item = record();
  const calendar = buildCalendar([item, item, record({ name: "Expired", deadline: "2026-10-01" })], NOW);
  assert.equal((calendar.match(/BEGIN:VEVENT/g) || []).length, 1);
});
test("Calendar folds UTF-8 at 75 octets without injecting event properties", () => {
  const item = record({ name: "創作".repeat(50) + "\nBEGIN:VEVENT;假的,項目", eligibility: "引號\\,；\n條件" });
  const calendar = buildCalendar([item], NOW);
  assert.ok(calendar.split("\r\n").every(line => Buffer.byteLength(line, "utf8") <= 75));
  const unwrapped = unfold(calendar);
  assert.equal(unwrapped.split("\r\n").filter(line => line === "BEGIN:VEVENT").length, 1);
  assert.ok(unwrapped.includes("\\nBEGIN:VEVENT\\;假的\\,項目"));
  assert.ok(!unwrapped.includes("\ufffd"));
});
test("Prizes preserve the source currency; no hard-coded foreign exchange conversion", () => {
  const item = record({ prizeType: "US$1,000", total: "", kind: "" });
  assert.equal(prizeSummary(item), "US$1,000");
});
test("Production CSVs retain the published schema and UTF-8 BOM", async () => {
  const source = await fs.readFile(new URL("../competitions.csv", import.meta.url));
  const directory = await fs.readFile(new URL("../sites.csv", import.meta.url));
  assert.ok(source.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
  assert.ok(directory.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
  const items = toCompetitions(source.toString("utf8"));
  assert.equal(items.length, parseCSV(source.toString("utf8")).length - 1);
  assert.ok(toSites(directory.toString("utf8")).length > 10);
  const forHKBU = filterCompetitions(items, { profile: "HKBU" }, NOW);
  assert.ok(forHKBU.length > 0);
  assert.ok(forHKBU.every(item => !["HKU", "PolyU", "中學生", "小學生"].includes(item.target)));
  assert.ok(filterCompetitions(items, {}, NOW).every(item => deadlineMs(item) >= NOW));
});
