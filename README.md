# Open Call 雷達 HK

香港創作比賽與徵件搜尋器。Buildless HTML、CSS、JavaScript，沿用 GitHub Pages；毋須安裝依賴或申請 API key。

## 使用

- 直接搜尋「HKBU 免費 攝影」或「設計 本週」；支援繁簡、中英關鍵字和有限英文拼字容錯。
- 按學校／學段、類別、費用及截止日期篩選。學校篩選只作初步排除，不代表符合年齡、地區或其他條件。
- 收藏機會，記錄「想參加／準備中／已報名」和私人筆記。資料留在瀏覽器，可匯出 JSON 備份再匯入。
- 下載 ICS 日曆檔，匯入日曆後使用截止前一日的提醒。明確時間換算成 UTC；未提供時間的截止日期使用全日事件。
- 搜尋連結保留篩選條件。按 / 或 Ctrl/Cmd+K 專注搜尋。
- 提供深／淺色模式、鍵盤操作、手機版、空結果重設和資料載入失敗提示。

## 本機執行

需要 Node.js 20 或以上，毋須 npm install。

    npm start

開啟 http://127.0.0.1:4173/。

    npm test

測試涵蓋 CSV、日期與時區、資格初篩、搜尋、備份驗證和 ICS 編碼。

## 單檔預覽

    node scripts/build-preview.mjs /absolute/path/open-call-radar-preview.html

產生內嵌當前 CSV 的獨立 HTML，供離線預覽。這是當時的資料快照，不會自動取得之後的 CSV 更新。正式 GitHub Pages 載入原本的 CSV。

## 檔案與部署

- index.html、styles.css：介面與響應式排版。
- app.js：搜尋、收藏、進度、備份、資料載入與介面。
- radar-core.js：可獨立測試的資料與日曆邏輯。
- competitions.csv、sites.csv：現有資料來源，UTF-8 BOM 與欄位格式不變。

GitHub Pages 直接服務根目錄，無需建置。更新網站時要一併部署兩個 JS 檔和 CSS。資料例行更新繼續遵從 UPDATE-WORKFLOW.md。

## 資料與儲存

每次成功讀取 CSV 都會保留本機快取。網絡失敗時才使用快取，並明確顯示資料讀取時間及離線提示。截止日期仍按香港時間即時計算。

收藏不會傳送到伺服器，亦不會跨裝置自動同步；清除瀏覽器資料會清除收藏。匯入備份只加入缺少的項目，保留現有筆記及進度。已從 CSV 移除的收藏仍可查看，但不會繼續提供報名按鈕。

沒有自動爬蟲、AI 資格審批、電郵推送或背景提醒。日曆提醒由使用者匯入的日曆應用程式處理。

日曆格式依照 [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html)，包含 UTF-8 行摺疊、文字跳脫、全日事件的非包含結束日期及 UTC 時間。
