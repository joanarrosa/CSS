import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { startServer } from "../src/server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_PORT = 4173;
const MAX_PORT_ATTEMPTS = 10;

let mainWindow;
let server;

async function isBrowserInstalled() {
  try {
    // CSS_AUDIT_CHROMIUM_PATH is an internal dev/test override (see src/collect.js);
    // end users never set it, so this always uses Playwright's normal resolution.
    const browser = await chromium.launch({
      executablePath: process.env.CSS_AUDIT_CHROMIUM_PATH || undefined,
    });
    await browser.close();
    return true;
  } catch (err) {
    if (/Executable doesn't exist/.test(err.message)) return false;
    throw err;
  }
}

function installBrowser(onLine) {
  return new Promise((resolve, reject) => {
    const cliPath = path.join(__dirname, "..", "node_modules", "playwright", "cli.js");
    const child = spawn(process.execPath, [cliPath, "install", "chromium"], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    child.stdout.on("data", (d) => onLine(d.toString()));
    child.stderr.on("data", (d) => onLine(d.toString()));
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Browser install exited with code ${code}`))));
  });
}

async function setStatus(text) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  await mainWindow.webContents
    .executeJavaScript(`document.getElementById('status') && (document.getElementById('status').textContent = ${JSON.stringify(text)});`)
    .catch(() => {});
}

async function showError(message) {
  await mainWindow.loadFile(path.join(__dirname, "error.html"));
  await mainWindow.webContents
    .executeJavaScript(`document.getElementById('message').textContent = ${JSON.stringify(message)};`)
    .catch(() => {});
}

function startServerOnAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    let attempt = 0;

    function tryPort(port) {
      const srv = startServer(port);
      srv.once("listening", () => resolve({ server: srv, port }));
      srv.once("error", (err) => {
        if (err.code === "EADDRINUSE" && attempt < MAX_PORT_ATTEMPTS) {
          attempt++;
          tryPort(port + 1);
        } else {
          reject(err);
        }
      });
    }

    tryPort(startPort);
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 720,
    minHeight: 600,
    title: "CSS Audit",
    icon: path.join(__dirname, "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await mainWindow.loadFile(path.join(__dirname, "loading.html"));

  try {
    const ready = await isBrowserInstalled();
    if (!ready) {
      await setStatus("Downloading the browser component this only needs once (roughly 150 MB)…");
      await installBrowser(() => {
        // Playwright's installer prints progress bars; we keep the message generic
        // rather than parsing/streaming raw CLI output into the UI.
      });
    }

    await setStatus("Starting the local server…");
    const { server: srv, port } = await startServerOnAvailablePort(BASE_PORT);
    server = srv;

    await mainWindow.loadURL(`http://localhost:${port}`);
  } catch (err) {
    await showError(err.stack || err.message);
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (server) server.close();
  app.quit();
});

app.on("before-quit", () => {
  if (server) server.close();
});
