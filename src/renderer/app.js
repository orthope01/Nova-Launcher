// Nova Launcher v3.0 — Renderer (Logic merged with Legacy Launcher)
'use strict';
const api = window.nova;

// ─── Глобальное состояние ─────────────────────────────────────────────────────
const S = {
  config: null, page: 'home', systemInfo: null, installed: [],
  profiles: {}, manifest: null, fabricData: null, forgeData: null,
  versionsTab: 'installed', versionsSearch: '',
  fabricGame: '', fabricLoader: '', forgeGame: '',
  gameRunning: false, gameLogs: [],
  folderProfileId: null, newProfileIcon: 'grass',
  news: [], newsLoaded: false, skinPreviews: {},
  versionUpdates: { vanilla:[], fabric:[], forge:[], newCount:0 },
  launcherVersion: '3.0.0',
  // Mods state
  mods: { hits: [], total: 0, loading: false, query: '', gameVersion: '', loader: 'fabric',
          category: 'all', offset: 0, selected: null, selectedVersions: [],
          downloading: {}, categories: [], gameVersions: [] }
};

// ─── Инициализация ────────────────────────────────────────────────────────────
async function init() {
  try {
    [S.config, S.systemInfo, S.installed, S.profiles, S.launcherVersion] = await Promise.all([
      api.getConfig(), api.getSystemInfo(), api.getInstalled(), api.listProfiles(),
      api.getLauncherVersion().catch(() => '3.0.0')
    ]);
  } catch(e) { console.error('Init error:', e); }

  setupTitlebar();
  setupNav();
  setupGlobalDelegation();
  setupGameListener();

  // Обновляем версию в sidebar
  const sver = byId('sidebar-ver');
  if (sver) sver.textContent = `Nova v${S.launcherVersion}`;

  if (S.config?.firstRun) showWizard();
  else showPage('home');

  // Load news in background
  api.getNews().then(n => { S.news = n; if (S.page === 'home') { const nb = byId('news-block'); if (nb) { nb.innerHTML = renderNews(); renderVersionUpdatePills(); } } });

  // Check for new MC/Fabric/Forge versions in background
  api.checkVersionUpdates && api.checkVersionUpdates().then(upd => {
    if (!upd) return;
    S.versionUpdates = upd;
    // Show badge on versions nav item
    const badge = byId('nav-badge-versions');
    if (badge) {
      if (upd.newCount > 0) { badge.style.display = ''; badge.textContent = upd.newCount; }
      else badge.style.display = 'none';
    }
    // If on home page, add update pills to news column
    if (S.page === 'home') renderVersionUpdatePills();
  }).catch(() => {});
}

// ─── Titlebar ─────────────────────────────────────────────────────────────────
function setupTitlebar() {
  byId('btn-minimize').addEventListener('click', () => api.minimize());
  byId('btn-maximize').addEventListener('click', () => api.maximize());
  byId('btn-close').addEventListener('click', () => api.close());
}

// ─── Навигация ────────────────────────────────────────────────────────────────
function setupNav() {
  qsa('.nav-item').forEach(btn => btn.addEventListener('click', () => showPage(btn.dataset.page)));
}

function showPage(page) {
  S.page = page;
  qsa('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  const content = byId('content');
  if (!content) return;
  switch(page) {
    case 'home':     content.innerHTML = tplHome();     bindHome();     break;
    case 'profiles': content.innerHTML = tplProfiles(); bindProfiles(); break;
    case 'folders':  content.innerHTML = tplFolders();  bindFolders();  break;
    case 'versions': content.innerHTML = tplVersions(); bindVersions(); break;
    case 'mods':     content.innerHTML = tplMods();     bindMods();     break;
    case 'accounts': content.innerHTML = tplAccounts(); bindAccounts(); break;
    case 'settings': content.innerHTML = tplSettings(); bindSettings(); break;
  }
}

// ─── Делегирование событий ────────────────────────────────────────────────────
function setupGlobalDelegation() {
  document.addEventListener('click', handleGlobalClick);
  document.addEventListener('change', handleGlobalChange);
}

function handleGlobalClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action, val = el.dataset.val || '', val2 = el.dataset.val2 || '';
  switch(action) {
    case 'nav':               showPage(val); break;
    case 'select-profile':    doSelectProfile(val); break;
    case 'open-dir':          api.openDir(val); break;
    case 'open-folder':       api.openFolder(val); break;
    case 'open-external':     api.openExternal(val); break;
    case 'change-profile-dir':doChangeProfileDir(val); break;
    case 'delete-profile':    doDeleteProfile(val); break;
    case 'use-version':       doUseVersionInProfile(val); break;
    case 'delete-version':    doDeleteVersion(val); break;
    case 'install-vanilla':   startInstall('vanilla', val); break;
    case 'install-fabric':    doInstallFabric(); break;
    case 'install-forge':     doInstallForge(); break;
    case 'apply-to-profile':  doApplyToProfile(val); break;
    case 'add-files':         doAddFiles(val, val2); break;
    case 'delete-file':       doDeleteFile(val, el.dataset.profile); break;
    case 'remove-account':    doRemoveAccount(val); break;
    case 'set-account':       doSetActiveAccount(val); break;
    case 'set-icon':          doSetIcon(val); break;
    case 'show-new-profile':  toggleNewProfileForm(); break;
    case 'cancel-new-profile':hideNewProfileForm(); break;
    case 'create-profile':    doCreateProfile(); break;
    case 'wizard-browse':     doWizardBrowse(); break;
    case 'wizard-continue':   doWizardContinue(); break;
    case 'launch':            doLaunch(); break;
    case 'launch-server':     doLaunchWithServer(); break;
    case 'open-root-dir':     api.openDir(S.config?.installDir || ''); break;
    case 'save-settings':     doSaveSettings(); break;
    case 'select-java':       doSelectJava(); break;
    case 'change-install-dir':doChangeInstallDir(); break;
    case 'add-offline':       doAddOffline(); break;
    case 'ms-login':          doMsLogin(); break;
    case 'refresh-versions':  doRefreshVersions(); break;
    case 'open-profile-dir':  doOpenProfileDir(); break;
    case 'load-folders':      S.folderProfileId = val; showPage('folders'); break;
    case 'update-ver-select': doUpdateVersionFromSelect(val, el.dataset.version); break;
    case 'set-skin':          doSetSkin(val); break;
    case 'remove-skin':       doRemoveSkin(val); break;
    case 'buy-minecraft':     api.openExternal('https://www.minecraft.net/ru-ru/store/minecraft-java-bedrock-edition-pc'); break;
    case 'namemc':            api.openExternal(`https://namemc.com/profile/${val}`); break;
    case 'copy-uuid':         navigator.clipboard?.writeText(val); toast('UUID скопирован', 'success'); break;
    case 'mod-select':        doModSelect(val); break;
    case 'mod-close':         doModClose(); break;
    case 'mod-download':      doModDownload(val, el.dataset.filename, el.dataset.vid); break;
    case 'mods-load-more':    doModsLoadMore(); break;
    case 'mods-search-btn':   doModsSearch(); break;
  }
}

function handleGlobalChange(e) {
  const el = e.target;
  if (el.id === 'home-ram-slider') { const d = byId('home-ram-display'); if (d) d.textContent = el.value + ' MB'; }
  if (el.id === 's-ram-min') byId('s-ram-min-d').textContent = el.value + ' MB';
  if (el.id === 's-ram-max') byId('s-ram-max-d').textContent = el.value + ' MB';
  if (el.id === 'version-search') { S.versionsSearch = el.value; refreshVersionsTab(); }
  if (el.id === 'fabric-game-ver') S.fabricGame = el.value;
  if (el.id === 'fabric-loader-ver') S.fabricLoader = el.value;
  if (el.id === 'forge-game-ver') S.forgeGame = el.value;
  if (el.id === 'folder-profile-sel') doLoadFolders(el.value);
  if (el.dataset.action === 'ver-select') doUpdateVersionFromSelect(el.dataset.profileId, el.value);
  if (el.id === 'mods-game-ver') { S.mods.gameVersion = el.value; doModsSearch(); }
  if (el.id === 'mods-loader')   { S.mods.loader = el.value; doModsSearch(); }
  if (el.id === 'mods-category') { S.mods.category = el.value; doModsSearch(); }
  if (el.id === 'mods-profile-sel') S.mods.targetProfile = el.value;
}

// ─── МАСТЕР ПЕРВОГО ЗАПУСКА ───────────────────────────────────────────────────
function showWizard() {
  const ov = document.createElement('div');
  ov.id = 'wizard-overlay';
  ov.style.cssText = 'position:fixed;inset:0;background:#0d0f14;z-index:9999;display:flex;align-items:center;justify-content:center;';
  const defDir = S.systemInfo?.defaultInstallDir || '';
  ov.innerHTML = `
  <div style="width:540px;text-align:center;padding:40px;">
    <div style="font-size:52px;margin-bottom:12px">🟢</div>
    <h1 style="font-size:26px;font-weight:800;margin-bottom:8px;">Добро пожаловать в <span style="color:var(--accent)">Nova Launcher</span></h1>
    <p style="color:var(--text-secondary);margin-bottom:28px;font-size:14px;">
      Выберите папку куда будет установлен лаунчер.<br>
      Там будут храниться версии, библиотеки и профили.
    </p>
    <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:22px;margin-bottom:20px;text-align:left;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);margin-bottom:8px;">Папка установки</div>
      <div style="display:flex;gap:8px;">
        <input id="wizard-dir" class="form-input" style="flex:1;font-family:var(--font-mono);font-size:12px;" value="${esc(defDir)}" placeholder="Выберите папку...">
        <button class="btn btn-secondary" data-action="wizard-browse">Обзор</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:20px;">
      ${[['🧩','Моды'],['🎨','Ресурспаки'],['🌍','Профили']].map(([i,n])=>`
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center;">
        <div style="font-size:22px;margin-bottom:4px">${i}</div>
        <div style="font-size:12px;font-weight:600">${n}</div>
      </div>`).join('')}
    </div>
    <button class="btn btn-primary" data-action="wizard-continue" style="width:100%;padding:13px;font-size:15px;">
      Продолжить →
    </button>
  </div>`;
  document.body.appendChild(ov);
}

async function doWizardBrowse() {
  const p = await api.selectInstallDir();
  if (p) { const inp = byId('wizard-dir'); if (inp) inp.value = p; }
}

async function doWizardContinue() {
  const inp = byId('wizard-dir');
  const dir = inp?.value?.trim();
  if (!dir) { toast('Укажите папку установки', 'error'); return; }
  const btn = document.querySelector('[data-action="wizard-continue"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Создание папок...'; }
  S.config   = await api.completeFirstRun(dir);
  S.profiles = await api.listProfiles();
  S.installed = await api.getInstalled();
  byId('wizard-overlay')?.remove();
  showPage('home');
  toast('Nova Launcher настроен! 🎮', 'success', 4000);
}

// ─── Новости ──────────────────────────────────────────────────────────────────
function renderNews() {
  if (!S.news.length) return `<div style="color:var(--text-muted);font-size:12px;padding:8px 0;">Нет новостей или нет соединения</div>`;
  return S.news.slice(0,4).map(n => `
  <div class="news-card">
    <div class="news-title">${esc(n.title)}</div>
    <div class="news-meta">
      <span class="news-version">${esc(n.version || '')}</span>
      <span style="color:var(--text-muted);font-size:10px;">${n.date ? new Date(n.date).toLocaleDateString('ru') : ''}</span>
    </div>
  </div>`).join('');
}

// ─── Version update pills ────────────────────────────────────────────────────
function renderVersionUpdatePills() {
  const upd = S.versionUpdates;
  const newsBlock = byId('news-block');
  if (!newsBlock) return;
  // Remove old pills
  newsBlock.querySelectorAll('.update-pill').forEach(el => el.remove());
  // Add new pills at top
  const allNew = [...upd.vanilla.filter(v=>v.isNew), ...upd.fabric.filter(v=>v.isNew), ...upd.forge.filter(v=>v.isNew)];
  if (!allNew.length) return;
  const pillsHtml = allNew.slice(0,3).map(v => `
  <div class="news-card update-pill" style="border-color:rgba(251,191,36,.4);cursor:pointer;" data-action="nav" data-val="versions">
    <div class="news-card-title" style="font-size:11px;">🆕 Новая версия!</div>
    <div class="news-card-meta">
      <span class="news-version">${esc(v.id.length > 20 ? v.label : v.id)}</span>
      <span class="news-card-new">Доступна</span>
    </div>
  </div>`).join('');
  newsBlock.insertAdjacentHTML('afterbegin', pillsHtml);
}

// ─── HOME ─────────────────────────────────────────────────────────────────────
function tplHome() {
  const account   = getActiveAccount();
  const profileId = S.config?.selectedProfile || 'default';
  const profile   = S.profiles[profileId] || { name: 'По умолчанию', icon: 'grass' };
  const versionId = profile.versionId || null;
  const profiles  = Object.values(S.profiles);
  const savedServer = S.config?.serverAddress || '';
  const savedPort   = S.config?.serverPort || '25565';

  return `<div class="page" id="page-home">
  <div class="home-layout">
    <div class="home-hero">
      <div class="home-hero-bg"></div><div class="hero-grid"></div>
      <div class="home-hero-content">
        <div class="hero-title">Nova <span class="accent">Launcher</span></div>
        <div class="hero-sub">Свободный лаунчер Minecraft • Совместим с Legacy Launcher</div>
      </div>
    </div>

    <div class="home-right">
      <div class="launch-panel">
        <div class="launch-panel-title">Профиль</div>
        <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px;max-height:160px;overflow-y:auto;">
          ${profiles.map(p => `
          <div class="profile-option ${p.id === profileId ? 'active' : ''}" data-action="select-profile" data-val="${esc(p.id)}" style="cursor:pointer;">
            <span style="font-size:18px">${profileEmoji(p.icon)}</span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</div>
              <div style="font-size:11px;color:var(--text-muted)">${p.versionId ? esc(p.versionId) : 'Версия не выбрана'}</div>
            </div>
            ${p.id === profileId ? '<span style="color:var(--accent);font-size:14px">✓</span>' : ''}
          </div>`).join('')}
        </div>
        <button class="btn btn-ghost" data-action="nav" data-val="profiles" style="width:100%;font-size:12px;">+ Управление профилями</button>
      </div>

      <div class="launch-panel">
        <div class="launch-panel-title">Запуск</div>
        <div class="account-preview" data-action="nav" data-val="accounts" style="cursor:pointer;margin-bottom:10px;${!account ? 'border-color:var(--danger)' : ''}">
          ${account ? renderAccountAvatar(account, 36) : ''}
          <div class="account-info">
            <div class="account-name" style="${!account ? 'color:var(--danger)' : ''}">${account ? esc(account.username) : 'Аккаунт не выбран'}</div>
            <div class="account-type">${account ? (account.type === 'microsoft' ? '🔷 Microsoft (лицензия)' : account.skinData ? '🎨 Оффлайн (скин)' : '🔲 Оффлайн') : 'Нажмите для входа'}</div>
          </div>
        </div>
        <div class="ram-control">
          <div class="ram-label"><span>ОЗУ для игры</span><span id="home-ram-display">${S.config?.ram?.max || 2048} MB</span></div>
          <input type="range" id="home-ram-slider" min="512" max="${Math.min(S.systemInfo?.totalMem || 8192, 16384)}" step="256" value="${S.config?.ram?.max || 2048}">
        </div>
        <button class="btn btn-primary" id="btn-launch" data-action="launch" ${!account || !versionId ? 'disabled' : ''} style="font-size:15px;letter-spacing:.05em;width:100%;">
          ${S.gameRunning ? '⏳ Запущена' : !versionId ? 'Выберите версию' : '▶ ИГРАТЬ'}
        </button>
        ${!versionId ? `<div style="margin-top:6px;text-align:center;font-size:11px;color:var(--warn);">⚠️ <span data-action="nav" data-val="profiles" style="color:var(--accent2);cursor:pointer;text-decoration:underline">Выбрать версию в профиле</span></div>` : ''}
      </div>

      <div class="launch-panel server-panel">
        <div class="launch-panel-title">🌐 Подключиться к серверу</div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">Запустить сразу на сервере (как в Legacy Launcher)</div>
        <div class="server-input-row">
          <input class="form-input server-input-addr" id="srv-addr" placeholder="play.example.com" value="${esc(savedServer)}">
          <input class="form-input server-input-port" id="srv-port" placeholder="25565" value="${esc(savedPort)}">
        </div>
        <button class="btn btn-secondary" id="btn-launch-server" data-action="launch-server"
          ${!account || !versionId ? 'disabled' : ''} style="width:100%;margin-top:8px;font-size:13px;">
          ⚡ Запустить на сервере
        </button>
        <div style="font-size:10px;color:var(--text-muted);margin-top:5px;line-height:1.4;">
          quickPlay (1.20+) и --server (все версии с 1.3+)
        </div>
      </div>
    </div>

    <div class="home-bottom">
      <div class="home-bottom-inner">
        <div class="home-log-col">
          <div class="col-label">Журнал игры</div>
          <div class="game-log" id="game-log">
            ${S.gameLogs.length ? S.gameLogs.map(l => `<div class="log-line ${l.cls}">${esc(l.text)}</div>`).join('') : '<div class="log-line text-muted" style="font-size:11px">Журнал появится после запуска...</div>'}
          </div>
        </div>
        <div class="home-news-col">
          <div class="col-label">Версии и новости</div>
          <div class="news-scroll" id="news-block">
            ${S.news.length ? renderNews() : '<div class="text-muted text-xs">Загрузка...</div>'}
          </div>
        </div>
      </div>
      <div class="status-bar">
        <div class="status-dot ${S.gameRunning ? 'running' : 'online'}" id="status-dot"></div>
        <span id="status-text">${S.gameRunning ? 'Игра запущена' : 'Готов к запуску'}</span>
        <span style="margin-left:auto;color:var(--text-muted);font-size:11px;">Nova v${esc(S.launcherVersion)}</span>
      </div>
    </div>
  </div>
</div>`;
}


function bindHome() {
  const logEl = byId('game-log');
  if (logEl) logEl.scrollTop = logEl.scrollHeight;
  // Show version update pills if data already loaded
  renderVersionUpdatePills();
  const slider = byId('home-ram-slider');
  if (slider) {
    slider.addEventListener('change', async () => {
      const val = parseInt(slider.value);
      S.config = await api.setConfig({ ram: { min: Math.round(val * 0.25), max: val } });
    });
  }
}

async function doSelectProfile(id) {
  S.config = await api.setActiveProfile(id);
  S.profiles = await api.listProfiles();
  showPage('home');
}

async function doLaunch() {
  if (S.gameRunning) { toast('Игра уже запущена', 'info'); return; }
  const account   = getActiveAccount();
  const profileId = S.config?.selectedProfile || 'default';
  const profile   = S.profiles[profileId];
  const versionId = profile?.versionId;
  if (!account)   { toast('Выберите аккаунт', 'error'); return; }
  if (!versionId) { toast('В профиле не выбрана версия', 'error'); return; }
  const btn = byId('btn-launch');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Запуск...'; }
  const result = await api.launchGame({ versionId, account, profileId });
  if (!result.success) {
    toast('Ошибка: ' + result.error, 'error', 6000);
    if (btn) { btn.disabled = false; btn.textContent = '▶ ИГРАТЬ'; }
  }
}

async function doLaunchWithServer() {
  if (S.gameRunning) { toast('Игра уже запущена', 'info'); return; }
  const account   = getActiveAccount();
  const profileId = S.config?.selectedProfile || 'default';
  const profile   = S.profiles[profileId];
  const versionId = profile?.versionId;
  const addr = byId('srv-addr')?.value?.trim();
  const port = byId('srv-port')?.value?.trim() || '25565';
  if (!account)   { toast('Выберите аккаунт', 'error'); return; }
  if (!versionId) { toast('В профиле не выбрана версия', 'error'); return; }
  if (!addr)      { toast('Введите адрес сервера', 'error'); return; }

  // Сохраняем адрес сервера
  S.config = await api.setConfig({ serverAddress: addr, serverPort: port });

  const btn = byId('btn-launch-server');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Запуск...'; }

  const result = await api.launchGame({ versionId, account, profileId, serverAddress: addr, serverPort: port });
  if (!result.success) {
    toast('Ошибка: ' + result.error, 'error', 6000);
    if (btn) { btn.disabled = false; btn.textContent = '⚡ Запустить на сервере'; }
  }
}


// ─── ПРОФИЛИ ──────────────────────────────────────────────────────────────────
function tplProfiles() {
  const profiles = Object.values(S.profiles);
  const activeId = S.config?.selectedProfile;
  return `<div class="page" id="page-profiles">
  <div class="page-header">
    <div><div class="page-title">Профили</div><div class="page-subtitle">Разные версии, моды и настройки для каждого профиля</div></div>
    <button class="btn btn-primary" data-action="show-new-profile">+ Новый профиль</button>
  </div>
  <div class="page-body">
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;" id="profiles-grid">
    ${profiles.map(p => `
    <div class="profile-card ${p.id === activeId ? 'active-profile' : ''}">
      <div class="profile-card-header">
        <span class="profile-icon-big">${profileEmoji(p.icon)}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:15px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p.name)}</div>
          <div style="font-size:11px;color:var(--text-muted);">${p.versionId ? esc(p.versionId) : '— версия не выбрана —'}</div>
        </div>
        ${p.id === activeId ? '<span style="font-size:10px;color:var(--accent);font-weight:700;border:1px solid var(--accent-dim);padding:2px 8px;border-radius:99px;white-space:nowrap;">Активен</span>' : ''}
      </div>
      <div class="profile-dir-row" style="cursor:pointer;" data-action="open-dir" data-val="${esc(p.gameDir || '')}" title="Открыть папку">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <span style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">
          ${p.gameDir ? esc(p.gameDir) : 'profiles/' + p.id + ' (авто)'}
        </span>
        <button class="btn btn-ghost" data-action="change-profile-dir" data-val="${esc(p.id)}" style="padding:1px 6px;font-size:11px;">📂</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr auto;gap:6px;margin-top:8px;">
        <select class="select-styled" style="font-size:12px;" data-action="ver-select" data-profile-id="${esc(p.id)}">
          <option value="">— версия —</option>
          ${S.installed.map(v => `<option value="${esc(v)}" ${v === p.versionId ? 'selected' : ''}>${esc(v)}</option>`).join('')}
        </select>
        <button class="btn btn-ghost" data-action="nav" data-val="versions" style="font-size:12px;padding:7px 10px;">+</button>
      </div>
      <div style="display:flex;gap:6px;margin-top:10px;">
        ${p.id !== activeId ? `<button class="btn btn-primary" data-action="select-profile" data-val="${esc(p.id)}" style="flex:1;padding:7px;font-size:12px;">✓ Выбрать</button>` : ''}
        <button class="btn btn-secondary" data-action="load-folders" data-val="${esc(p.id)}" style="flex:1;padding:7px;font-size:12px;">📁 Файлы</button>
        ${p.id !== 'default' ? `<button class="btn btn-danger" data-action="delete-profile" data-val="${esc(p.id)}" style="padding:7px 10px;font-size:12px;">✕</button>` : ''}
      </div>
    </div>`).join('')}
  </div>

  <div id="new-profile-form" style="display:none;margin-top:20px;">
    <div style="background:var(--bg-surface);border:1px solid var(--accent-dim);border-radius:12px;padding:20px;max-width:480px;">
      <div style="font-size:14px;font-weight:700;margin-bottom:16px;color:var(--accent);">Новый профиль</div>
      <div class="form-group">
        <label class="form-label">Название</label>
        <input class="form-input" id="np-name" placeholder="Мой Fabric профиль">
      </div>
      <div class="form-group">
        <label class="form-label">Версия</label>
        <select class="select-styled" id="np-version">
          <option value="">— выбрать позже —</option>
          ${S.installed.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Иконка</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;" id="icon-picker">
          ${['grass','diamond','redstone','creeper','sword','bow','book','potion'].map(i => `
          <div class="icon-option ${i === S.newProfileIcon ? 'selected' : ''}" data-action="set-icon" data-val="${i}">${profileEmoji(i)}</div>`).join('')}
        </div>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary" data-action="create-profile">Создать</button>
        <button class="btn btn-ghost" data-action="cancel-new-profile">Отмена</button>
      </div>
    </div>
  </div>
  </div>
</div>`;
}

function bindProfiles() {}
function doSetIcon(icon) { S.newProfileIcon = icon; qsa('.icon-option').forEach(el => el.classList.toggle('selected', el.dataset.val === icon)); }
function toggleNewProfileForm() { const f = byId('new-profile-form'); if (f) f.style.display = f.style.display === 'none' ? 'block' : 'none'; }
function hideNewProfileForm() { const f = byId('new-profile-form'); if (f) f.style.display = 'none'; }

async function doCreateProfile() {
  const name = byId('np-name')?.value?.trim();
  const versionId = byId('np-version')?.value || null;
  if (!name) { toast('Введите название', 'error'); return; }
  const p = await api.createProfile({ name, icon: S.newProfileIcon, versionId });
  await api.ensureProfileFolders(p.id);
  S.profiles = await api.listProfiles();
  S.config   = await api.getConfig();
  toast(`Профиль "${name}" создан`, 'success');
  showPage('profiles');
}

async function doChangeProfileDir(profileId) {
  const newDir = await api.selectProfileGameDir(profileId);
  if (newDir) { S.profiles = await api.listProfiles(); toast('Папка профиля изменена', 'success'); showPage('profiles'); }
}

async function doDeleteProfile(id) {
  if (!confirm('Удалить профиль? Файлы игры не будут удалены.')) return;
  await api.deleteProfile(id);
  S.profiles = await api.listProfiles();
  S.config   = await api.getConfig();
  toast('Профиль удалён', 'info');
  showPage('profiles');
}

async function doUpdateVersionFromSelect(profileId, versionId) {
  await api.updateProfile(profileId, { versionId: versionId || null });
  S.profiles = await api.listProfiles();
  toast('Версия обновлена', 'success');
}

// ─── ФАЙЛОВЫЙ МЕНЕДЖЕР ────────────────────────────────────────────────────────
const FOLDERS_META_DISPLAY = [
  { id:'mods', name:'Моды', icon:'🧩', desc:'Файлы .jar модов', ext:['jar'] },
  { id:'resourcepacks', name:'Ресурспаки', icon:'🎨', desc:'Архивы .zip', ext:['zip'] },
  { id:'shaderpacks', name:'Шейдеры', icon:'✨', desc:'Архивы .zip шейдеров', ext:['zip'] },
  { id:'saves', name:'Миры', icon:'🌍', desc:'Папки сохранений', ext:[] },
  { id:'screenshots', name:'Скриншоты', icon:'📷', desc:'Снимки экрана', ext:['png','jpg'] },
  { id:'logs', name:'Логи', icon:'📋', desc:'Журналы работы', ext:['log','gz','txt'] },
  { id:'config', name:'Конфиги', icon:'⚙️', desc:'Настройки модов', ext:[] },
  { id:'crash-reports', name:'Краши', icon:'💥', desc:'Отчёты об ошибках', ext:['txt'] },
  { id:'datapacks', name:'Датапаки', icon:'📦', desc:'Датапаки для миров', ext:['zip'] },
];

function tplFolders() {
  const profiles  = Object.values(S.profiles);
  const profileId = S.folderProfileId || S.config?.selectedProfile || 'default';
  const profile   = S.profiles[profileId] || { name: 'По умолчанию', icon: 'grass' };
  return `<div class="page" id="page-folders">
  <div class="page-header">
    <div><div class="page-title">Файловый менеджер</div><div class="page-subtitle">Моды, ресурспаки, миры и другие файлы</div></div>
    <div style="display:flex;gap:8px;align-items:center;">
      <select class="select-styled" id="folder-profile-sel" style="width:180px;">
        ${profiles.map(p => `<option value="${esc(p.id)}" ${p.id === profileId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
      <button class="btn btn-secondary" data-action="open-profile-dir">📂 Открыть</button>
    </div>
  </div>
  <div class="page-body">
  <div style="margin-bottom:12px;padding:10px 14px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;display:flex;align-items:center;gap:10px;">
    <span style="font-size:22px;">${profileEmoji(profile.icon)}</span>
    <div>
      <div style="font-size:13px;font-weight:600;">${esc(profile.name)}</div>
      <div id="folders-dir-txt" style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">Загрузка...</div>
    </div>
  </div>
  <div id="folders-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">
    <div class="loading-state" style="grid-column:1/-1;"><div class="spinner"></div> Загрузка файлов...</div>
  </div>
  </div>
</div>`;
}

async function bindFolders() { await doLoadFolders(S.folderProfileId || S.config?.selectedProfile || 'default'); }

async function doOpenProfileDir() {
  const sel = byId('folder-profile-sel');
  const pid = sel?.value || S.config?.selectedProfile || 'default';
  api.openDir(await api.getProfileDir(pid));
}

async function doLoadFolders(profileId) {
  S.folderProfileId = profileId;
  const sel = byId('folder-profile-sel'); if (sel) sel.value = profileId;
  const grid = byId('folders-grid'), dirTxt = byId('folders-dir-txt');
  if (!grid) return;
  grid.innerHTML = '<div class="loading-state" style="grid-column:1/-1;"><div class="spinner"></div> Загрузка...</div>';
  await api.ensureFolders(profileId);
  const dir = await api.getProfileDir(profileId);
  if (dirTxt) dirTxt.textContent = dir;
  const folders = await api.listFolders(profileId);
  grid.innerHTML = folders.map(f => `
  <div class="folder-card">
    <div class="folder-card-header">
      <span style="font-size:24px;">${f.icon}</span>
      <div style="flex:1;">
        <div style="font-size:14px;font-weight:700;">${f.name}</div>
        <div style="font-size:11px;color:var(--text-muted);">${f.desc}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:13px;font-weight:600;color:var(--accent);">${f.count}</div>
        <div style="font-size:10px;color:var(--text-muted);">${f.sizeStr}</div>
      </div>
    </div>
    ${f.items.length > 0 ? `
    <div class="folder-files">
      ${f.items.map(item => `
      <div class="folder-file-row">
        <span style="font-size:12px;">${item.isDir ? '📁' : fileIcon(item.name)}</span>
        <span style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(item.name)}">${esc(item.name)}</span>
        <span style="font-size:10px;color:var(--text-muted);margin:0 4px;">${item.sizeStr}</span>
        <button class="btn btn-ghost" data-action="delete-file" data-val="${esc(f.path + '/' + item.name)}" data-profile="${esc(profileId)}" style="padding:1px 5px;font-size:10px;color:var(--danger);">✕</button>
      </div>`).join('')}
    </div>` : ''}
    <button class="btn btn-secondary" data-action="add-files" data-val="${esc(profileId)}" data-val2="${esc(f.id)}" style="width:100%;margin-top:8px;font-size:12px;padding:6px;">
      + Добавить файлы
    </button>
  </div>`).join('');
}

async function doAddFiles(profileId, folderId) {
  const folder = FOLDERS_META_DISPLAY.find(f => f.id === folderId);
  const result = await api.addFiles({ profileId, folderId, ext: folder?.ext });
  if (result.success) { toast(`Добавлено: ${result.copied.join(', ')}`, 'success'); await doLoadFolders(profileId); }
  else if (!result.success && !result.error) {} // cancelled
  else toast('Ошибка: ' + result.error, 'error');
}

async function doDeleteFile(filePath, profileId) {
  const result = await api.deleteFile(filePath);
  if (result.success) { toast('Файл удалён', 'info'); await doLoadFolders(profileId || S.folderProfileId); }
  else toast('Ошибка: ' + result.error, 'error');
}

// ─── ВЕРСИИ ───────────────────────────────────────────────────────────────────
function tplVersions() {
  return `<div class="page" id="page-versions" style="display:flex;flex-direction:column;height:100%;overflow:hidden;">
  <div class="page-header">
    <div><div class="page-title">Версии</div><div class="page-subtitle">Установка и управление версиями Minecraft</div></div>
    <button class="btn btn-secondary" data-action="refresh-versions">↺ Обновить</button>
  </div>
  <div class="tabs">
    <button class="tab-btn ${S.versionsTab === 'installed' ? 'active' : ''}" data-tab="installed">✓ Установленные</button>
    <button class="tab-btn ${S.versionsTab === 'vanilla' ? 'active' : ''}" data-tab="vanilla">🌍 Vanilla</button>
    <button class="tab-btn ${S.versionsTab === 'fabric' ? 'active' : ''}" data-tab="fabric">🧵 Fabric</button>
    <button class="tab-btn ${S.versionsTab === 'forge' ? 'active' : ''}" data-tab="forge">🔨 Forge</button>
  </div>
  <div id="vtab" style="flex:1;overflow-y:auto;overflow-x:hidden;min-height:0;padding:var(--pad-md);">${tplVersionsTab()}</div>
</div>`;
}

function tplVersionsTab() {
  if (S.versionsTab === 'installed') return tplInstalled();
  if (S.versionsTab === 'vanilla')   return tplVanilla();
  if (S.versionsTab === 'fabric')    return tplFabric();
  if (S.versionsTab === 'forge')     return tplForge();
  return '';
}

function tplInstalled() {
  if (!S.installed.length) return `<div class="empty-state"><div>Нет установленных версий</div><div class="text-sm text-muted" style="margin-top:6px;">Перейдите на вкладку Vanilla, Fabric или Forge</div></div>`;
  // Also show new available versions at top
  const allNew = [...(S.versionUpdates.vanilla||[]).filter(v=>v.isNew), ...(S.versionUpdates.fabric||[]).filter(v=>v.isNew), ...(S.versionUpdates.forge||[]).filter(v=>v.isNew)];
  const newCards = allNew.map(v => `
  <div class="version-card new-available">
    <div class="version-card-id">${esc(v.id.length > 20 ? v.label : v.id)}</div>
    <div class="version-card-type">${esc(v.label)}</div>
    <div class="version-card-badge badge-new">🆕 Новая!</div>
    <button class="btn btn-primary" data-action="nav" data-val="versions" style="width:100%;margin-top:10px;padding:7px;font-size:12px;">
      ⬇ Установить
    </button>
  </div>`).join('');
  return `<div class="versions-grid">${newCards}${S.installed.map(v => `
  <div class="version-card installed">
    <div class="version-card-id">${esc(v)}</div>
    <div class="version-card-type">${versionType(v)}</div>
    <div class="version-card-badge badge-installed">✓ Установлен</div>
    <div style="display:flex;gap:6px;margin-top:10px;">
      <button class="btn btn-primary" data-action="use-version" data-val="${esc(v)}" style="flex:1;padding:7px;font-size:12px;">В профиль</button>
      <button class="btn btn-danger" data-action="delete-version" data-val="${esc(v)}" style="padding:7px 10px;">✕</button>
    </div>
  </div>`).join('')}</div>`;
}

function tplVanilla() {
  if (!S.manifest) return `<div class="loading-state"><div class="spinner"></div> Загрузка списка версий...</div>`;
  const list = S.manifest.versions.filter(v => {
    const ok = v.type === 'release' || v.type === 'snapshot';
    return S.versionsSearch ? v.id.toLowerCase().includes(S.versionsSearch.toLowerCase()) : ok;
  }).slice(0, 80);
  return `
  <div class="search-wrap" style="margin-bottom:14px;">
    <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    <input class="search-input" id="version-search" placeholder="Поиск версии..." value="${esc(S.versionsSearch)}">
  </div>
  <div class="versions-grid">
    ${list.map(v => {
      const inst = S.installed.includes(v.id);
      return `<div class="version-card ${inst ? 'installed' : ''}">
        <div class="version-card-id">${esc(v.id)}</div>
        <div class="version-card-type">${new Date(v.releaseTime).toLocaleDateString('ru')}</div>
        <div class="version-card-badge ${v.type === 'release' ? 'badge-release' : 'badge-snapshot'}">${v.type === 'release' ? '● Релиз' : '◎ Снапшот'}</div>
        <button class="btn btn-secondary" data-action="${inst ? 'use-version' : 'install-vanilla'}" data-val="${esc(v.id)}"
          style="width:100%;margin-top:10px;padding:7px;font-size:12px;">
          ${inst ? '✓ В профиль' : '⬇ Установить'}
        </button>
      </div>`;
    }).join('')}
  </div>`;
}

function tplFabric() {
  if (!S.fabricData) return `<div class="loading-state"><div class="spinner"></div> Загрузка Fabric...</div>`;
  const { games, loaders } = S.fabricData;
  if (!S.fabricGame && games.length) S.fabricGame = games[0].version;
  if (!S.fabricLoader && loaders.length) S.fabricLoader = loaders[0].version;
  return `
  <div class="loader-install-panel">
    <div class="loader-logo fabric-logo">🧵</div>
    <div style="flex:1;">
      <div style="font-size:16px;font-weight:700;margin-bottom:4px;">Fabric Loader</div>
      <div style="font-size:12px;color:var(--text-muted);">Лёгкий модлоадер. Рекомендуется для большинства модов.</div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:12px;max-width:560px;margin-bottom:20px;align-items:end;">
    <div>
      <div class="form-label">Версия Minecraft</div>
      <select class="select-styled" id="fabric-game-ver">
        ${games.map(g => `<option value="${esc(g.version)}" ${g.version === S.fabricGame ? 'selected' : ''}>${esc(g.version)}</option>`).join('')}
      </select>
    </div>
    <div>
      <div class="form-label">Версия загрузчика</div>
      <select class="select-styled" id="fabric-loader-ver">
        ${loaders.map(l => `<option value="${esc(l.version)}" ${l.version === S.fabricLoader ? 'selected' : ''}>${esc(l.version)}</option>`).join('')}
      </select>
    </div>
    <button class="btn btn-primary" data-action="install-fabric" style="padding:9px 20px;">⬇ Установить</button>
  </div>
  <div>
    <div class="section-header">Установленные Fabric профили</div>
    <div class="versions-grid">
      ${S.installed.filter(v => v.startsWith('fabric-')).map(v => `
      <div class="version-card installed">
        <div class="version-card-id" style="font-size:12px;">${esc(v)}</div>
        <div class="version-card-badge badge-fabric">🧵 Fabric</div>
        <div style="display:flex;gap:6px;margin-top:8px;">
          <button class="btn btn-secondary" data-action="use-version" data-val="${esc(v)}" style="flex:1;padding:7px;font-size:12px;">В профиль</button>
          <button class="btn btn-danger" data-action="delete-version" data-val="${esc(v)}" style="padding:7px 10px;">✕</button>
        </div>
      </div>`).join('') || '<div class="text-muted text-sm">Нет Fabric профилей</div>'}
    </div>
  </div>`;
}

function tplForge() {
  if (!S.forgeData) return `<div class="loading-state"><div class="spinner"></div> Загрузка Forge...</div>`;
  if (S.forgeData.error) return `<div class="empty-state"><div style="color:var(--danger)">⚠ Ошибка загрузки Forge</div><div class="text-sm text-muted">${esc(S.forgeData.error)}</div></div>`;
  const versions = S.forgeData.versions || {};
  const mcVersions = Object.keys(versions).sort((a,b) => {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i=0; i<3; i++) { if ((pa[i]||0) !== (pb[i]||0)) return (pb[i]||0)-(pa[i]||0); }
    return 0;
  });
  if (!S.forgeGame && mcVersions.length) S.forgeGame = mcVersions[0];
  const cur = S.forgeGame && versions[S.forgeGame];
  return `
  <div class="loader-install-panel">
    <div class="loader-logo forge-logo">🔨</div>
    <div style="flex:1;">
      <div style="font-size:16px;font-weight:700;margin-bottom:4px;">Minecraft Forge</div>
      <div style="font-size:12px;color:var(--text-muted);">Популярный модлоадер. Требует JDK и ~5-10 минут установки.</div>
    </div>
  </div>
  <div style="background:var(--bg-surface);border:1px solid var(--warn);border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:var(--warn);display:flex;gap:8px;align-items:center;">
    ⚠️ Forge installer запускается автоматически. Убедитесь что установлена Java 8 или 11 (для старых версий) или Java 17/21 (для 1.17+).
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:12px;max-width:560px;margin-bottom:20px;align-items:end;">
    <div>
      <div class="form-label">Версия Minecraft</div>
      <select class="select-styled" id="forge-game-ver">
        ${mcVersions.map(v => `<option value="${esc(v)}" ${v === S.forgeGame ? 'selected' : ''}>${esc(v)}</option>`).join('')}
      </select>
    </div>
    <div>
      <div class="form-label">Версия Forge</div>
      <div style="padding:9px 12px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:12px;font-family:var(--font-mono);">
        ${cur ? `${cur.recommended ? '★ ' + cur.recommended + ' (стабильная)' : cur.latest + ' (latest)'}` : '— нет данных —'}
      </div>
    </div>
    <button class="btn btn-primary" data-action="install-forge" ${!cur ? 'disabled' : ''} style="padding:9px 20px;">⬇ Установить</button>
  </div>
  <div>
    <div class="section-header">Установленные Forge профили</div>
    <div class="versions-grid">
      ${S.installed.filter(v => v.includes('-forge') || v.includes('forge-')).map(v => `
      <div class="version-card installed">
        <div class="version-card-id" style="font-size:12px;">${esc(v)}</div>
        <div class="version-card-badge badge-forge">🔨 Forge</div>
        <div style="display:flex;gap:6px;margin-top:8px;">
          <button class="btn btn-secondary" data-action="use-version" data-val="${esc(v)}" style="flex:1;padding:7px;font-size:12px;">В профиль</button>
          <button class="btn btn-danger" data-action="delete-version" data-val="${esc(v)}" style="padding:7px 10px;">✕</button>
        </div>
      </div>`).join('') || '<div class="text-muted text-sm">Нет Forge профилей</div>'}
    </div>
  </div>`;
}

function bindVersions() {
  qsa('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      S.versionsTab = btn.dataset.tab;
      qsa('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      refreshVersionsTab();
      // Hide badge when user visits versions page
  const badge = byId('nav-badge-versions');
  if (badge) badge.style.display = 'none';
  if (S.versionsTab === 'vanilla' && !S.manifest) loadManifest();
      if (S.versionsTab === 'fabric' && !S.fabricData) loadFabric();
      if (S.versionsTab === 'forge' && !S.forgeData) loadForge();
    });
  });
  if (S.versionsTab === 'vanilla' && !S.manifest) loadManifest();
  if (S.versionsTab === 'fabric' && !S.fabricData) loadFabric();
  if (S.versionsTab === 'forge' && !S.forgeData) loadForge();

  // forge version change
  document.addEventListener('change', e => {
    if (e.target.id === 'forge-game-ver') { S.forgeGame = e.target.value; refreshVersionsTab(); }
  }, { once: false });
}

function refreshVersionsTab() { const vtab = byId('vtab'); if (vtab) vtab.innerHTML = tplVersionsTab(); }

async function loadManifest() {
  const vtab = byId('vtab');
  if (vtab) vtab.innerHTML = '<div class="loading-state"><div class="spinner"></div> Загрузка...</div>';
  S.manifest = await api.getManifest();
  if (vtab) vtab.innerHTML = tplVersionsTab();
}

async function loadFabric() {
  const vtab = byId('vtab');
  if (vtab) vtab.innerHTML = '<div class="loading-state"><div class="spinner"></div> Загрузка Fabric...</div>';
  S.fabricData = await api.getFabric();
  if (S.fabricData.games?.length) S.fabricGame = S.fabricData.games[0].version;
  if (S.fabricData.loaders?.length) S.fabricLoader = S.fabricData.loaders[0].version;
  if (vtab) vtab.innerHTML = tplVersionsTab();
}

async function loadForge() {
  const vtab = byId('vtab');
  if (vtab) vtab.innerHTML = '<div class="loading-state"><div class="spinner"></div> Загрузка Forge...</div>';
  S.forgeData = await api.getForge();
  const vkeys = Object.keys(S.forgeData.versions || {});
  if (vkeys.length) S.forgeGame = vkeys.sort((a,b) => {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i=0; i<3; i++) { if ((pa[i]||0) !== (pb[i]||0)) return (pb[i]||0)-(pa[i]||0); }
    return 0;
  })[0];
  if (vtab) vtab.innerHTML = tplVersionsTab();
}

async function doRefreshVersions() {
  S.manifest = null; S.fabricData = null; S.forgeData = null;
  S.installed = await api.getInstalled();
  showPage('versions');
}

function doInstallFabric() {
  const gv = byId('fabric-game-ver')?.value || S.fabricGame;
  const lv = byId('fabric-loader-ver')?.value || S.fabricLoader;
  if (!gv || !lv) { toast('Выберите версии', 'error'); return; }
  startInstall('fabric', gv, lv);
}

function doInstallForge() {
  const gv = byId('forge-game-ver')?.value || S.forgeGame;
  if (!gv || !S.forgeData?.versions?.[gv]) { toast('Выберите версию Minecraft', 'error'); return; }
  const fv = S.forgeData.versions[gv].recommended || S.forgeData.versions[gv].latest;
  if (!fv) { toast('Нет доступной версии Forge', 'error'); return; }
  startInstall('forge', gv, fv);
}

function startInstall(type, version, loaderVersion) {
  const ov = document.createElement('div');
  ov.className = 'modal-overlay'; ov.id = 'install-modal';
  const typeLabel = type === 'fabric' ? `Fabric ${loaderVersion} для ` : type === 'forge' ? `Forge ${loaderVersion} для ` : '';
  ov.innerHTML = `
  <div class="modal">
    <div class="modal-title">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22" style="color:var(--accent);">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Установка ${typeLabel}${version}
    </div>
    ${type === 'forge' ? '<div style="font-size:11px;color:var(--warn);margin-bottom:8px;">⏳ Forge может устанавливаться 3-10 минут...</div>' : ''}
    <div class="progress-bar-wrap"><div class="progress-bar" id="ibar" style="width:0%"></div></div>
    <div class="progress-text" id="itext">Подготовка...</div>
    <div style="margin-top:16px;text-align:right;" id="modal-actions">
      <button class="btn btn-ghost" onclick="document.getElementById('install-modal')?.remove()">Закрыть</button>
    </div>
  </div>`;
  document.body.appendChild(ov);

  let done = false;
  api.onInstallProgress(async data => {
    if (done) return;
    const bar = byId('ibar'), text = byId('itext');
    if (!bar) return;
    if (data.percent >= 0) bar.style.width = data.percent + '%';
    if (text) text.textContent = data.message || '';
    if (data.error) { bar.style.background = 'var(--danger)'; done = true; }
    if (data.percent === 100 && !done) {
      done = true;
      S.installed = await api.getInstalled();
      toast(version + ' установлен!', 'success');
      const acts = byId('modal-actions');
      const vid = type === 'fabric' ? `fabric-loader-${loaderVersion}-${version}` :
                  type === 'forge' ? `forge-${version}-${loaderVersion}` : version;
      // find actual installed version id
      const forgeInstalled = S.installed.find(v => v.includes('forge') && v.includes(version.split('.').slice(0,2).join('.')));
      const actualVid = type === 'forge' ? (forgeInstalled || vid) : vid;
      if (acts) acts.innerHTML = `
        <button class="btn btn-primary" data-action="apply-to-profile" data-val="${esc(actualVid)}">✓ В активный профиль</button>
        <button class="btn btn-ghost" onclick="document.getElementById('install-modal')?.remove()" style="margin-left:8px;">Закрыть</button>`;
    }
  });

  if (type === 'vanilla') api.installVanilla(version);
  else if (type === 'fabric') api.installFabric({ gameVersion: version, loaderVersion });
  else if (type === 'forge') api.installForge({ gameVersion: version, forgeVersion: loaderVersion });
}

async function doApplyToProfile(versionId) {
  byId('install-modal')?.remove();
  const profileId = S.config?.selectedProfile || 'default';
  await api.updateProfile(profileId, { versionId });
  S.profiles = await api.listProfiles();
  showPage('home');
  toast(versionId + ' назначен на профиль', 'success');
}

async function doUseVersionInProfile(versionId) {
  const profileId = S.config?.selectedProfile || 'default';
  await api.updateProfile(profileId, { versionId });
  S.profiles = await api.listProfiles();
  toast(versionId + ' назначен на активный профиль', 'success');
  showPage('versions');
}

async function doDeleteVersion(v) {
  if (!confirm('Удалить версию ' + v + '?')) return;
  await api.deleteVersion(v);
  S.installed = await api.getInstalled();
  toast('Версия ' + v + ' удалена', 'info');
  showPage('versions');
}

// ─── МОДЫ (Modrinth) ─────────────────────────────────────────────────────────
const LOADER_LABELS = { fabric: '🧵 Fabric', forge: '🔨 Forge', neoforge: '⚡ NeoForge', quilt: '🪡 Quilt', all: 'Все' };
const CATEGORY_ICONS = {
  'adventure':'⚔️','decoration':'🎨','economy':'💰','equipment':'🛡️','food':'🍎',
  'game-mechanics':'⚙️','library':'📚','magic':'✨','management':'📋','minigame':'🎮',
  'mobs':'🐾','optimization':'🚀','social':'💬','storage':'📦','technology':'🔧',
  'transportation':'🚗','utility':'🔩','worldgen':'🌍',
};

function tplMods() {
  const m = S.mods;
  const profiles = Object.values(S.profiles);
  const activeProfile = m.targetProfile || S.config?.selectedProfile || 'default';
  const profileVersion = S.profiles[activeProfile]?.versionId || '';
  // guess loader from version id
  const guessLoader = (vid) => {
    if (!vid) return 'fabric';
    if (vid.startsWith('fabric-')) return 'fabric';
    if (vid.includes('-forge')) return 'forge';
    if (vid.includes('neoforge')) return 'neoforge';
    return 'fabric';
  };

  return `<div class="page" id="page-mods" style="display:flex;flex-direction:column;height:100%;overflow:hidden;">
  <!-- Header -->
  <div class="page-header">
    <div>
      <div class="page-title">Браузер модов</div>
      <div class="page-subtitle">Поиск и скачивание модов с Modrinth</div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
      <select class="select-styled" id="mods-profile-sel" style="min-width:130px;max-width:200px;" title="Профиль для установки">
        ${profiles.map(p => `<option value="${esc(p.id)}" ${p.id === activeProfile ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
    </div>
  </div>

  <!-- Filters -->
  <div class="mods-filters">
    <div class="mods-search-wrap">
      <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input class="search-input" id="mods-query" placeholder="Поиск модов..." value="${esc(m.query)}">
      <button class="btn btn-primary" data-action="mods-search-btn">Найти</button>
    </div>
    <div class="mods-filter-row">
      <select class="select-styled" id="mods-game-ver" style="min-width:110px;">
        <option value="">Все версии</option>
        ${(m.gameVersions.length ? m.gameVersions : S.installed.map(v => v.replace(/^fabric-loader-[^-]+-/, '').replace(/^forge-/, '').replace(/-forge.*/, ''))).filter((v,i,a) => /^\d+\.\d+/.test(v) && a.indexOf(v)===i).map(v => `<option value="${esc(v)}" ${v === m.gameVersion ? 'selected' : ''}>${esc(v)}</option>`).join('')}
      </select>
      <select class="select-styled" id="mods-loader" style="min-width:120px;">
        ${Object.entries(LOADER_LABELS).map(([k,v]) => `<option value="${k}" ${k === m.loader ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
      <select class="select-styled" id="mods-category" style="min-width:130px;">
        <option value="all">Все категории</option>
        ${m.categories.map(c => `<option value="${esc(c.name)}" ${c.name === m.category ? 'selected' : ''}>${CATEGORY_ICONS[c.name]||'🔹'} ${esc(c.name)}</option>`).join('')}
      </select>
      ${m.total > 0 ? `<span class="text-xs text-muted">Найдено: ${m.total}</span>` : ''}
    </div>
  </div>

  <!-- Content: list + detail panel -->
  <div class="mods-content-area">
    <div class="mods-list-area" id="mods-list-wrap">
      <div class="mods-grid" id="mods-grid">
        ${m.loading ? '<div class="loading-state"><div class="spinner"></div><span>Поиск модов...</span></div>' :
          !m.hits.length ? '<div class="empty-state"><div>🔍</div><div>Введите поиск или выберите фильтры</div><div class="text-xs text-muted">Нажмите «Найти» или измените фильтры</div></div>' :
          renderModsList()}
      </div>
      ${m.hits.length && m.total > m.hits.length + m.offset ? `
      <div class="mods-load-more">
        <button class="btn btn-secondary" data-action="mods-load-more">Загрузить ещё (${m.total - m.hits.length} осталось)</button>
      </div>` : ''}
    </div>

    ${m.selected ? `<div id="mod-detail-panel" class="mod-detail-panel"><div class="mod-detail-inner">${renderModDetail()}</div></div>` : ''}
  </div>
</div>`;
}

function renderModsList() {
  const m = S.mods;
  return m.hits.map(mod => {
    const isSelected = m.selected?.id === mod.id;
    const dl = m.downloading[mod.id];
    return `<div class="mod-card ${isSelected ? 'selected' : ''}" data-action="mod-select" data-val="${esc(mod.id)}">
      <div class="mod-card-icon">
        ${mod.icon ? `<img src="${esc(mod.icon)}" alt="" onerror="this.style.display='none';this.nextSibling.style.display='flex'">
        <div style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-size:22px;">🧩</div>` :
        `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:22px;">🧩</div>`}
      </div>
      <div class="mod-card-info">
        <div class="mod-card-title">${esc(mod.title)}</div>
        <div class="mod-card-desc">${esc(mod.description)}</div>
        <div class="mod-card-meta">
          <span class="mod-badge">${LOADER_LABELS[mod.categories?.find(c => Object.keys(LOADER_LABELS).includes(c))] || '🔹'}</span>
          <span style="color:var(--text-muted);font-size:10px;">⬇ ${fmtNum(mod.downloads)}</span>
          <span style="color:var(--text-muted);font-size:10px;">by ${esc(mod.author)}</span>
        </div>
      </div>
      ${dl ? `<div class="mod-dl-badge ${dl.status === 'done' ? 'done' : dl.status === 'error' ? 'error' : 'loading'}">${dl.status === 'done' ? '✓' : dl.status === 'error' ? '✕' : dl.percent + '%'}</div>` : ''}
    </div>`;
  }).join('');
}

function renderModDetail() {
  const m = S.mods;
  const mod = m.selected;
  if (!mod) return '';
  const profileId = m.targetProfile || S.config?.selectedProfile || 'default';
  const activeProfile = S.profiles[profileId];
  const profileLoader = (() => {
    const vid = activeProfile?.versionId || '';
    if (vid.startsWith('fabric-')) return 'fabric';
    if (vid.includes('neoforge')) return 'neoforge';
    if (vid.includes('-forge') || vid.startsWith('forge-')) return 'forge';
    return m.loader !== 'all' ? m.loader : 'fabric';
  })();
  const profileMcVer = (() => {
    const vid = activeProfile?.versionId || '';
    const m2 = vid.match(/fabric-loader-[^-]+-(\d+\.\d+(?:\.\d+)?)/);
    if (m2) return m2[1];
    const m3 = vid.match(/^(\d+\.\d+(?:\.\d+)?)$/);
    if (m3) return m3[1];
    return '';
  })();

  return `
  <div class="mod-detail-header">
    <button class="btn btn-ghost" data-action="mod-close" style="padding:6px 10px;">←</button>
    <div class="mod-detail-icon">
      ${mod.icon ? `<img src="${esc(mod.icon)}" alt="">` : '<div style="font-size:32px;display:flex;align-items:center;justify-content:center;height:100%;">🧩</div>'}
    </div>
    <div style="flex:1;min-width:0;">
      <div class="mod-detail-name truncate">${esc(mod.title)}</div>
      <div class="mod-detail-sub">by ${esc(mod.author)} · ⬇ ${fmtNum(mod.downloads)}</div>
    </div>
  </div>

  <div class="mod-detail-desc">${esc(mod.description)}</div>

  <div class="mod-detail-tags">
    ${(mod.categories||[]).map(c => `<span class="mod-badge">${CATEGORY_ICONS[c]||'🔹'} ${esc(c)}</span>`).join('')}
    <span class="mod-badge" style="${mod.clientSide==='required'?'color:var(--accent);':''}">Клиент: ${mod.clientSide||'?'}</span>
    <span class="mod-badge" style="${mod.serverSide==='required'?'color:var(--accent2);':''}">Сервер: ${mod.serverSide||'?'}</span>
  </div>

  <div class="mod-detail-section-label">Версии для ${profileMcVer || 'выбранного профиля'} / ${profileLoader}</div>

  <div id="mod-versions-list" style="display:flex;flex-direction:column;gap:6px;">
    ${m.selectedVersions.length === 0 ? '<div class="loading-state" style="padding:16px 0;"><div class="spinner"></div> Загрузка версий...</div>' :
      m.selectedVersions.length === -1 ? '<div class="text-muted text-sm">Нет версий для этой комбинации</div>' :
      m.selectedVersions.map(v => {
        const primaryFile = v.files.find(f => f.primary) || v.files[0];
        const dl = primaryFile ? S.mods.downloading[primaryFile.filename] : null;
        const compatible = (v.loaders||[]).includes(profileLoader) &&
                           (!profileMcVer || (v.gameVersions||[]).includes(profileMcVer));
        return `<div class="mod-version-row ${compatible ? 'compatible' : ''}">
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(v.name)}">${esc(v.name)}</div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">
              ${(v.loaders||[]).join(', ')} · ${(v.gameVersions||[]).slice(0,4).join(', ')}${(v.gameVersions||[]).length > 4 ? '…' : ''}
              · ⬇ ${fmtNum(v.downloads)}
            </div>
          </div>
          ${primaryFile ? `
          <button class="btn ${compatible ? 'btn-primary' : 'btn-secondary'} mod-dl-btn"
            data-action="mod-download"
            data-val="${esc(primaryFile.url)}"
            data-filename="${esc(primaryFile.filename)}"
            data-vid="${esc(v.id)}"
            style="font-size:11px;padding:5px 10px;white-space:nowrap;"
            ${dl?.status === 'done' ? 'disabled' : ''}>
            ${dl?.status === 'done' ? '✓ Скачан' : dl?.status === 'downloading' ? `⏳ ${dl.percent}%` : dl?.status === 'error' ? '✕ Ошибка' : '⬇ Скачать'}
          </button>` : '<span style="font-size:10px;color:var(--text-muted);">Нет файла</span>'}
        </div>`;
      }).join('')}
  </div>

  <div class="divider"></div>
  <div style="display:flex;gap:8px;">
    <button class="btn btn-ghost text-xs" data-action="open-external" data-val="https://modrinth.com/mod/${esc(mod.slug)}">Открыть на Modrinth →</button>
  </div>`;
}

async function bindMods() {
  // Load categories and game versions if not loaded
  if (!S.mods.categories.length) {
    api.getModCategories().then(cats => {
      S.mods.categories = cats;
      const sel = byId('mods-category');
      if (sel) {
        sel.innerHTML = `<option value="all">Все категории</option>` +
          cats.map(c => `<option value="${esc(c.name)}">${CATEGORY_ICONS[c.name]||'🔹'} ${esc(c.name)}</option>`).join('');
      }
    });
    api.getModGameVersions().then(vers => {
      S.mods.gameVersions = vers;
      const sel = byId('mods-game-ver');
      if (sel) {
        const existing = sel.innerHTML;
        sel.innerHTML = `<option value="">Все версии</option>` +
          vers.map(v => `<option value="${esc(v)}" ${v === S.mods.gameVersion ? 'selected' : ''}>${esc(v)}</option>`).join('');
      }
    });
  }

  // Detect profile's MC version and loader automatically
  const profileId = S.mods.targetProfile || S.config?.selectedProfile || 'default';
  const vid = S.profiles[profileId]?.versionId || '';
  if (vid && !S.mods.gameVersion) {
    const mcMatch = vid.match(/fabric-loader-[^-]+-(\d+\.\d+(?:\.\d+)?)/) || vid.match(/^(\d+\.\d+(?:\.\d+)?)$/);
    if (mcMatch) S.mods.gameVersion = mcMatch[1];
  }
  if (vid && S.mods.loader === 'fabric') {
    if (vid.includes('neoforge')) S.mods.loader = 'neoforge';
    else if (vid.includes('-forge') || vid.startsWith('forge-')) S.mods.loader = 'forge';
  }

  // Subscribe to download progress
  api.onModDownloadProgress(data => {
    S.mods.downloading[data.filename] = data;
    // Update download button in detail panel
    const btn = document.querySelector(`[data-filename="${data.filename}"]`);
    if (btn) {
      if (data.status === 'done') { btn.disabled = true; btn.textContent = '✓ Скачан'; btn.className = btn.className.replace('btn-primary','btn-secondary'); }
      else if (data.status === 'error') { btn.textContent = '✕ Ошибка'; }
      else { btn.textContent = `⏳ ${data.percent}%`; }
    }
    // Update mod card badge
    const card = document.querySelector(`[data-val="${data.filename.split('-')[0]}"]`);
    if (card) {
      let badge = card.querySelector('.mod-dl-badge');
      if (!badge) { badge = document.createElement('div'); badge.className = 'mod-dl-badge'; card.appendChild(badge); }
      badge.className = `mod-dl-badge ${data.status === 'done' ? 'done' : data.status === 'error' ? 'error' : 'loading'}`;
      badge.textContent = data.status === 'done' ? '✓' : data.status === 'error' ? '✕' : data.percent + '%';
    }
  });

  // Auto-search if we have filters
  if (S.mods.hits.length === 0) {
    doModsSearch();
  } else {
    // just re-render
    refreshModsGrid();
  }

  // Search on Enter
  byId('mods-query')?.addEventListener('keypress', e => { if (e.key === 'Enter') doModsSearch(); });
}

async function doModsSearch() {
  const queryEl = byId('mods-query');
  if (queryEl) S.mods.query = queryEl.value;
  S.mods.offset = 0;
  S.mods.hits = [];
  S.mods.total = 0;
  S.mods.selected = null;
  S.mods.loading = true;
  refreshModsGrid();
  await fetchMods(0);
}

async function doModsLoadMore() {
  S.mods.offset = S.mods.hits.length;
  await fetchMods(S.mods.offset);
}

async function fetchMods(offset) {
  S.mods.loading = true;
  if (offset === 0) refreshModsGrid();
  const loader = S.mods.loader === 'all' ? '' : S.mods.loader;
  const result = await api.searchMods({
    query: S.mods.query,
    gameVersion: S.mods.gameVersion,
    loader,
    category: S.mods.category,
    offset,
    limit: 20
  });
  S.mods.loading = false;
  if (result.error) { toast('Ошибка поиска: ' + result.error, 'error'); S.mods.hits = []; }
  else {
    if (offset === 0) S.mods.hits = result.hits;
    else S.mods.hits = [...S.mods.hits, ...result.hits];
    S.mods.total = result.total;
  }
  refreshModsGrid();
}

function refreshModsGrid() {
  if (S.page !== 'mods') return;
  const grid = byId('mods-grid');
  const wrap = byId('mods-list-wrap');
  if (!grid) return;
  const m = S.mods;
  if (m.loading && !m.hits.length) {
    grid.innerHTML = '<div class="loading-state"><div class="spinner"></div> Поиск модов...</div>';
  } else if (!m.hits.length) {
    grid.innerHTML = '<div class="empty-state"><div>Ничего не найдено</div><div class="text-sm text-muted" style="margin-top:6px;">Попробуйте изменить поиск или фильтры</div></div>';
  } else {
    grid.innerHTML = renderModsList();
    // Update count
    const totalEl = wrap?.parentElement?.querySelector('.mods-total');
  }
  // Update load more button
  const loadMoreWrap = wrap?.querySelector('[data-action="mods-load-more"]')?.parentElement;
  if (loadMoreWrap) loadMoreWrap.remove();
  if (m.hits.length && m.total > m.hits.length) {
    const div = document.createElement('div');
    div.style.cssText = 'text-align:center;padding:16px;';
    div.innerHTML = `<button class="btn btn-secondary" data-action="mods-load-more">Загрузить ещё (${m.total - m.hits.length} осталось)</button>`;
    wrap?.appendChild(div);
  }
  // Update stats
  const statsEl = document.querySelector('.mods-total-count');
  if (statsEl) statsEl.textContent = `Найдено: ${m.total}`;
}

async function doModSelect(modId) {
  const mod = S.mods.hits.find(h => h.id === modId);
  if (!mod) return;
  S.mods.selected = mod;
  S.mods.selectedVersions = [];

  // Render panel immediately with loading state
  renderDetailPanel();

  // Fetch versions
  const profileId = S.mods.targetProfile || S.config?.selectedProfile || 'default';
  const vid = S.profiles[profileId]?.versionId || '';
  const mcVer = (() => {
    const m = vid.match(/fabric-loader-[^-]+-(\d+\.\d+(?:\.\d+)?)/) || vid.match(/^(\d+\.\d+(?:\.\d+)?)$/);
    return m ? m[1] : S.mods.gameVersion;
  })();
  const loader = (() => {
    if (vid.includes('neoforge')) return 'neoforge';
    if (vid.includes('-forge') || vid.startsWith('forge-')) return 'forge';
    if (vid.startsWith('fabric-')) return 'fabric';
    return S.mods.loader !== 'all' ? S.mods.loader : '';
  })();

  const versions = await api.getModVersions({ projectId: modId, gameVersion: mcVer, loader });

  // If no results with filters, try without mc version filter
  if (!versions?.error && Array.isArray(versions) && versions.length === 0 && mcVer) {
    const allVersions = await api.getModVersions({ projectId: modId, gameVersion: '', loader });
    S.mods.selectedVersions = Array.isArray(allVersions) ? allVersions : [];
  } else {
    S.mods.selectedVersions = Array.isArray(versions) ? versions : [];
  }

  renderDetailPanel();
  // Highlight selected card
  qsa('.mod-card').forEach(c => c.classList.toggle('selected', c.dataset.val === modId));
}

function doModClose() {
  S.mods.selected = null;
  S.mods.selectedVersions = [];
  const panel = byId('mod-detail-panel');
  if (panel) panel.remove();
  qsa('.mod-card').forEach(c => c.classList.remove('selected'));
}

function renderDetailPanel() {
  let panel = byId('mod-detail-panel');
  const listWrap = byId('mods-list-wrap');
  if (!listWrap) return;
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'mod-detail-panel';
    panel.className = 'mod-detail-panel';
    listWrap.parentElement.appendChild(panel);
  }
  panel.innerHTML = renderModDetail();
}

async function doModDownload(url, filename, versionId) {
  const profileId = S.mods.targetProfile || S.config?.selectedProfile || 'default';
  S.mods.downloading[filename] = { status: 'downloading', percent: 0 };
  // Update button immediately
  const btn = document.querySelector(`[data-filename="${filename}"]`);
  if (btn) btn.textContent = '⏳ 0%';
  const result = await api.downloadMod({ url, filename, profileId });
  if (result.success) {
    S.mods.downloading[filename] = { status: 'done', percent: 100 };
    if (result.alreadyExists) toast(`${filename} уже скачан`, 'info');
    else toast(`✓ ${filename} скачан в профиль "${S.profiles[profileId]?.name||profileId}"`, 'success', 4000);
  } else {
    S.mods.downloading[filename] = { status: 'error' };
    toast(`Ошибка загрузки: ${result.error}`, 'error');
  }
  // Re-render detail panel
  renderDetailPanel();
}

function fmtNum(n) {
  if (!n) return '0';
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(0) + 'K';
  return String(n);
}

// ─── АККАУНТЫ ────────────────────────────────────────────────────────────────
function renderAccountAvatar(acc, size=40) {
  if (acc.skinData) {
    return `<div class="account-avatar" style="width:${size}px;height:${size}px;">
      <img src="data:image/png;base64,${acc.skinData.substring(0,64)}..." style="width:100%;height:100%;object-fit:cover;border-radius:4px;image-rendering:pixelated;" onerror="this.style.display='none'" title="Скин загружен">
      <div style="width:100%;height:100%;background:linear-gradient(135deg,#4ade8044,#3b82f644);display:flex;align-items:center;justify-content:center;font-size:${Math.round(size*0.5)}px;font-weight:700;border-radius:4px;">${acc.username.charAt(0).toUpperCase()}</div>
    </div>`;
  }
  const color = acc.type === 'microsoft' ? 'var(--accent2)' : 'var(--accent)';
  return `<div class="account-avatar" style="width:${size}px;height:${size}px;background:${color}22;display:flex;align-items:center;justify-content:center;border-radius:6px;font-size:${Math.round(size*0.45)}px;font-weight:700;color:${color};">${acc.username.charAt(0).toUpperCase()}</div>`;
}

function tplAccounts() {
  const accounts = S.config?.accounts || [];
  const activeId = S.config?.activeAccount;
  return `<div class="page" id="page-accounts">
  <div class="page-header">
    <div><div class="page-title">Аккаунты</div><div class="page-subtitle">Управление аккаунтами Minecraft</div></div>
  </div>

  <!-- Список аккаунтов -->
  <div class="accounts-list" id="accounts-list">
    ${!accounts.length ? `<div class="empty-state"><div>Нет аккаунтов</div><div class="text-sm text-muted" style="margin-top:4px;">Добавьте аккаунт ниже</div></div>` :
      accounts.map(acc => `
      <div class="account-card ${acc.id === activeId ? 'active-account' : ''}">
        <div style="display:flex;align-items:center;gap:12px;flex:1;cursor:pointer;" data-action="set-account" data-val="${esc(acc.id)}">
          ${renderAccountAvatar(acc, 44)}
          <div class="account-card-info" style="flex:1;">
            <div class="account-card-name">${esc(acc.username)}</div>
            <div class="account-card-meta">
              ${acc.type === 'microsoft' ? '🔷 Microsoft' : '🔲 Оффлайн'}
              ${acc.skinData ? ' · <span style="color:var(--accent);font-size:10px;">🎨 Скин</span>' : ''}
              <span style="color:var(--text-muted);font-size:10px;margin-left:6px;font-family:var(--font-mono);" title="${esc(acc.uuid)}">${acc.uuid.substring(0,13)}...</span>
            </div>
          </div>
          ${acc.id === activeId ? '<span style="font-size:10px;color:var(--accent);border:1px solid var(--accent-dim);padding:2px 8px;border-radius:99px;white-space:nowrap;">Активен</span>' : ''}
        </div>
        <div style="display:flex;gap:6px;align-items:center;margin-left:8px;">
          ${acc.type === 'offline' ? `
          <button class="btn btn-secondary" data-action="set-skin" data-val="${esc(acc.id)}" style="padding:5px 10px;font-size:11px;" title="Изменить скин">🎨 Скин</button>
          ${acc.skinData ? `<button class="btn btn-ghost" data-action="remove-skin" data-val="${esc(acc.id)}" style="padding:5px 8px;font-size:11px;" title="Удалить скин">✕</button>` : ''}
          ` : `
          <button class="btn btn-ghost" data-action="namemc" data-val="${esc(acc.username)}" style="padding:5px 10px;font-size:11px;" title="NameMC профиль">NameMC</button>
          `}
          <button class="btn btn-ghost" data-action="copy-uuid" data-val="${esc(acc.uuid)}" style="padding:5px 8px;font-size:11px;" title="Скопировать UUID">UUID</button>
          <button class="btn btn-danger" data-action="remove-account" data-val="${esc(acc.id)}" style="padding:5px 10px;font-size:12px;">Удалить</button>
        </div>
      </div>`).join('')}
  </div>

  <!-- Добавить аккаунт -->
  <div class="add-account-form">
    <div class="section-header" style="margin-bottom:14px;">Добавить аккаунт</div>

    <!-- Оффлайн -->
    <div class="form-group">
      <label class="form-label">Никнейм (оффлайн / пиратка)</label>
      <div style="display:flex;gap:8px;">
        <input class="form-input" id="offline-username" placeholder="Steve" maxlength="16" style="flex:1;">
        <button class="btn btn-secondary" data-action="add-offline">Добавить</button>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
        Работает без лицензии. После добавления можно загрузить свой скин (PNG 64×64).
      </div>
    </div>

    <div class="divider">или</div>

    <!-- Microsoft -->
    <button class="btn btn-accent2" data-action="ms-login" style="width:100%;gap:8px;">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
        <path d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zM24 11.4H12.6V0H24v11.4z"/>
      </svg>
      Войти через Microsoft (лицензия)
    </button>
    <div style="margin-top:8px;font-size:11px;color:var(--text-muted);line-height:1.5;">
      Требуется официальная копия Minecraft Java Edition.
      <span data-action="buy-minecraft" style="color:var(--accent2);cursor:pointer;text-decoration:underline;margin-left:4px;">Купить на minecraft.net →</span>
    </div>
  </div>
</div>`;
}

function bindAccounts() {
  byId('offline-username')?.addEventListener('keypress', e => { if (e.key === 'Enter') doAddOffline(); });
}

async function doAddOffline() {
  const inp  = byId('offline-username');
  const name = inp?.value?.trim();
  if (!name || name.length < 2) { toast('Минимум 2 символа', 'error'); return; }
  if (!/^[a-zA-Z0-9_]{2,16}$/.test(name)) { toast('Только буквы, цифры и _', 'error'); return; }
  await api.authOffline(name);
  S.config = await api.getConfig();
  if (inp) inp.value = '';
  toast(`Аккаунт ${name} добавлен`, 'success');
  showPage('accounts');
}

async function doMsLogin() {
  const btn = document.querySelector('[data-action="ms-login"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Ожидание...'; }
  const result = await api.authMicrosoft();
  if (result?.error) {
    toast('Ошибка: ' + result.error, 'error', 5000);
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zM24 11.4H12.6V0H24v11.4z"/></svg> Войти через Microsoft (лицензия)'; }
  } else {
    S.config = await api.getConfig();
    toast('Вы вошли как ' + result.username + ' ✓', 'success');
    showPage('accounts');
  }
}

async function doRemoveAccount(id) {
  S.config = await api.removeAccount(id);
  showPage('accounts');
  toast('Аккаунт удалён', 'info');
}

async function doSetActiveAccount(id) {
  S.config = await api.setActiveAccount(id);
  showPage('accounts');
}

async function doSetSkin(accountId) {
  toast('Выберите PNG файл скина (64×64)...', 'info');
  const result = await api.setOfflineSkin(accountId);
  if (result?.success) {
    S.config = await api.getConfig();
    toast('Скин установлен! ✓', 'success');
    showPage('accounts');
  } else if (result?.error && result.error !== 'Отменено') {
    toast('Ошибка скина: ' + result.error, 'error');
  }
}

async function doRemoveSkin(accountId) {
  await api.removeOfflineSkin(accountId);
  S.config = await api.getConfig();
  toast('Скин удалён', 'info');
  showPage('accounts');
}

// ─── НАСТРОЙКИ ────────────────────────────────────────────────────────────────
function tplSettings() {
  const c = S.config || {}, sys = S.systemInfo || {};
  return `<div class="page" id="page-settings">
  <div class="page-header"><div><div class="page-title">Настройки</div></div></div>
  <div class="settings-grid">

    <div class="settings-card">
      <div class="settings-card-title">📁 Папки</div>
      <div class="form-group">
        <label class="form-label">Корневая папка лаунчера</label>
        <div class="path-row">
          <input class="form-input" id="s-install-dir" value="${esc(c.installDir || '')}" style="font-size:11px;flex:1;">
          <button class="btn btn-secondary" data-action="change-install-dir">Обзор</button>
          <button class="btn btn-ghost" data-action="open-root-dir" style="padding:8px 10px;">↗</button>
        </div>
      </div>
    </div>

    <div class="settings-card">
      <div class="settings-card-title">☕ Java</div>
      <div class="form-group">
        <label class="form-label">Путь к Java</label>
        <div class="path-row">
          <input class="form-input" id="s-java-path" value="${esc(c.javaPath || '')}" placeholder="java (из PATH)" style="font-size:12px;">
          <button class="btn btn-secondary" data-action="select-java">Обзор</button>
        </div>
      </div>
      <div id="java-check-result" style="font-size:12px;padding:4px 0;color:var(--text-muted);">🔍 Проверка Java...</div>
      <div class="form-group" style="margin-top:10px;">
        <label class="form-label">JVM аргументы</label>
        <input class="form-input" id="s-jvm-args" value="${esc(c.jvmArgs || '')}" placeholder="-XX:+UseG1GC" style="font-size:12px;font-family:var(--font-mono);">
      </div>
      <div style="margin-top:8px;">
        <div class="ram-label"><span>ОЗУ минимум</span><span id="s-ram-min-d">${c.ram?.min || 512} MB</span></div>
        <input type="range" id="s-ram-min" min="256" max="${Math.min(sys.totalMem||8192,8192)}" step="128" value="${c.ram?.min || 512}">
        <div class="ram-label" style="margin-top:8px;"><span>ОЗУ максимум (всего ${sys.totalMem||'?'} MB)</span><span id="s-ram-max-d">${c.ram?.max || 2048} MB</span></div>
        <input type="range" id="s-ram-max" min="512" max="${Math.min(sys.totalMem||8192,16384)}" step="256" value="${c.ram?.max || 2048}">
      </div>
    </div>

    <div class="settings-card">
      <div class="settings-card-title">🖥️ Окно игры</div>
      <div class="setting-row">
        <div class="setting-label">Ширина</div>
        <input class="form-input" id="s-win-w" type="number" value="${c.windowSize?.width||854}" style="width:80px;text-align:center;">
      </div>
      <div class="setting-row">
        <div class="setting-label">Высота</div>
        <input class="form-input" id="s-win-h" type="number" value="${c.windowSize?.height||480}" style="width:80px;text-align:center;">
      </div>
      <div class="setting-row">
        <div class="setting-label">Полноэкранный</div>
        <label class="toggle"><input type="checkbox" id="s-fullscreen" ${c.fullscreen ? 'checked' : ''}><span class="toggle-slider"></span></label>
      </div>
      <div class="setting-row">
        <div><div class="setting-label">Не сворачивать</div><div class="setting-desc">Оставить лаунчер при игре</div></div>
        <label class="toggle"><input type="checkbox" id="s-keepopen" ${c.keepOpen ? 'checked' : ''}><span class="toggle-slider"></span></label>
      </div>
    </div>

    <div class="settings-card">
      <div class="settings-card-title">ℹ️ О программе</div>
      <div style="font-size:22px;font-weight:800;margin-bottom:6px;">Nova Launcher <span style="color:var(--accent);">v${esc(S.launcherVersion)}</span></div>
      <div class="text-muted text-sm" style="margin-bottom:16px;">Бесплатный лаунчер Minecraft. Без рекламы, без слежки.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-secondary" data-action="open-root-dir">📁 Папка данных</button>
        <button class="btn btn-secondary" id="btn-open-runtimes">☕ Runtimes (Java)</button>
        <button class="btn btn-secondary" data-action="open-external" data-val="https://adoptium.net">⬇ Скачать Java 21</button>
        <button class="btn btn-secondary" data-action="buy-minecraft">🛒 Купить Minecraft</button>
      </div>
      <div style="margin-top:10px;font-size:11px;color:var(--text-muted);line-height:1.6;">
        Положите Java в папку <b>runtimes/java-21/</b> для автоматического обнаружения.<br>
        Структура: <span style="font-family:var(--font-mono);">runtimes/java-21/bin/java.exe</span>
      </div>
    </div>

  </div>
  <div style="margin-top:16px;text-align:right;">
    <button class="btn btn-primary" data-action="save-settings" style="width:160px;">💾 Сохранить</button>
  </div>
</div>`;
}

async function bindSettings() {
  api.checkJava().then(r => {
    const el = byId('java-check-result');
    if (el) el.innerHTML = r.found
      ? `<span style="color:var(--accent);">✓ Java ${r.version} найдена: ${esc(r.path)}</span>`
      : `<span style="color:var(--danger);">✕ Java не найдена! <span data-action="open-external" data-val="https://adoptium.net" style="color:var(--accent2);cursor:pointer;text-decoration:underline;">Скачать Java 21</span></span>`;
  });
  byId('btn-open-runtimes')?.addEventListener('click', () => api.openRuntimesDir?.());
}

async function doSelectJava() {
  const p = await api.selectJava(); if (p) { const inp = byId('s-java-path'); if (inp) inp.value = p; }
}
async function doChangeInstallDir() {
  const p = await api.selectInstallDir(); if (p) { const inp = byId('s-install-dir'); if (inp) inp.value = p; }
}

async function doSaveSettings() {
  S.config = await api.setConfig({
    javaPath:    byId('s-java-path')?.value || '',
    installDir:  byId('s-install-dir')?.value || S.config.installDir,
    jvmArgs:     byId('s-jvm-args')?.value || '',
    ram: { min: parseInt(byId('s-ram-min')?.value||'512'), max: parseInt(byId('s-ram-max')?.value||'2048') },
    windowSize: { width: parseInt(byId('s-win-w')?.value||'854'), height: parseInt(byId('s-win-h')?.value||'480') },
    fullscreen: byId('s-fullscreen')?.checked || false,
    keepOpen:   byId('s-keepopen')?.checked || false,
  });
  toast('Настройки сохранены ✓', 'success');
}

// ─── Game listener ────────────────────────────────────────────────────────────
function setupGameListener() {
  api.onGameStatus(data => {
    if (['launched','running'].includes(data.status)) S.gameRunning = true;
    if (['closed','error'].includes(data.status)) {
      S.gameRunning = false;
      if (data.status === 'error') toast('Ошибка игры: ' + data.message, 'error', 5000);
    }
    if (data.log) {
      const isErr = /error|exception/i.test(data.log);
      S.gameLogs.push({ text: data.log.trim().substring(0, 200), cls: isErr ? 'log-error' : '' });
      if (S.gameLogs.length > 300) S.gameLogs.shift();
    }
    if (S.page === 'home') {
      const logEl = byId('game-log');
      if (data.log && logEl) {
        const d = document.createElement('div');
        d.className = 'log-line ' + (/error|exception/i.test(data.log) ? 'log-error' : '');
        d.textContent = data.log.trim().substring(0, 200);
        logEl.appendChild(d);
        logEl.scrollTop = logEl.scrollHeight;
      }
      const dot = byId('status-dot'), txt = byId('status-text'), btn = byId('btn-launch');
      if (dot) dot.className = `status-dot ${S.gameRunning ? 'running' : 'online'}`;
      if (txt) txt.textContent = S.gameRunning ? 'Игра запущена' : data.status === 'closed' ? `Завершено (код ${data.code})` : 'Готов';
      if (btn) { btn.disabled = S.gameRunning; btn.textContent = S.gameRunning ? '⏳ Запущена' : '▶ ИГРАТЬ'; }
    }
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function byId(id) { return document.getElementById(id); }
function qsa(sel) { return document.querySelectorAll(sel); }

function getActiveAccount() {
  const { accounts, activeAccount } = S.config || {};
  if (!accounts?.length || !activeAccount) return null;
  return accounts.find(a => a.id === activeAccount) || accounts[0] || null;
}

function profileEmoji(icon) {
  return { grass:'🟩', diamond:'💎', redstone:'🔴', creeper:'💥', sword:'⚔️', bow:'🏹', book:'📖', potion:'🧪' }[icon] || '🟩';
}

function versionType(v) {
  if (v.startsWith('fabric-')) return 'Fabric Loader';
  if (v.includes('-forge') || v.startsWith('forge-')) return 'Forge';
  if (/^\d+\.\d+(\.\d+)?$/.test(v)) return 'Vanilla';
  if (/^\d+w\d+[a-z]$/.test(v)) return 'Snapshot';
  return 'Minecraft';
}

function fileIcon(n) {
  if (n.endsWith('.jar')) return '⚙️';
  if (n.endsWith('.zip')) return '📦';
  if (n.endsWith('.png')||n.endsWith('.jpg')) return '🖼️';
  if (n.endsWith('.json')) return '📄';
  if (n.endsWith('.log')||n.endsWith('.txt')) return '📋';
  return '📄';
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function toast(msg, type='info', dur=3000) {
  let c = document.querySelector('.toast-container');
  if (!c) { c = document.createElement('div'); c.className = 'toast-container'; document.body.appendChild(c); }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${type==='success'?'✓':type==='error'?'✕':'ℹ'}</span><span>${msg}</span>`;
  c.appendChild(el);
  setTimeout(() => el.classList.add('fade-out'), dur - 300);
  setTimeout(() => el.remove(), dur);
}

// ─── Start ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
