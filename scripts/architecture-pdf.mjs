/**
 * Renders docs/ARCHITECTURE.md (with its Mermaid diagrams) to docs/ARCHITECTURE.pdf
 * using headless Chrome or Edge.
 *   npm run docs:pdf
 * Needs an internet connection (markdown + diagram libraries load from a CDN).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const mdFile = path.join(root, "docs", "ARCHITECTURE.md");
const outFile = path.join(root, "docs", "ARCHITECTURE.pdf");

const browsers = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const browser = browsers.find((b) => existsSync(b));
if (!browser) {
  console.error("Chrome or Edge not found. Set CHROME_PATH to the browser executable.");
  process.exit(1);
}

const markdown = readFileSync(mdFile, "utf8");
const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>DentPlan – Architecture</title>
<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
<style>
  @page { size: A4; margin: 18mm 16mm 20mm; }
  :root { --accent: #0f766e; --muted: #64748b; --line: #e2e8f0; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", system-ui, -apple-system, Roboto, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #0f172a; margin: 0; }
  .cover { border-bottom: 3px solid var(--accent); padding-bottom: 14px; margin-bottom: 18px; }
  .cover .kicker { color: var(--accent); font-weight: 700; letter-spacing: .08em; text-transform: uppercase; font-size: 9pt; }
  .cover .meta { color: var(--muted); font-size: 9pt; margin-top: 4px; }
  h1 { font-size: 22pt; margin: 4px 0 0; }
  #content > h1:first-child { display: none; } /* title is in the cover block */
  h2 { font-size: 14pt; color: var(--accent); border-bottom: 1px solid var(--line); padding-bottom: 4px; margin: 22px 0 10px; break-after: avoid; }
  h3 { font-size: 11.5pt; margin: 16px 0 6px; break-after: avoid; }
  p, li { orphans: 3; widows: 3; }
  hr { display: none; }
  code { font-family: Consolas, "Cascadia Mono", monospace; font-size: 9pt; background: #f1f5f9; padding: 1px 4px; border-radius: 3px; }
  pre { background: #f8fafc; border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; overflow: hidden; white-space: pre-wrap; word-break: break-word; break-inside: avoid; }
  pre code { background: none; padding: 0; font-size: 8.5pt; line-height: 1.45; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 9.5pt; }
  th, td { border: 1px solid var(--line); padding: 5px 8px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; }
  tr { break-inside: avoid; }
  .mermaid { text-align: center; margin: 10px 0 16px; break-inside: avoid; }
  .mermaid svg { max-width: 100%; height: auto; }
  blockquote { border-left: 3px solid var(--accent); margin: 8px 0; padding: 2px 12px; color: var(--muted); }
</style>
</head>
<body>
  <div class="cover">
    <div class="kicker">Architecture</div>
    <h1>DentPlan – Treatment Plans by Voice</h1>
    <div class="meta">${date}</div>
  </div>
  <div id="content"></div>
  <script>
    const md = ${JSON.stringify(markdown)};
    const content = document.getElementById("content");
    content.innerHTML = marked.parse(md);
    content.querySelectorAll("pre > code.language-mermaid").forEach((code) => {
      const div = document.createElement("div");
      div.className = "mermaid";
      div.textContent = code.textContent;
      code.parentElement.replaceWith(div);
    });
    mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "strict",
      flowchart: { htmlLabels: true, useMaxWidth: true }, sequence: { useMaxWidth: true } });
    mermaid.run({ querySelector: ".mermaid" }).then(() => { document.body.dataset.ready = "1"; });
  </script>
</body>
</html>`;

const tmp = mkdtempSync(path.join(tmpdir(), "dentplan-doc-"));
const htmlFile = path.join(tmp, "architecture.html");
writeFileSync(htmlFile, html, "utf8");

try {
  execFileSync(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-pdf-header-footer",
      "--virtual-time-budget=20000",
      `--user-data-dir=${path.join(tmp, "profile")}`,
      `--print-to-pdf=${outFile}`,
      pathToFileURL(htmlFile).href,
    ],
    { stdio: "pipe", timeout: 120_000 },
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`Wrote ${path.relative(root, outFile)}`);
