import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const output = path.resolve(process.argv[2] || path.join(root, "open-call-radar-preview.html"));
const [html, css, core, app, competitions, sites] = await Promise.all(
  ["index.html", "styles.css", "radar-core.js", "app.js", "competitions.csv", "sites.csv"]
    .map(file => fs.readFile(path.join(root, file), "utf8"))
);
const bundleData = JSON.stringify({ "./competitions.csv": competitions, "./sites.csv": sites }).replace(/</g, "\\u003c");
const coreScript = core.replace(/^export /gm, "");
let appScript = app.replace(/^import \{[\s\S]*?\} from "\.\/radar-core\.js";\s*/, "const esc = escapeHTML;\n");
appScript = appScript.replace('await fetch(file, { cache: "no-cache", signal: controller.signal })',
  'new Response(radarPreviewFiles[file], { status: radarPreviewFiles[file] ? 200 : 404 })');
const script = "const radarPreviewFiles = " + bundleData + ";\n" + coreScript + "\n" + appScript;
const outputHTML = html.replace('<link rel="stylesheet" href="./styles.css">', "<style>\n" + css + "\n</style>")
  .replace('<script type="module" src="./app.js"></script>', "")
  .replace('<a class="brand" href="./"', '<a class="brand" href=""')
  .replace('<main>', '<main><p class="notice">離線預覽 · 資料快照 ' + new Date().toISOString().slice(0, 10) + ' · 呢份檔案唔會自動更新比賽資料</p>')
  .replace("</body>", '<script type="module">\n' + script.replace(/<\/script/gi, "<\\/script") + "\n</script>\n</body>");
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, outputHTML, "utf8");
console.log(output);
