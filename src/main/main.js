/**
 * Nova Launcher — Main Process
 * Логика запуска объединена с Legacy Launcher:
 *  - Правильная обработка features (is_demo_user = ALWAYS false)
 *  - Поддержка quickPlay И старого --server для всех версий
 *  - Полный Microsoft OAuth2 flow
 *  - Оффлайн аккаунт работает на любых серверах с online-mode=false
 *  - Адаптивное окно (minWidth: 750)
 */
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');
const { spawn, exec } = require('child_process');
const crypto = require('crypto');

// ─── Constants ────────────────────────────────────────────────────────────────
const MS_AUTH_URL        = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const XBOX_AUTH_URL      = 'https://user.auth.xboxlive.com/user/authenticate';
const XSTS_AUTH_URL      = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const MC_AUTH_URL        = 'https://api.minecraftservices.com/authentication/login_with_xbox';
const MC_PROFILE_URL     = 'https://api.minecraftservices.com/minecraft/profile';
const VERSION_MANIFEST   = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
const FABRIC_META        = 'https://meta.fabricmc.net/v2/versions/game';
const FABRIC_LOADER_META = 'https://meta.fabricmc.net/v2/versions/loader';
const FORGE_META         = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const FORGE_MAVEN        = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const RESOURCES_URL      = 'https://resources.download.minecraft.net';
const MC_NEWS_URL        = 'https://launchercontent.mojang.com/v2/javaPatchNotes.json';
// Microsoft публичный client_id (такой же как в оригинальном лаунчере Minecraft)
const MS_CLIENT_ID       = '00000000402b5328';
const MAX_CONCURRENT     = 10;
const LAUNCHER_NAME      = 'NovaLauncher';
const LAUNCHER_VERSION   = '3.0.0';

// ─── Config ───────────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(app.getPath('userData'), 'nova-config.json');
const DEFAULT_INSTALL_DIR = path.join(
  process.platform === 'win32' ? (process.env.APPDATA || os.homedir()) : os.homedir(),
  '.nova-minecraft'
);

function defaultConfig() {
  return {
    accounts: [],
    activeAccount: null,
    javaPath: '',
    installDir: DEFAULT_INSTALL_DIR,
    ram: { min: 512, max: 2048 },
    jvmArgs: '',
    windowSize: { width: 854, height: 480 },
    selectedProfile: 'default',
    fullscreen: false,
    keepOpen: false,
    firstRun: true,
    serverAddress: '',
    serverPort: '25565',
    profiles: {
      default: {
        id: 'default',
        name: 'По умолчанию',
        versionId: null,
        gameDir: null,
        javaPath: null,
        ram: null,
        jvmArgs: null,
        icon: 'grass'
      }
    }
  };
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      const def = defaultConfig();
      return { ...def, ...data, profiles: { ...def.profiles, ...(data.profiles || {}) } };
    }
  } catch (e) { console.error('Config load error:', e); }
  return defaultConfig();
}

function saveConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch (e) { console.error('Config save error:', e); }
}

let config = loadConfig();
let mainWindow = null;

// ─── Directory helpers ────────────────────────────────────────────────────────
function getLauncherRoot() { return config.installDir || DEFAULT_INSTALL_DIR; }

function getProfileDir(profileId) {
  const profile = config.profiles?.[profileId];
  if (profile?.gameDir) return profile.gameDir;
  return path.join(getLauncherRoot(), 'profiles', profileId || 'default');
}

function ensureProfileFolders(profileId) {
  const dir = getProfileDir(profileId);
  const sub = ['', 'mods', 'resourcepacks', 'shaderpacks', 'saves', 'screenshots', 'logs', 'config', 'crash-reports', 'datapacks'];
  for (const f of sub) fs.mkdirSync(path.join(dir, f), { recursive: true });
  return dir;
}

function ensureLauncherFolders() {
  const root = getLauncherRoot();
  for (const f of ['versions', 'libraries', 'assets/indexes', 'assets/objects', 'runtime', 'profiles', 'skins', 'runtimes'])
    fs.mkdirSync(path.join(root, f), { recursive: true });
  // Write runtimes/README.txt to explain what goes in there
  const rtReadme = path.join(root, 'runtimes', 'README.txt');
  if (!fs.existsSync(rtReadme))
    fs.writeFileSync(rtReadme,
      'Nova Launcher — Runtimes folder\n' +
      '================================\n' +
      'Place additional Java runtimes or helper JARs here for Minecraft stability.\n\n' +
      'Structure examples:\n' +
      '  runtimes/java-8/bin/java.exe    — Java 8 for old Forge/vanilla\n' +
      '  runtimes/java-17/bin/java.exe   — Java 17 for 1.17-1.20\n' +
      '  runtimes/java-21/bin/java.exe   — Java 21 for 1.21+\n\n' +
      'Download Adoptium OpenJDK: https://adoptium.net\n'
    );
  return root;
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

// ─── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1150, height: 700,
    minWidth: 750, minHeight: 500,
    frame: false,
    backgroundColor: '#0d0f14',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false
    },
    show: false
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  // Clean up stale .tmp files from previous crashes
  try { cleanStaleTmps(getLauncherRoot()); } catch (_) {}
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!mainWindow) createWindow(); });

// ─── Window controls ──────────────────────────────────────────────────────────
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
ipcMain.on('window:close', () => mainWindow?.close());

// ─── Config IPC ───────────────────────────────────────────────────────────────
ipcMain.handle('config:get', () => config);
ipcMain.handle('config:set', (e, patch) => {
  config = { ...config, ...patch };
  saveConfig(config);
  return config;
});
ipcMain.handle('config:completeFirstRun', (e, installDir) => {
  config.installDir = installDir || DEFAULT_INSTALL_DIR;
  config.firstRun = false;
  saveConfig(config);
  ensureLauncherFolders();
  ensureProfileFolders('default');
  return config;
});
ipcMain.handle('config:selectInstallDir', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Выберите папку установки Nova Launcher'
  });
  return (!r.canceled && r.filePaths[0]) ? r.filePaths[0] : null;
});
ipcMain.handle('config:selectJava', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Выберите java.exe / java',
    filters: process.platform === 'win32'
      ? [{ name: 'Java', extensions: ['exe'] }]
      : [{ name: 'All', extensions: ['*'] }]
  });
  if (!r.canceled && r.filePaths[0]) {
    config.javaPath = r.filePaths[0];
    saveConfig(config);
    return r.filePaths[0];
  }
  return null;
});
ipcMain.handle('config:openDir', (e, p) => shell.openPath(p));

// ─── Profiles IPC ─────────────────────────────────────────────────────────────
ipcMain.handle('profiles:list', () => config.profiles || {});
ipcMain.handle('profiles:create', (e, { name, icon, versionId, gameDir }) => {
  const id = 'p' + Date.now();
  if (!config.profiles) config.profiles = {};
  config.profiles[id] = { id, name, icon: icon || 'grass', versionId: versionId || null, gameDir: gameDir || null, javaPath: null, ram: null, jvmArgs: null };
  config.selectedProfile = id;
  saveConfig(config);
  ensureProfileFolders(id);
  return config.profiles[id];
});
ipcMain.handle('profiles:update', (e, { id, patch }) => {
  if (!config.profiles?.[id]) return null;
  config.profiles[id] = { ...config.profiles[id], ...patch };
  saveConfig(config);
  return config.profiles[id];
});
ipcMain.handle('profiles:delete', (e, id) => {
  if (id === 'default') return false;
  delete config.profiles[id];
  if (config.selectedProfile === id) config.selectedProfile = 'default';
  saveConfig(config);
  return true;
});
ipcMain.handle('profiles:setActive', (e, id) => { config.selectedProfile = id; saveConfig(config); return config; });
ipcMain.handle('profiles:getDir', (e, id) => getProfileDir(id));
ipcMain.handle('profiles:ensureFolders', (e, id) => ensureProfileFolders(id));
ipcMain.handle('profiles:selectGameDir', async (e, profileId) => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'], title: 'Выберите папку профиля' });
  if (!r.canceled && r.filePaths[0]) {
    config.profiles[profileId].gameDir = r.filePaths[0];
    saveConfig(config);
    ensureProfileFolders(profileId);
    return r.filePaths[0];
  }
  return null;
});

// ─── Folder manager IPC ───────────────────────────────────────────────────────
const FOLDERS_META = [
  { id: 'mods',          name: 'Моды',       icon: '🧩', desc: '.jar файлы модов',         ext: ['jar'] },
  { id: 'resourcepacks', name: 'Ресурспаки', icon: '🎨', desc: '.zip ресурспаки',           ext: ['zip'] },
  { id: 'shaderpacks',   name: 'Шейдеры',    icon: '✨', desc: '.zip шейдеры',              ext: ['zip'] },
  { id: 'saves',         name: 'Миры',       icon: '🌍', desc: 'Папки сохранений',           ext: [] },
  { id: 'screenshots',   name: 'Скриншоты',  icon: '📷', desc: '.png/.jpg скриншоты',       ext: ['png','jpg'] },
  { id: 'logs',          name: 'Логи',       icon: '📋', desc: 'Журналы игры',               ext: ['log','gz','txt'] },
  { id: 'config',        name: 'Конфиги',    icon: '⚙️', desc: 'Настройки модов',            ext: [] },
  { id: 'crash-reports', name: 'Краши',      icon: '💥', desc: 'Отчёты об ошибках',          ext: ['txt'] },
  { id: 'datapacks',     name: 'Датапаки',   icon: '📦', desc: 'Датапаки для миров',         ext: ['zip'] },
];

ipcMain.handle('folders:list', (e, profileId) => {
  const profileDir = getProfileDir(profileId);
  return FOLDERS_META.map(f => {
    const folderPath = path.join(profileDir, f.id);
    let items = [], totalSize = 0, exists = fs.existsSync(folderPath);
    if (exists) {
      try {
        items = fs.readdirSync(folderPath)
          .filter(n => !n.startsWith('_') && !n.startsWith('.'))
          .map(name => {
            const fp = path.join(folderPath, name);
            try {
              const s = fs.statSync(fp);
              totalSize += s.size;
              return { name, size: s.size, sizeStr: formatBytes(s.size), isDir: s.isDirectory(), mtime: s.mtime.toLocaleDateString('ru') };
            } catch { return null; }
          }).filter(Boolean);
      } catch {}
    }
    return { ...f, path: folderPath, exists, items, count: items.length, sizeStr: formatBytes(totalSize) };
  });
});
ipcMain.handle('folders:open', (e, p) => shell.openPath(p));
ipcMain.handle('folders:ensure', (e, profileId) => { ensureProfileFolders(profileId); return true; });
ipcMain.handle('folders:addFiles', async (e, { profileId, folderId, ext }) => {
  const destDir = path.join(getProfileDir(profileId), folderId);
  fs.mkdirSync(destDir, { recursive: true });
  const filters = ext?.length ? [{ name: 'Files', extensions: ext }, { name: 'All', extensions: ['*'] }] : [{ name: 'All Files', extensions: ['*'] }];
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'], filters });
  if (!r.canceled && r.filePaths.length) {
    const copied = [];
    for (const src of r.filePaths) {
      const name = path.basename(src);
      fs.copyFileSync(src, path.join(destDir, name));
      copied.push(name);
    }
    return { success: true, copied };
  }
  return { success: false };
});
ipcMain.handle('folders:deleteFile', (e, filePath) => {
  try {
    const root = path.normalize(getLauncherRoot());
    const norm = path.normalize(filePath);
    if (!norm.startsWith(root) && !norm.startsWith(path.normalize(app.getPath('userData'))))
      return { error: 'Запрещено удалять файлы вне папки лаунчера' };
    if (fs.existsSync(filePath)) { fs.rmSync(filePath, { recursive: true, force: true }); return { success: true }; }
    return { error: 'Файл не найден' };
  } catch (e) { return { error: e.message }; }
});

// ─── Versions IPC ─────────────────────────────────────────────────────────────
ipcMain.handle('versions:getManifest', async () => {
  try { return JSON.parse(await httpGet(VERSION_MANIFEST)); } catch (e) { return { error: e.message }; }
});
ipcMain.handle('versions:getFabric', async () => {
  try {
    const [games, loaders] = await Promise.all([
      httpGet(FABRIC_META).then(JSON.parse),
      httpGet(FABRIC_LOADER_META).then(JSON.parse)
    ]);
    return { games: games.filter(g => g.stable), loaders: loaders.filter(l => l.stable) };
  } catch (e) { return { error: e.message }; }
});
ipcMain.handle('versions:getInstalled', () => {
  const dir = path.join(getLauncherRoot(), 'versions');
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir).filter(v =>
      fs.existsSync(path.join(dir, v, `${v}.json`)) && fs.existsSync(path.join(dir, v, `${v}.jar`))
    );
  } catch { return []; }
});
ipcMain.handle('versions:delete', (e, v) => {
  const d = path.join(getLauncherRoot(), 'versions', v);
  if (fs.existsSync(d)) { fs.rmSync(d, { recursive: true, force: true }); return true; }
  return false;
});

// ─── Install Vanilla ──────────────────────────────────────────────────────────
ipcMain.handle('install:vanilla', async (e, versionId) => {
  const send = d => mainWindow?.webContents.send('install:progress', d);
  try {
    ensureLauncherFolders();
    send({ message: `Получение метаданных ${versionId}...`, percent: 0 });
    const manifest = JSON.parse(await httpGet(VERSION_MANIFEST));
    const entry = manifest.versions.find(v => v.id === versionId);
    if (!entry) throw new Error(`Версия ${versionId} не найдена`);
    const versionJson = JSON.parse(await httpGet(entry.url));
    const root = getLauncherRoot();
    const vDir = path.join(root, 'versions', versionId);
    fs.mkdirSync(vDir, { recursive: true });
    fs.writeFileSync(path.join(vDir, `${versionId}.json`), JSON.stringify(versionJson, null, 2));
    const jar = path.join(vDir, `${versionId}.jar`);
    if (!fs.existsSync(jar))
      await downloadFile(versionJson.downloads.client.url, jar, (r, t) =>
        send({ message: `Клиент: ${Math.round(r / t * 100)}%`, percent: 5 + Math.round(r / t * 15) }));
    await downloadAssets(versionJson, root, (msg, pct) => send({ message: msg, percent: 20 + Math.round(pct * 0.3) }));
    await downloadLibraries(versionJson, root, (msg, pct) => send({ message: msg, percent: 50 + Math.round(pct * 0.35) }));
    send({ message: 'Распаковка нативных библиотек...', percent: 90 });
    await extractNatives(versionJson, root, versionId);
    send({ message: `✓ ${versionId} установлен!`, percent: 100 });
    return { success: true };
  } catch (e) {
    send({ message: `Ошибка: ${e.message}`, percent: -1, error: true });
    return { success: false, error: e.message };
  }
});

// ─── Install Fabric ───────────────────────────────────────────────────────────
ipcMain.handle('install:fabric', async (e, { gameVersion, loaderVersion }) => {
  const send = d => mainWindow?.webContents.send('install:progress', d);
  const profileId = `fabric-loader-${loaderVersion}-${gameVersion}`;
  try {
    ensureLauncherFolders();
    send({ message: `Установка Fabric ${loaderVersion} для ${gameVersion}...`, percent: 0 });
    await installVanillaInternal(gameVersion, (msg, pct) => send({ message: msg, percent: Math.round(pct * 0.6) }));
    send({ message: 'Загрузка профиля Fabric...', percent: 62 });
    const profile = JSON.parse(await httpGet(
      `https://meta.fabricmc.net/v2/versions/loader/${gameVersion}/${loaderVersion}/profile/json`
    ));
    const root = getLauncherRoot();
    const vDir = path.join(root, 'versions', profileId);
    fs.mkdirSync(vDir, { recursive: true });
    fs.writeFileSync(path.join(vDir, `${profileId}.json`), JSON.stringify(profile, null, 2));
    const vanillaJar = path.join(root, 'versions', gameVersion, `${gameVersion}.jar`);
    const fabricJar = path.join(vDir, `${profileId}.jar`);
    if (fs.existsSync(vanillaJar) && !fs.existsSync(fabricJar)) fs.copyFileSync(vanillaJar, fabricJar);
    const libQueue = buildFabricLibQueue(profile, root);
    await parallelDownload(libQueue, (d, t) => send({ message: `Fabric libs: ${d}/${t}`, percent: 65 + Math.round(d / (t || 1) * 30) }));
    send({ message: `✓ Fabric ${loaderVersion} установлен!`, percent: 100 });
    return { success: true, versionId: profileId };
  } catch (e) {
    send({ message: `Ошибка: ${e.message}`, percent: -1, error: true });
    return { success: false, error: e.message };
  }
});

// ─── Install Forge ────────────────────────────────────────────────────────────
ipcMain.handle('versions:getForge', async () => {
  try {
    const data = JSON.parse(await httpGet(FORGE_META));
    const promos = data.promos || {};
    const versions = {};
    for (const [key, forgeVer] of Object.entries(promos)) {
      const m = key.match(/^(\d+\.\d+(?:\.\d+)?)-(.+)$/);
      if (!m) continue;
      const mc = m[1]; const type = m[2];
      if (!versions[mc]) versions[mc] = {};
      versions[mc][type] = forgeVer;
    }
    return { versions };
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle('install:forge', async (e, { gameVersion, forgeVersion }) => {
  const send = d => mainWindow?.webContents.send('install:progress', d);
  try {
    ensureLauncherFolders();
    send({ message: `Установка Forge ${forgeVersion} для ${gameVersion}...`, percent: 0 });
    await installVanillaInternal(gameVersion, (msg, pct) => send({ message: msg, percent: Math.round(pct * 0.4) }));
    send({ message: 'Загрузка установщика Forge...', percent: 42 });
    const root = getLauncherRoot();
    const forgeFullVer = `${gameVersion}-${forgeVersion}`;
    const installerUrl = `${FORGE_MAVEN}/${forgeFullVer}/forge-${forgeFullVer}-installer.jar`;
    const installerPath = path.join(root, 'forge-installer-temp.jar');
    try {
      await downloadFile(installerUrl, installerPath, (r, t) =>
        send({ message: `Загрузка установщика: ${Math.round(r / t * 100)}%`, percent: 42 + Math.round(r / t * 15) }));
    } catch {
      const universalUrl = `${FORGE_MAVEN}/${forgeFullVer}/forge-${forgeFullVer}-universal.jar`;
      await downloadFile(universalUrl, installerPath, (r, t) =>
        send({ message: `Загрузка universal: ${Math.round(r / t * 100)}%`, percent: 42 + Math.round(r / t * 15) }));
    }
    send({ message: 'Запуск установщика Forge...', percent: 58 });
    const javaPath = await ensureJava(8, config.javaPath || null, send);
    await new Promise((res, rej) => {
      const proc = spawn(javaPath, ['-jar', installerPath, '--installClient', root], { cwd: root });
      proc.stdout.on('data', d => send({ message: d.toString().trim().substring(0, 100), percent: 60 }));
      proc.stderr.on('data', () => {});
      proc.on('close', code => {
        try { fs.unlinkSync(installerPath); } catch {}
        if (code === 0) return res();
        const forgeVDir = fs.existsSync(path.join(root, 'versions')) &&
          fs.readdirSync(path.join(root, 'versions')).find(v => v.startsWith(`${gameVersion}-forge`) || v.startsWith(`forge-${gameVersion}`));
        forgeVDir ? res() : rej(new Error(`Installer code ${code}`));
      });
      proc.on('error', rej);
    });
    send({ message: '✓ Forge установлен!', percent: 100 });
    return { success: true };
  } catch (e) {
    send({ message: `Ошибка Forge: ${e.message}`, percent: -1, error: true });
    return { success: false, error: e.message };
  }
});

// ─── LAUNCH — основная логика запуска (объединена с Legacy Launcher) ──────────
ipcMain.handle('game:launch', async (e, { versionId, account, profileId, serverAddress, serverPort }) => {
  const send = d => mainWindow?.webContents.send('game:status', d);
  try {
    send({ status: 'launching', message: 'Подготовка...' });
    const root = getLauncherRoot();
    const profile = config.profiles?.[profileId];
    const profileGameDir = ensureProfileFolders(profileId);

    const vDir = path.join(root, 'versions', versionId);
    const vjPath = path.join(vDir, `${versionId}.json`);
    if (!fs.existsSync(vjPath)) throw new Error(`Версия ${versionId} не установлена`);

    let vj = JSON.parse(fs.readFileSync(vjPath, 'utf8'));
    // Если это Fabric/Forge — наследуем от базовой ванильной версии
    if (vj.inheritsFrom) {
      const parentPath = path.join(root, 'versions', vj.inheritsFrom, `${vj.inheritsFrom}.json`);
      if (fs.existsSync(parentPath))
        vj = mergeVersionJsons(JSON.parse(fs.readFileSync(parentPath, 'utf8')), vj);
    }

    const javaPath = await ensureJava(
      vj.javaVersion?.majorVersion || 8,
      profile?.javaPath || config.javaPath || null,
      send
    );

    const nativesDir = path.join(vDir, 'natives');
    const assetsDir = path.join(root, 'assets');
    const classpath = buildClasspath(vj, root, versionId);
    const effectiveRam = profile?.ram || config.ram || { min: 512, max: 2048 };
    const effectiveJvmArgs = profile?.jvmArgs || config.jvmArgs || '';

    // Адрес сервера — из параметра запуска или из конфига
    const srv = serverAddress || config.serverAddress || '';
    const srvPort = serverPort || config.serverPort || '25565';

    const { jvmArgs, gameArgs } = buildArgsLegacy(vj, {
      account,
      gameDir: profileGameDir,
      assetsDir,
      versionId,
      nativesDir,
      classpath,
      config,
      serverAddress: srv,
      serverPort: srvPort
    });

    const allArgs = [
      `-Xms${effectiveRam.min}m`,
      `-Xmx${effectiveRam.max}m`,
      ...(effectiveJvmArgs ? effectiveJvmArgs.split(' ').filter(Boolean) : []),
      ...jvmArgs,
      vj.mainClass,
      ...gameArgs
    ];

    send({ status: 'launching', message: `Запуск ${versionId}...` });
    const proc = spawn(javaPath, allArgs, { cwd: profileGameDir, detached: false });
    proc.stdout.on('data', d => send({ status: 'running', log: d.toString() }));
    proc.stderr.on('data', d => send({ status: 'running', log: d.toString() }));
    proc.on('close', code => {
      send({ status: 'closed', code });
      if (!config.keepOpen) mainWindow?.show();
    });
    proc.on('error', err => send({ status: 'error', message: err.message }));
    if (!config.keepOpen) mainWindow?.minimize();
    send({ status: 'launched', pid: proc.pid, gameDir: profileGameDir });
    return { success: true };
  } catch (e) {
    send({ status: 'error', message: e.message });
    return { success: false, error: e.message };
  }
});

// ─── Auth — Оффлайн ───────────────────────────────────────────────────────────
ipcMain.handle('auth:offline', (e, username) => {
  // UUID в стиле Bukkit/Legacy (OfflinePlayer:<username>) — совместим с серверами
  const uuid = generateOfflineUUID(username);
  const acc = { type: 'offline', username, uuid, accessToken: '0', id: uuid };
  const idx = config.accounts.findIndex(a => a.id === uuid);
  if (idx >= 0) config.accounts[idx] = acc; else config.accounts.push(acc);
  config.activeAccount = uuid;
  saveConfig(config);
  return acc;
});

// ─── Auth — Microsoft OAuth2 (полный flow как в Legacy Launcher) ──────────────
ipcMain.handle('auth:microsoft', () => new Promise(resolve => {
  const win = new BrowserWindow({
    width: 520, height: 720,
    parent: mainWindow, modal: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });

  // Redirect — стандартный для публичного client_id Microsoft
  const red = 'https://login.microsoftonline.com/common/oauth2/nativeclient';

  // Полный URL авторизации
  const authUrl = `${MS_AUTH_URL}/authorize` +
    `?client_id=${MS_CLIENT_ID}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(red)}` +
    `&scope=XboxLive.signin%20offline_access` +
    `&prompt=select_account`;

  win.loadURL(authUrl);

  const handleUrl = async (ev, url) => {
    if (!url.startsWith(red)) return;
    if (ev && ev.preventDefault) ev.preventDefault();

    const parsed = new URL(url);
    const code = parsed.searchParams.get('code');
    const error = parsed.searchParams.get('error');

    if (!win.isDestroyed()) win.close();

    if (error || !code) return resolve({ error: error || 'Авторизация отменена' });

    try {
      const acc = await completeMSAuth(code, red);
      const idx = config.accounts.findIndex(a => a.id === acc.id);
      if (idx >= 0) config.accounts[idx] = acc; else config.accounts.push(acc);
      config.activeAccount = acc.id;
      saveConfig(config);
      resolve(acc);
    } catch (e) {
      resolve({ error: e.message });
    }
  };

  win.webContents.on('will-redirect', handleUrl);
  win.webContents.on('will-navigate', handleUrl);
  win.webContents.on('did-navigate', (ev, url) => {
    if (url.startsWith(red)) handleUrl(null, url);
  });
  win.on('closed', () => resolve({ error: 'Окно закрыто' }));
}));

// Обновление Microsoft токена
ipcMain.handle('auth:refreshMicrosoft', async (e, accountId) => {
  const acc = config.accounts.find(a => a.id === accountId);
  if (!acc || !acc.refreshToken) return { error: 'Нет refresh token' };
  try {
    const newAcc = await refreshMSToken(acc);
    const idx = config.accounts.findIndex(a => a.id === accountId);
    if (idx >= 0) config.accounts[idx] = { ...acc, ...newAcc };
    saveConfig(config);
    return config.accounts[idx];
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('auth:remove', (e, id) => {
  config.accounts = config.accounts.filter(a => a.id !== id);
  if (config.activeAccount === id) config.activeAccount = config.accounts[0]?.id || null;
  saveConfig(config);
  return config;
});
ipcMain.handle('auth:setActive', (e, id) => { config.activeAccount = id; saveConfig(config); return config; });

// ─── Skin ─────────────────────────────────────────────────────────────────────
ipcMain.handle('skin:get', async (e, uuid) => {
  try {
    const d = JSON.parse(await httpGet(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`));
    const p = d.properties?.find(x => x.name === 'textures');
    return p ? JSON.parse(Buffer.from(p.value, 'base64').toString()).textures : null;
  } catch { return null; }
});
ipcMain.handle('skin:setOffline', async (e, accountId) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Выберите скин (64x64 PNG)',
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths[0]) return { error: 'Отменено' };
  try {
    const buf = fs.readFileSync(r.filePaths[0]);
    const b64 = buf.toString('base64');
    const acc = config.accounts.find(a => a.id === accountId);
    if (!acc) return { error: 'Аккаунт не найден' };
    acc.skinData = b64;
    const skinsDir = path.join(getLauncherRoot(), 'skins');
    fs.mkdirSync(skinsDir, { recursive: true });
    fs.writeFileSync(path.join(skinsDir, `${accountId}.png`), buf);
    saveConfig(config);
    return { success: true, skinData: b64 };
  } catch (e) { return { error: e.message }; }
});
ipcMain.handle('skin:removeOffline', (e, accountId) => {
  const acc = config.accounts.find(a => a.id === accountId);
  if (acc) { delete acc.skinData; saveConfig(config); }
  try { fs.unlinkSync(path.join(getLauncherRoot(), 'skins', `${accountId}.png`)); } catch {}
  return { success: true };
});
ipcMain.handle('skin:getSkinPath', (e, accountId) => {
  const p = path.join(getLauncherRoot(), 'skins', `${accountId}.png`);
  return fs.existsSync(p) ? p : null;
});

// ─── News ─────────────────────────────────────────────────────────────────────
ipcMain.handle('news:get', async () => {
  try {
    const data = JSON.parse(await httpGet(MC_NEWS_URL));
    return (data.entries || []).slice(0, 8).map(e => ({
      id: e.id,
      title: e.title,
      version: e.version,
      date: e.date,
      image: e.image?.url || null,
      body: (e.body || '').replace(/<[^>]+>/g, '').substring(0, 200) + '...'
    }));
  } catch { return []; }
});

// ─── Modrinth ─────────────────────────────────────────────────────────────────
const MODRINTH_API = 'https://api.modrinth.com/v2';
function modrinthGet(urlPath) {
  return new Promise((res, rej) => {
    const fullUrl = MODRINTH_API + urlPath;
    https.get(fullUrl, {
      headers: { 'User-Agent': `${LAUNCHER_NAME}/${LAUNCHER_VERSION}`, 'Accept': 'application/json' },
      timeout: 20000
    }, r => {
      if ([301, 302, 307, 308].includes(r.statusCode) && r.headers.location)
        return res(modrinthGet(r.headers.location.replace(MODRINTH_API, '')));
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch { res({}); } });
    }).on('error', rej).on('timeout', function () { this.destroy(); rej(new Error('Timeout')); });
  });
}
ipcMain.handle('mods:search', async (e, { query, gameVersion, loader, offset, limit, category }) => {
  try {
    const facets = [['project_type:mod']];
    if (gameVersion) facets.push([`versions:${gameVersion}`]);
    if (loader) facets.push([`categories:${loader}`]);
    if (category && category !== 'all') facets.push([`categories:${category}`]);
    const q = query ? `&query=${encodeURIComponent(query)}` : '';
    const data = await modrinthGet(`/search?facets=${encodeURIComponent(JSON.stringify(facets))}${q}&offset=${offset || 0}&limit=${limit || 20}&index=relevance`);
    return {
      hits: (data.hits || []).map(h => ({
        id: h.project_id || h.slug, slug: h.slug, title: h.title,
        description: h.description, author: h.author, downloads: h.downloads,
        icon: h.icon_url || null, categories: h.categories || [],
        versions: h.versions || [], latestVersion: h.latest_version,
        clientSide: h.client_side, serverSide: h.server_side, color: h.color || null,
      })),
      total: data.total_hits || 0, offset: data.offset || 0
    };
  } catch (e) { return { error: e.message, hits: [], total: 0 }; }
});
ipcMain.handle('mods:getVersions', async (e, { projectId, gameVersion, loader }) => {
  try {
    let url = `/project/${projectId}/version?`;
    if (gameVersion) url += `game_versions=["${gameVersion}"]&`;
    if (loader) url += `loaders=["${loader}"]`;
    const data = await modrinthGet(url);
    return (Array.isArray(data) ? data : []).slice(0, 15).map(v => ({
      id: v.id, name: v.name, versionNumber: v.version_number,
      loaders: v.loaders || [], gameVersions: v.game_versions || [],
      downloads: v.downloads, datePublished: v.date_published,
      changelog: (v.changelog || '').substring(0, 300),
      files: (v.files || []).map(f => ({ url: f.url, filename: f.filename, primary: f.primary, size: f.size }))
    }));
  } catch (e) { return { error: e.message }; }
});
ipcMain.handle('mods:download', async (e, { url, filename, profileId }) => {
  const send = d => mainWindow?.webContents.send('mods:downloadProgress', d);
  try {
    const modsDir = path.join(getProfileDir(profileId), 'mods');
    fs.mkdirSync(modsDir, { recursive: true });
    const dest = path.join(modsDir, filename);
    if (fs.existsSync(dest)) return { success: true, path: dest, alreadyExists: true };
    send({ filename, status: 'downloading', percent: 0 });
    await downloadFile(url, dest, (r, t) => send({ filename, status: 'downloading', percent: Math.round(r / t * 100) }));
    send({ filename, status: 'done', percent: 100 });
    return { success: true, path: dest };
  } catch (e) {
    send({ filename, status: 'error', error: e.message });
    return { success: false, error: e.message };
  }
});
ipcMain.handle('mods:getCategories', async () => {
  try {
    const data = await modrinthGet('/tag/category');
    return (Array.isArray(data) ? data : []).filter(c => c.project_type === 'mod').map(c => ({ name: c.name, icon: c.icon }));
  } catch { return []; }
});
ipcMain.handle('mods:getGameVersions', async () => {
  try {
    const data = await modrinthGet('/tag/game_version');
    return (Array.isArray(data) ? data : []).filter(v => v.version_type === 'release').map(v => v.version).slice(0, 40);
  } catch { return []; }
});

// ─── System ───────────────────────────────────────────────────────────────────
ipcMain.handle('launcher:version', () => LAUNCHER_VERSION);
ipcMain.handle('launcher:getRuntimesDir', () => path.join(getLauncherRoot(), 'runtimes'));

// ─── Auto-check new versions (Vanilla, Fabric, Forge) ─────────────────────────
// Returns list of {type, id, label, isNew} for badges and notifications
ipcMain.handle('versions:checkUpdates', async () => {
  const results = { vanilla: [], fabric: [], forge: [], newCount: 0 };
  const root = getLauncherRoot();
  const installed = (() => {
    const dir = path.join(root, 'versions');
    if (!fs.existsSync(dir)) return [];
    try { return fs.readdirSync(dir).filter(v => fs.existsSync(path.join(dir, v, `${v}.json`))); } catch { return []; }
  })();

  // Cache file to avoid hitting APIs every launch
  const cacheFile = path.join(root, '.version-cache.json');
  let cache = {};
  try { if (fs.existsSync(cacheFile)) cache = JSON.parse(fs.readFileSync(cacheFile,'utf8')); } catch {}
  const now = Date.now();
  const CACHE_TTL = 15 * 60 * 1000; // 15 min

  try {
    // ── Vanilla ──
    if (!cache.vanilla || now - cache.vanilla.ts > CACHE_TTL) {
      const manifest = JSON.parse(await httpGet(VERSION_MANIFEST));
      cache.vanilla = { ts: now, latest: manifest.latest };
    }
    const latestRelease = cache.vanilla.latest?.release;
    const latestSnapshot = cache.vanilla.latest?.snapshot;
    if (latestRelease) {
      results.vanilla.push({ id: latestRelease, label: latestRelease, type: 'release', isNew: !installed.includes(latestRelease) });
      if (!installed.includes(latestRelease)) results.newCount++;
    }
    if (latestSnapshot && latestSnapshot !== latestRelease) {
      results.vanilla.push({ id: latestSnapshot, label: latestSnapshot, type: 'snapshot', isNew: !installed.includes(latestSnapshot) });
    }

    // ── Fabric ──
    if (!cache.fabric || now - cache.fabric.ts > CACHE_TTL) {
      const games = JSON.parse(await httpGet(FABRIC_META));
      const loaders = JSON.parse(await httpGet(FABRIC_LOADER_META));
      cache.fabric = {
        ts: now,
        latestGame: games.find(g => g.stable)?.version,
        latestLoader: loaders.find(l => l.stable)?.version
      };
    }
    if (cache.fabric.latestGame && cache.fabric.latestLoader) {
      const fabricId = `fabric-loader-${cache.fabric.latestLoader}-${cache.fabric.latestGame}`;
      const isNew = !installed.includes(fabricId);
      results.fabric.push({ id: fabricId, label: `Fabric ${cache.fabric.latestLoader} для ${cache.fabric.latestGame}`, type: 'fabric', isNew });
      if (isNew) results.newCount++;
    }

    // ── Forge ──
    if (!cache.forge || now - cache.forge.ts > CACHE_TTL) {
      const data = JSON.parse(await httpGet(FORGE_META));
      const promos = data.promos || {};
      // Find latest stable forge for latest MC
      const latestForgeMc = Object.keys(promos)
        .map(k => k.match(/^(\d+\.\d+(?:\.\d+)?)-recommended$/))
        .filter(Boolean).map(m => m[1])
        .sort((a,b) => { const pa=a.split('.').map(Number),pb=b.split('.').map(Number); for(let i=0;i<3;i++){if((pa[i]||0)!==(pb[i]||0))return (pb[i]||0)-(pa[i]||0)} return 0; })[0];
      if (latestForgeMc) {
        cache.forge = { ts: now, mc: latestForgeMc, ver: promos[`${latestForgeMc}-recommended`] };
      } else {
        cache.forge = { ts: now, mc: null, ver: null };
      }
    }
    if (cache.forge.mc && cache.forge.ver) {
      const forgePattern = `${cache.forge.mc}-forge`;
      const isNew = !installed.some(v => v.includes(forgePattern) || v.includes(`forge-${cache.forge.mc}`));
      results.forge.push({
        id: `${cache.forge.mc}-${cache.forge.ver}`,
        label: `Forge ${cache.forge.ver} для ${cache.forge.mc}`,
        type: 'forge', isNew
      });
      if (isNew) results.newCount++;
    }

    // Save cache
    try { fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2)); } catch {}
  } catch(e) {
    console.log('[Nova] Version check error:', e.message);
  }

  return results;
});
ipcMain.handle('launcher:openRuntimesDir', () => {
  const dir = path.join(getLauncherRoot(), 'runtimes');
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});
ipcMain.handle('system:info', () => ({
  platform: process.platform, arch: process.arch,
  totalMem: Math.round(os.totalmem() / 1024 / 1024),
  freeMem: Math.round(os.freemem() / 1024 / 1024),
  cpus: os.cpus().length, homeDir: os.homedir(),
  defaultInstallDir: DEFAULT_INSTALL_DIR
}));
ipcMain.handle('system:openExternal', (e, url) => shell.openExternal(url));
ipcMain.handle('system:checkJava', async () => {
  const candidates = config.javaPath ? [config.javaPath] :
    process.platform === 'win32'
      ? ['java', 'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.0.37-hotspot\\bin\\java.exe']
      : ['java', '/usr/bin/java', '/usr/local/bin/java'];
  for (const cmd of candidates) {
    try { const v = await getJavaVersion(cmd); return { found: true, path: cmd, version: v }; } catch {}
  }
  return { found: false };
});

// ═══════════════════════════════════════════════════════════════════════════════
// КЛЮЧЕВЫЕ ФУНКЦИИ — объединённая логика Legacy Launcher
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * buildArgsLegacy — построение аргументов запуска с логикой Legacy Launcher:
 * 1. Правильная обработка features в rules (is_demo_user = ВСЕГДА false)
 * 2. Поддержка quickPlay для новых версий (1.20+) И --server для старых
 * 3. Корректные переменные для offline/microsoft аккаунтов
 */
function buildArgsLegacy(vj, { account, gameDir, assetsDir, versionId, nativesDir, classpath, config, serverAddress, serverPort }) {
  const sep = process.platform === 'win32' ? ';' : ':';
  const root = getLauncherRoot();

  // ─── Переменные подстановки (Legacy-совместимые) ───────────────────────────
  // auth_access_token: для offline используем специальное значение чтобы не попасть в демо
  const isOnline = account?.type === 'microsoft';
  const accessToken = isOnline ? (account.accessToken || '0') : '0';
  const userType = isOnline ? 'msa' : 'mojang'; // 'mojang' вместо 'legacy' для offline — Legacy Launcher делает так же

  const vars = {
    '${auth_player_name}':    account?.username || 'Player',
    '${version_name}':        versionId,
    '${game_directory}':      gameDir,
    '${assets_root}':         assetsDir,
    '${assets_index_name}':   vj.assetIndex?.id || versionId,
    '${auth_uuid}':           account?.uuid || '00000000-0000-0000-0000-000000000000',
    '${auth_access_token}':   accessToken,
    '${user_type}':           userType,
    '${version_type}':        vj.type || 'release',
    '${resolution_width}':    String(config.windowSize?.width || 854),
    '${resolution_height}':   String(config.windowSize?.height || 480),
    '${natives_directory}':   nativesDir,
    '${launcher_name}':       LAUNCHER_NAME,
    '${launcher_version}':    LAUNCHER_VERSION,
    '${classpath}':           classpath,
    '${library_directory}':   path.join(root, 'libraries'),
    '${classpath_separator}': sep,
    '${primary_jar}':         path.join(root, 'versions', versionId, `${versionId}.jar`),
    // quickPlay переменная для новых версий
    '${quickPlayMultiplayer}': serverAddress ? `${serverAddress}:${serverPort || 25565}` : '',
    // legacy session
    '${auth_session}':        isOnline ? `token:${accessToken}:${account?.uuid || ''}` : 'null',
    '${user_properties}':     '{}',
  };

  // ─── Feature matcher — логика из Legacy Launcher ───────────────────────────
  // is_demo_user ВСЕГДА false — именно так делает Legacy Launcher
  // has_custom_resolution — true если размер окна задан
  // is_quick_play_multiplayer — true если указан сервер
  const matchFeature = (features) => {
    for (const [key, expectedVal] of Object.entries(features || {})) {
      let actual;
      switch (key) {
        case 'is_demo_user':
          // Legacy: ВСЕГДА false — никогда не демо!
          actual = false;
          break;
        case 'has_custom_resolution':
          actual = (config.windowSize?.width > 0 && config.windowSize?.height > 0);
          break;
        case 'is_quick_play_multiplayer':
          actual = !!(serverAddress);
          break;
        case 'is_quick_play_singleplayer':
        case 'is_quick_play_realms':
          actual = false;
          break;
        default:
          actual = false;
      }
      if (Boolean(actual) !== Boolean(expectedVal)) return false;
    }
    return true;
  };

  // Проверить одно правило (с поддержкой features И os)
  const matchRule = (rule) => {
    if (rule.features && !matchFeature(rule.features)) return false;
    if (rule.os && !matchesOs(rule.os)) return false;
    return true;
  };

  // Resolve аргумента согласно правилам — точная логика Legacy Launcher
  const resolveArg = (arg) => {
    if (typeof arg === 'string') {
      let r = arg;
      for (const [k, v] of Object.entries(vars)) r = r.replaceAll(k, v);
      return [r];
    }
    if (arg?.rules) {
      // Если ХОТЯ БЫ одно правило allow совпало — включить аргумент
      let allowed = false;
      for (const rule of arg.rules) {
        if (rule.action === 'allow' && matchRule(rule)) allowed = true;
        if (rule.action === 'disallow' && matchRule(rule)) { allowed = false; break; }
      }
      if (!allowed) return [];
      const val = arg.value;
      return Array.isArray(val) ? val.flatMap(resolveArg) : resolveArg(val);
    }
    return [];
  };

  const jvmArgs = [], gameArgs = [];

  if (vj.arguments) {
    for (const a of (vj.arguments.jvm || [])) jvmArgs.push(...resolveArg(a));
    for (const a of (vj.arguments.game || [])) gameArgs.push(...resolveArg(a));
  } else if (vj.minecraftArguments) {
    // Старый формат (до 1.13)
    jvmArgs.push(`-Djava.library.path=${nativesDir}`, '-cp', classpath);
    for (const a of vj.minecraftArguments.split(' ')) gameArgs.push(...resolveArg(a));
  }

  if (config.fullscreen) gameArgs.push('--fullscreen');

  // ─── Поддержка сервера — как в Legacy Launcher ──────────────────────────────
  // Legacy: если версия поддерживает quickPlay — используем его
  // Если нет — падаем на старый --server (поддерживается всеми версиями с мультиплеером)
  if (serverAddress) {
    const supportsQuickPlay = (vj.arguments?.game || []).some(a => {
      if (typeof a !== 'object' || !a.rules) return false;
      return a.rules.some(r => r.features && 'is_quick_play_multiplayer' in r.features);
    });

    if (!supportsQuickPlay) {
      // Старый способ — работает для всех версий начиная с 1.3
      if (!gameArgs.includes('--server')) {
        gameArgs.push('--server', serverAddress);
        if (serverPort && serverPort !== '25565') {
          gameArgs.push('--port', String(serverPort));
        }
      }
    }
    // Для новых версий quickPlay уже добавлен через resolveArg выше
  }

  // ─── Убрать мусорные аргументы ─────────────────────────────────────────────
  // Убираем дублирующиеся quickPlay аргументы (Legacy тоже это делает)
  const quickPlayKeys = new Set(['--quickPlayPath', '--quickPlaySingleplayer', '--quickPlayMultiplayer', '--quickPlayRealms']);
  const seenQP = new Set();
  const cleanGameArgs = [];
  for (let i = 0; i < gameArgs.length; i++) {
    const arg = gameArgs[i];
    if (quickPlayKeys.has(arg)) {
      if (seenQP.has(arg)) { i++; continue; }
      seenQP.add(arg);
    }
    cleanGameArgs.push(arg);
  }

  // Убрать пустые строки и незаменённые переменные
  const finalJvm = jvmArgs.filter(a => a && !a.startsWith('${'));
  const finalGame = cleanGameArgs.filter(a => a !== null && a !== undefined && a !== '');

  return { jvmArgs: finalJvm, gameArgs: finalGame };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────
async function installVanillaInternal(gameVersion, onProgress) {
  const manifest = JSON.parse(await httpGet(VERSION_MANIFEST));
  const entry = manifest.versions.find(v => v.id === gameVersion);
  if (!entry) throw new Error(`Версия ${gameVersion} не найдена`);
  const vj = JSON.parse(await httpGet(entry.url));
  const root = getLauncherRoot();
  const vDir = path.join(root, 'versions', gameVersion);
  fs.mkdirSync(vDir, { recursive: true });
  fs.writeFileSync(path.join(vDir, `${gameVersion}.json`), JSON.stringify(vj, null, 2));
  const jar = path.join(vDir, `${gameVersion}.jar`);
  if (!fs.existsSync(jar))
    await downloadFile(vj.downloads.client.url, jar, (r, t) => onProgress(`Клиент: ${Math.round(r / t * 100)}%`, r / t * 25));
  await downloadAssets(vj, root, (msg, pct) => onProgress(msg, 25 + pct * 0.35));
  await downloadLibraries(vj, root, (msg, pct) => onProgress(msg, 60 + pct * 0.35));
  await extractNatives(vj, root, gameVersion);
}

async function downloadAssets(vj, root, onProgress) {
  const idxDir = path.join(root, 'assets', 'indexes');
  fs.mkdirSync(idxDir, { recursive: true });
  const idxPath = path.join(idxDir, `${vj.assetIndex.id}.json`);
  if (!fs.existsSync(idxPath)) await downloadFile(vj.assetIndex.url, idxPath);
  const objs = Object.values(JSON.parse(fs.readFileSync(idxPath, 'utf8')).objects);
  const queue = objs
    .filter(o => !fs.existsSync(path.join(root, 'assets', 'objects', o.hash.slice(0, 2), o.hash)))
    .map(o => ({ url: `${RESOURCES_URL}/${o.hash.slice(0, 2)}/${o.hash}`, dest: path.join(root, 'assets', 'objects', o.hash.slice(0, 2), o.hash) }));
  await parallelDownload(queue, (d, t) => onProgress(`Ассеты: ${d}/${t}`, d / (t || 1) * 100));
}

async function downloadLibraries(vj, root, onProgress) {
  const queue = [];
  for (const lib of (vj.libraries || [])) {
    if (!isLibAllowed(lib)) continue;
    if (lib.downloads?.artifact) {
      const d = path.join(root, 'libraries', lib.downloads.artifact.path);
      if (!fs.existsSync(d)) queue.push({ url: lib.downloads.artifact.url, dest: d });
    }
    const nk = getNativesKey(lib);
    if (nk && lib.downloads?.classifiers?.[nk]) {
      const n = lib.downloads.classifiers[nk];
      const d = path.join(root, 'libraries', n.path);
      if (!fs.existsSync(d)) queue.push({ url: n.url, dest: d });
    }
  }
  await parallelDownload(queue, (d, t) => onProgress(`Библиотеки: ${d}/${t}`, d / (t || 1) * 100));
}

function buildFabricLibQueue(profile, root) {
  const queue = [];
  for (const lib of (profile.libraries || [])) {
    const [org, name, ver] = lib.name.split(':');
    const rel = `${org.replace(/\./g, '/')}/${name}/${ver}/${name}-${ver}.jar`;
    const dest = path.join(root, 'libraries', rel);
    if (!fs.existsSync(dest))
      queue.push({ url: (lib.url || 'https://repo1.maven.org/maven2/').replace(/\/$/, '') + '/' + rel, dest });
  }
  return queue;
}

async function extractNatives(vj, root, versionId) {
  const nDir = path.join(root, 'versions', versionId, 'natives');
  fs.mkdirSync(nDir, { recursive: true });
  for (const lib of (vj.libraries || [])) {
    if (!isLibAllowed(lib)) continue;
    const nk = getNativesKey(lib);
    if (!nk || !lib.downloads?.classifiers?.[nk]) continue;
    const jarPath = path.join(root, 'libraries', lib.downloads.classifiers[nk].path);
    if (!fs.existsSync(jarPath)) continue;
    try {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(jarPath);
      const ex = lib.extract?.exclude || ['META-INF/'];
      for (const e of zip.getEntries()) {
        if (ex.some(x => e.entryName.startsWith(x)) || e.isDirectory) continue;
        const out = path.join(nDir, e.entryName);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, e.getData());
      }
    } catch (e) { console.error('Native extract fail:', lib.name, e.message); }
  }
}

async function ensureJava(req, customPath, send) {
  const root = getLauncherRoot();
  const isWin = process.platform === 'win32';
  const bin = isWin ? 'java.exe' : 'java';
  // Build candidate list: custom → runtimes folder → runtime folder → system
  const candidates = [
    customPath,
    // Runtimes folder: java-21, java-17, java-8 etc (newest first)
    path.join(root, 'runtimes', `java-${req}`, 'bin', bin),
    path.join(root, 'runtimes', 'java-21', 'bin', bin),
    path.join(root, 'runtimes', 'java-17', 'bin', bin),
    path.join(root, 'runtimes', 'java-8',  'bin', bin),
    // Legacy runtime folder
    path.join(root, 'runtime', `java-${req}`, 'bin', bin),
    // System Java
    'java',
    ...(isWin
      ? ['C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.0.37-hotspot\\bin\\java.exe',
         'C:\\Program Files\\Java\\jdk-21\\bin\\java.exe',
         'C:\\Program Files\\Java\\jdk-17\\bin\\java.exe']
      : ['/usr/bin/java', '/usr/local/bin/java', '/opt/homebrew/bin/java']),
  ].filter(Boolean);

  for (const cmd of candidates) {
    if (!fs.existsSync && cmd !== 'java') continue; // skip non-existent paths silently
    try {
      const v = await getJavaVersion(cmd);
      if (v >= req) {
        send?.({ status: 'info', message: `Java ${v} найдена: ${cmd}` });
        return cmd;
      }
    } catch (_) {}
  }
  send?.({ status: 'warn', message: `Java ${req}+ не найдена! Скачайте с adoptium.net и положите в папку runtimes/java-${req}` });
  return 'java';
}

function getJavaVersion(jp) {
  return new Promise((res, rej) => {
    exec(`"${jp}" -version 2>&1`, (e, out, err) => {
      const m = (out + err).match(/version "(\d+)(?:\.(\d+))?/);
      if (m) res(parseInt(m[1]) === 1 ? parseInt(m[2] || '0') : parseInt(m[1]));
      else rej(new Error('no ver'));
    });
  });
}

function mergeVersionJsons(parent, child) {
  const m = { ...parent };
  for (const [k, v] of Object.entries(child)) {
    if (k === 'libraries') m.libraries = [...(parent.libraries || []), ...(v || [])];
    else if (k === 'arguments' && parent.arguments)
      m.arguments = {
        game: [...(parent.arguments.game || []), ...(v.game || [])],
        jvm: [...(parent.arguments.jvm || []), ...(v.jvm || [])]
      };
    else m[k] = v;
  }
  return m;
}

function buildClasspath(vj, root, versionId) {
  const cp = [];
  for (const lib of (vj.libraries || [])) {
    if (!isLibAllowed(lib)) continue;
    if (lib.downloads?.artifact) {
      const p = path.join(root, 'libraries', lib.downloads.artifact.path);
      if (fs.existsSync(p)) cp.push(p);
    } else if (lib.name) {
      const [o, n, v] = lib.name.split(':');
      const p = path.join(root, 'libraries', `${o.replace(/\./g, '/')}/${n}/${v}/${n}-${v}.jar`);
      if (fs.existsSync(p)) cp.push(p);
    }
  }
  const jar = path.join(root, 'versions', versionId, `${versionId}.jar`);
  if (fs.existsSync(jar)) cp.push(jar);
  return cp.join(process.platform === 'win32' ? ';' : ':');
}

function isLibAllowed(lib) {
  if (!lib.rules) return true;
  let allow = false;
  for (const r of lib.rules) {
    if (r.action === 'allow' && (!r.os || matchesOs(r.os))) allow = true;
    if (r.action === 'disallow' && (!r.os || matchesOs(r.os))) allow = false;
  }
  return allow;
}

function matchesOs(os) {
  const p = process.platform;
  if (os.name === 'windows' && p !== 'win32') return false;
  if (os.name === 'linux' && p !== 'linux') return false;
  if (os.name === 'osx' && p !== 'darwin') return false;
  return true;
}

function getNativesKey(lib) {
  if (!lib.natives) return null;
  const arch = process.arch === 'x64' ? '64' : '32';
  const p = process.platform;
  const k = p === 'win32' ? lib.natives.windows : p === 'linux' ? lib.natives.linux : lib.natives.osx;
  return k?.replace('${arch}', arch) || null;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((res, rej) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { timeout: 30000 }, r => {
      if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location)
        return res(httpGet(r.headers.location));
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
    }).on('error', rej).on('timeout', function () { this.destroy(); rej(new Error('Timeout')); });
  });
}

function httpPost(url, body, extraHeaders = {}) {
  return new Promise((res, rej) => {
    const bs = typeof body === 'string' ? body : JSON.stringify(body);
    const isJson = typeof body !== 'string';
    const u = new URL(url);
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: {
        'Content-Type': isJson ? 'application/json' : 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bs),
        ...extraHeaders
      }
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { res({ status: r.statusCode, data: JSON.parse(d) }); } catch { res({ status: r.statusCode, data: d }); } });
    });
    req.on('error', rej); req.write(bs); req.end();
  });
}

function safeMoveTmp(tmp, dest) {
  try { fs.renameSync(tmp, dest); return; } catch (_) {}
  try {
    fs.copyFileSync(tmp, dest);
    try { fs.unlinkSync(tmp); } catch (_) {}
    return;
  } catch (_) {}
  try {
    const buf = fs.readFileSync(tmp);
    fs.writeFileSync(dest, buf);
    try { fs.unlinkSync(tmp); } catch (_) {}
  } catch (_) {}
}

function cleanStaleTmps(dir) {
  try {
    if (!fs.existsSync(dir)) return;
    let removed = 0;
    const walk = (d, depth) => {
      if (depth > 8) return;
      try {
        for (const f of fs.readdirSync(d)) {
          const fp = path.join(d, f);
          try {
            const st = fs.statSync(fp);
            if (st.isDirectory()) { walk(fp, depth + 1); continue; }
            if (f.endsWith('.tmp')) {
              try { fs.unlinkSync(fp); removed++; } catch (_) {}
            }
          } catch (_) {}
        }
      } catch (_) {}
    };
    walk(dir, 0);
    if (removed > 0) console.log('[Nova] Cleaned ' + removed + ' stale .tmp file(s)');
  } catch (_) {}
}

function downloadFile(url, dest, onProgress) {
  return new Promise((res, rej) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    // Skip if already downloaded and valid
    try {
      const st = fs.statSync(dest);
      if (st.size > 0) { res(dest); return; }
    } catch {}

    // Use unique tmp name to avoid collisions during parallel downloads
    const tmp = dest + '.' + process.pid + '.' + Date.now() + '.tmp';

    // Remove any stale tmp with same pattern
    try {
      const dir = path.dirname(dest);
      const base = path.basename(dest);
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir)) {
          if (f.startsWith(base + '.') && f.endsWith('.tmp')) {
            try { fs.unlinkSync(path.join(dir, f)); } catch {}
          }
        }
      }
    } catch {}

    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      if (err) { try { fs.unlinkSync(tmp); } catch {} rej(err); }
      else res(dest);
    };

    const moveTmp = () => {
      // Triple-fallback move: rename -> copySync+unlink -> readFile+writeFile
      const attempts = [
        () => { fs.renameSync(tmp, dest); },
        () => { fs.copyFileSync(tmp, dest); try { fs.unlinkSync(tmp); } catch {} },
        () => { fs.writeFileSync(dest, fs.readFileSync(tmp)); try { fs.unlinkSync(tmp); } catch {} }
      ];
      for (const attempt of attempts) {
        try { attempt(); return true; } catch {}
      }
      return false;
    };

    const doRequest = (reqUrl, outputStream) => {
      const mod = reqUrl.startsWith('https') ? https : http;
      const req = mod.get(reqUrl, { timeout: 60000 }, r => {
        // Follow redirects
        if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location) {
          r.resume(); // consume body
          outputStream.close(() => {
            // Re-create stream for redirect
            try {
              const newStream = fs.createWriteStream(tmp, { flags: 'w' });
              doRequest(r.headers.location, newStream);
            } catch (e) { done(e); }
          });
          return;
        }

        if (r.statusCode !== 200) {
          r.resume();
          outputStream.close(() => done(new Error('HTTP ' + r.statusCode + ': ' + reqUrl)));
          return;
        }

        const total = parseInt(r.headers['content-length'] || '0');
        let recv = 0;

        r.on('data', chunk => {
          recv += chunk.length;
          if (onProgress && total > 0) onProgress(recv, total);
        });

        r.on('error', err => {
          outputStream.close(() => done(err));
        });

        outputStream.on('error', err => done(err));

        outputStream.on('finish', () => {
          outputStream.close(() => {
            if (moveTmp()) done(null);
            else done(new Error('EPERM: could not move tmp file to ' + dest));
          });
        });

        r.pipe(outputStream);
      });

      req.on('error', err => {
        try { outputStream.close(() => {}); } catch {}
        done(err);
      });

      req.on('timeout', () => {
        req.destroy();
        try { outputStream.close(() => {}); } catch {}
        done(new Error('Timeout: ' + reqUrl));
      });
    };

    try {
      const stream = fs.createWriteStream(tmp, { flags: 'w' });
      doRequest(url, stream);
    } catch (e) {
      done(e);
    }
  });
}

async function parallelDownload(queue, onProgress) {
  const total = queue.length;
  if (!total) return;
  let done = 0;
  const items = [...queue];
  const worker = async () => {
    while (items.length) {
      const item = items.shift();
      if (!item) break;
      for (let i = 0; i < 2; i++) {
        try { await downloadFile(item.url, item.dest); break; } catch { if (i === 1) console.warn('DL fail:', item.url); }
      }
      done++;
      onProgress(done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, total) }, worker));
}

// ─── Microsoft Auth (полный flow из Legacy Launcher) ──────────────────────────
async function completeMSAuth(code, redirectUri) {
  // Шаг 1: Получить MS токен
  const tokenBody = [
    `client_id=${MS_CLIENT_ID}`,
    `code=${encodeURIComponent(code)}`,
    `grant_type=authorization_code`,
    `redirect_uri=${encodeURIComponent(redirectUri)}`,
    `scope=XboxLive.signin+offline_access`
  ].join('&');

  const tokenRes = await httpPost(`${MS_AUTH_URL}/token`, tokenBody);
  if (!tokenRes.data.access_token) throw new Error('MS Token failed: ' + JSON.stringify(tokenRes.data));
  const msToken = tokenRes.data.access_token;
  const refreshToken = tokenRes.data.refresh_token;

  // Шаг 2: Xbox Live auth
  const xblRes = await httpPost(XBOX_AUTH_URL, {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msToken}` },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT'
  });
  if (!xblRes.data.Token) throw new Error('XBL auth failed');
  const xblToken = xblRes.data.Token;
  const userHash = xblRes.data.DisplayClaims?.xui?.[0]?.uhs;

  // Шаг 3: XSTS
  const xstsRes = await httpPost(XSTS_AUTH_URL, {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT'
  });
  if (!xstsRes.data.Token) {
    const xerr = xstsRes.data.XErr;
    if (xerr === 2148916233) throw new Error('У вас нет аккаунта Xbox. Создайте его на xbox.com');
    if (xerr === 2148916238) throw new Error('Аккаунт зарегистрирован как детский. Нужно подтверждение родителей');
    throw new Error(`XSTS error: ${xerr}`);
  }
  const xstsToken = xstsRes.data.Token;

  // Шаг 4: Minecraft auth
  const mcRes = await httpPost(MC_AUTH_URL, {
    identityToken: `XBL3.0 x=${userHash};${xstsToken}`
  });
  if (!mcRes.data.access_token) throw new Error('Minecraft auth failed');
  const mcToken = mcRes.data.access_token;

  // Шаг 5: Проверка владения и профиль
  const profileData = await new Promise((res, rej) => {
    https.get({
      hostname: 'api.minecraftservices.com',
      path: '/minecraft/profile',
      headers: { Authorization: `Bearer ${mcToken}` }
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { res(JSON.parse(d)); } catch { rej(new Error('Profile parse error')); } });
    }).on('error', rej);
  });

  if (profileData.error) {
    // Нет лицензии Minecraft
    throw new Error('Minecraft не куплен для этого аккаунта. Купите на minecraft.net');
  }

  return {
    type: 'microsoft',
    username: profileData.name,
    uuid: profileData.id,
    accessToken: mcToken,
    refreshToken,
    id: profileData.id,
    msToken,
    expiresAt: Date.now() + 3600 * 1000
  };
}

async function refreshMSToken(acc) {
  const body = [
    `client_id=${MS_CLIENT_ID}`,
    `refresh_token=${encodeURIComponent(acc.refreshToken)}`,
    `grant_type=refresh_token`,
    `scope=XboxLive.signin+offline_access`
  ].join('&');
  const tokenRes = await httpPost(`${MS_AUTH_URL}/token`, body);
  if (!tokenRes.data.access_token) throw new Error('Refresh failed');
  return await completeMSAuth(null, null, tokenRes.data.access_token, tokenRes.data.refresh_token);
}

function generateOfflineUUID(username) {
  // Bukkit-совместимый UUID: MD5 от "OfflinePlayer:<username>"
  // Именно так генерирует Legacy Launcher и сервера в offline mode
  const h = crypto.createHash('md5').update('OfflinePlayer:' + username).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-3${h.slice(13, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
