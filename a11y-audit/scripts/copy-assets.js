import { cpSync } from "node:fs";

// tsc only compiles .ts files — the report's hand-written, browser-only
// CSS/JS assets need to be copied into dist/ alongside the compiled output
// so html.ts/server.ts can read/serve them at runtime. Copied by exact name
// (not the whole templates/ dir) so this doesn't also duplicate
// bodyMarkup.ts/appShell.ts's *source* — those are real TS modules tsc
// already compiles into dist/report/templates/*.js on its own.
const RAW_ASSETS = ["report.css", "glossary.js", "renderer.js", "report.js", "app.js"];
for (const name of RAW_ASSETS) {
  cpSync(`src/report/templates/${name}`, `dist/report/templates/${name}`);
}
