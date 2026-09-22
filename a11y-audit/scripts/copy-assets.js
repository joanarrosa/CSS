import { cpSync } from "node:fs";

// tsc only compiles .ts files — the report's static CSS/JS assets need to
// be copied into dist/ alongside the compiled output so html.ts can read
// them at runtime relative to its own location.
cpSync("src/report/templates", "dist/report/templates", { recursive: true });
