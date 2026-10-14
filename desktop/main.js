// OMNI AI desktop app. Starts a private PostgreSQL database and the OMNI server on this computer, then shows them in a window.
// Nothing leaves the machine except the AI requests you make. Data lives in the app's data folder (see README).
const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { execFileSync, spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { applyMigrations } = require("./migrate");

const PREFERRED_WEB_PORT = 47831; // A steady address keeps the app's saved settings (theme, sidebar) between launches.
const HOST = "127.0.0.1";
const DB_NAME = "omni_ai";
const DB_USER = "omni";

const packaged = app.isPackaged;
const appDir = packaged ? path.join(process.resourcesPath, "app-server") : path.join(__dirname, "server-bundle");
const migrationsDir = packaged ? path.join(process.resourcesPath, "migrations") : path.join(__dirname, "migrations");

let postgres = null;
let server = null;
let mainWindow = null;
let stopping = false;
let logFile = null;

function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    if (logFile) fs.appendFileSync(logFile, line);
  } catch {
    // Logging must never stop the app.
  }
  if (!packaged) process.stdout.write(line);
}

function freePort(preferred) {
  return new Promise((resolve) => {
    const tryPort = (port) => {
      const probe = net.createServer();
      probe.once("error", () => (port === 0 ? resolve(0) : tryPort(0)));
      probe.listen(port, HOST, () => {
        const chosen = probe.address().port;
        probe.close(() => resolve(chosen));
      });
    };
    tryPort(preferred);
  });
}

/** Random secrets made on first run and kept in the data folder, readable only by you. */
function loadSecrets(dataDir) {
  const file = path.join(dataDir, "secrets.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    const secrets = { encryptionKey: crypto.randomBytes(32).toString("base64"), dbPassword: crypto.randomBytes(24).toString("hex") };
    fs.writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
    return secrets;
  }
}

function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function processName(pid) {
  try {
    if (process.platform === "win32") return execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true }).toLowerCase();
    return execFileSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8" }).toLowerCase();
  } catch {
    return "";
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A crash or force-quit can leave the database's lock file, or the database itself, behind. Remove a lock whose process
 * is gone; if it is still our own database process running, ask it to shut down cleanly. Anything else is left alone.
 */
async function clearStaleLock(databaseDir) {
  const lock = path.join(databaseDir, "postmaster.pid");
  let pid = 0;
  try {
    pid = Number(fs.readFileSync(lock, "utf8").split("\n")[0]);
  } catch {
    return;
  }
  if (!pid || !pidIsAlive(pid)) return fs.rmSync(lock, { force: true });
  if (!processName(pid).includes("postgres")) return fs.rmSync(lock, { force: true }); // The number now belongs to something else.
  log(`Stopping the database left running by an earlier session (pid ${pid})`);
  try {
    process.kill(pid, process.platform === "win32" ? undefined : "SIGINT");
  } catch {
    // Already gone.
  }
  for (let waited = 0; waited < 15_000 && pidIsAlive(pid); waited += 250) await sleep(250);
}

async function startDatabase(dataDir, secrets) {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const databaseDir = path.join(dataDir, "postgres");
  const port = await freePort(54329);
  const fresh = !fs.existsSync(path.join(databaseDir, "PG_VERSION"));
  await clearStaleLock(databaseDir);
  postgres = new EmbeddedPostgres({
    databaseDir,
    user: DB_USER,
    password: secrets.dbPassword,
    port,
    persistent: true,
    authMethod: "scram-sha-256",
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: [`-c`, `listen_addresses=${HOST}`],
    onLog: (message) => log(`[postgres] ${String(message).trim()}`),
    onError: (message) => log(`[postgres] ${String(message).trim()}`),
  });
  if (fresh) await postgres.initialise();
  await postgres.start();
  if (fresh) await postgres.createDatabase(DB_NAME);
  const url = `postgresql://${DB_USER}:${encodeURIComponent(secrets.dbPassword)}@${HOST}:${port}/${DB_NAME}`;
  const { Client } = require("pg");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const applied = await applyMigrations(client, migrationsDir, log);
    log(`Database ready (${applied} migrations applied)`);
  } finally {
    await client.end();
  }
  return url;
}

function waitForServer(port, timeoutMs = 60_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, HOST);
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (server?.exitCode !== null && server?.exitCode !== undefined) return reject(new Error("The OMNI server stopped while starting."));
        if (Date.now() - started > timeoutMs) return reject(new Error("The OMNI server did not start in time."));
        setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

async function startServer(databaseUrl, secrets) {
  const port = await freePort(PREFERRED_WEB_PORT);
  const entry = path.join(appDir, "launcher.js");
  server = spawn(process.execPath, [entry], {
    cwd: appDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      OMNI_PARENT_PID: String(process.pid),
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: HOST,
      DATABASE_URL: databaseUrl,
      ENCRYPTION_KEY: secrets.encryptionKey,
      OMNI_PUBLIC_URL: `http://${HOST}:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  server.stdout.on("data", (chunk) => log(`[server] ${String(chunk).trimEnd()}`));
  server.stderr.on("data", (chunk) => log(`[server] ${String(chunk).trimEnd()}`));
  server.on("exit", (code) => {
    log(`Server exited with code ${code}`);
    if (!stopping && mainWindow) {
      dialog.showErrorBox("OMNI AI stopped", `The OMNI server stopped unexpectedly. Details are in:\n${logFile}`);
      app.quit();
    }
  });
  await waitForServer(port);
  return port;
}

function showWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 420,
    minHeight: 560,
    backgroundColor: "#f6f2ea",
    title: "OMNI AI",
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, devTools: false },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => (mainWindow = null));
  return mainWindow;
}

function isAppUrl(url, port) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === HOST && Number(parsed.port) === port;
  } catch {
    return false;
  }
}

function buildMenu() {
  const mac = process.platform === "darwin";
  return Menu.buildFromTemplate([
    ...(mac ? [{ role: "appMenu" }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "reload" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
    { role: "windowMenu" },
    {
      label: "Help",
      submenu: [{ label: "Open the data folder", click: () => shell.openPath(app.getPath("userData")) }, { label: "Open the log file", click: () => shell.showItemInFolder(logFile) }],
    },
  ]);
}

async function launch() {
  const dataDir = app.getPath("userData");
  fs.mkdirSync(dataDir, { recursive: true });
  logFile = path.join(dataDir, "omni.log");
  try {
    if (fs.statSync(logFile).size > 2_000_000) fs.renameSync(logFile, `${logFile}.old`);
  } catch {
    // First run.
  }
  log(`Starting OMNI AI ${app.getVersion()}`);
  Menu.setApplicationMenu(buildMenu());

  const window = showWindow();
  window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<body style="margin:0;display:grid;place-items:center;height:100vh;background:#f6f2ea;color:#2b2a26;font-family:Georgia,serif"><div style="text-align:center"><div style="font-size:34px">Omni</div><p style="font:14px system-ui;opacity:.65">Starting your workspace…</p></div></body>')}`);

  try {
    const secrets = loadSecrets(dataDir);
    const databaseUrl = await startDatabase(dataDir, secrets);
    const port = await startServer(databaseUrl, secrets);
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url) && !isAppUrl(url, port)) shell.openExternal(url);
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
      if (isAppUrl(url, port) || url.startsWith("data:")) return;
      event.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    });
    await window.loadURL(`http://${HOST}:${port}/`);
  } catch (error) {
    log(`Could not start: ${error.stack || error.message}`);
    dialog.showErrorBox("OMNI AI could not start", `${error.message}\n\nDetails are in:\n${logFile}`);
    await shutdown();
    app.exit(1);
  }
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      server.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  if (postgres) {
    try {
      await postgres.stop();
    } catch (error) {
      log(`Stopping the database failed: ${error.message}`);
    }
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (stopping) return;
    event.preventDefault();
    void shutdown().finally(() => app.exit(0));
  });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => app.quit());
  app.whenReady().then(launch);
}
