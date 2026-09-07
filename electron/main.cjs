"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
/* eslint-enable @typescript-eslint/no-require-imports */

const HOST = "127.0.0.1";
const DEFAULT_PORT = 30141;
const STARTUP_TIMEOUT_MS = 30_000;

let serverProcess;
let mainWindow;
let serverUrl;
let shuttingDown = false;

function appRoot() {
  return path.resolve(__dirname, "..");
}

function resolveNodeEntry(root) {
  try {
    return require.resolve("next/dist/bin/next", { paths: [root] });
  } catch {
    const nextPackage = require.resolve("next/package.json", { paths: [root] });
    return path.join(path.dirname(nextPackage), "dist", "bin", "next");
  }
}

function getNodeCommand() {
  // In development, Electron itself can run Node scripts when this flag is set.
  // npm_node_execpath is preferable when the app was launched from npm.
  return process.env.npm_node_execpath || process.execPath;
}

function probePort(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(port, HOST, () => {
      const address = probe.address();
      const selectedPort = typeof address === "object" && address ? address.port : port;
      probe.close((error) => (error ? reject(error) : resolve(selectedPort)));
    });
  });
}

async function getFreePort(preferredPort) {
  try {
    return await probePort(preferredPort);
  } catch (error) {
    if (error && error.code === "EADDRINUSE") return probePort(0);
    throw error;
  }
}

function getPreferredPort() {
  const configuredPort = Number(process.env.PI_WEB_PORT || DEFAULT_PORT);
  if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65_535) {
    throw new Error("PI_WEB_PORT must be an integer between 1 and 65535.");
  }
  return configuredPort;
}

function waitForServer(url, child) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      if (error) reject(error);
      else resolve();
    };

    const onExit = (code, signal) => {
      finish(new Error(`Pi server exited before startup (code=${code}, signal=${signal})`));
    };

    const check = () => {
      if (settled) return;
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) finish();
        else setTimeout(check, 100);
      });
      request.on("error", () => {
        if (Date.now() - startedAt >= STARTUP_TIMEOUT_MS) {
          finish(new Error(`Timed out waiting for Pi at ${url}`));
        } else {
          setTimeout(check, 100);
        }
      });
      request.setTimeout(1_000, () => request.destroy());
    };

    child.once("exit", onExit);
    timer = setTimeout(() => finish(new Error(`Timed out waiting for Pi at ${url}`)), STARTUP_TIMEOUT_MS);
    check();
  });
}

async function startPiWeb() {
  const root = appRoot();
  const nextDir = path.join(root, ".next");
  const production = app.isPackaged;

  if (production && !fs.existsSync(nextDir)) {
    throw new Error("Pi build artifacts are missing. Reinstall the application or run npm run build first.");
  }

  const port = await getFreePort(getPreferredPort());
  serverUrl = `http://${HOST}:${port}`;
  const nextBin = resolveNodeEntry(root);
  const nextCommand = production ? "start" : "dev";
  const nextArgs = [nextBin, nextCommand, "-H", HOST, "-p", String(port)];
  const env = {
    ...process.env,
    HOSTNAME: HOST,
    PORT: String(port),
    PI_WEB_HOSTNAME: HOST,
    PI_WEB_NO_OPEN: "1",
  };

  // Electron's executable is used as a Node runtime in packaged apps and
  // when no regular Node executable was supplied by npm.
  if (getNodeCommand() === process.execPath && process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = "1";
  }

  serverProcess = spawn(getNodeCommand(), nextArgs, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  serverProcess.stdout.on("data", (chunk) => process.stdout.write(`[pi-web] ${chunk}`));
  serverProcess.stderr.on("data", (chunk) => process.stderr.write(`[pi-web] ${chunk}`));
  serverProcess.once("error", (error) => {
    if (!shuttingDown) console.error("Unable to start Pi server:", error);
  });

  await waitForServer(serverUrl, serverProcess);
}

function stopPiWeb() {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  serverProcess.kill();
  serverProcess = undefined;
}

function createWindow() {
  const iconPath = path.join(appRoot(), "assets", "icon.png");
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#111111",
    icon: iconPath,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`${serverUrl}/`)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
    if (!shuttingDown) app.quit();
  });
  mainWindow.loadURL(serverUrl).catch((error) => {
    if (!shuttingDown) showStartupError(error);
  });
}

function showStartupError(error) {
  console.error(error);
  dialog.showErrorBox("Pi 启动失败", error instanceof Error ? error.message : String(error));
  app.quit();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    if (process.platform === "darwin" && app.dock) {
      app.dock.setIcon(path.join(appRoot(), "assets", "icon.png"));
    }
    try {
      await startPiWeb();
      createWindow();
    } catch (error) {
      showStartupError(error);
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverUrl) createWindow();
  });

  app.on("before-quit", () => {
    shuttingDown = true;
    stopPiWeb();
  });
}
