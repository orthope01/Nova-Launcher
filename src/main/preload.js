const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nova', {
  // Window
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close:    () => ipcRenderer.send('window:close'),

  // Config
  getConfig:        ()    => ipcRenderer.invoke('config:get'),
  setConfig:        (cfg) => ipcRenderer.invoke('config:set', cfg),
  completeFirstRun: (dir) => ipcRenderer.invoke('config:completeFirstRun', dir),
  selectInstallDir: ()    => ipcRenderer.invoke('config:selectInstallDir'),
  selectJava:       ()    => ipcRenderer.invoke('config:selectJava'),
  openDir:          (p)   => ipcRenderer.invoke('config:openDir', p),

  // Profiles
  listProfiles:        ()          => ipcRenderer.invoke('profiles:list'),
  createProfile:       (opts)      => ipcRenderer.invoke('profiles:create', opts),
  updateProfile:       (id, patch) => ipcRenderer.invoke('profiles:update', { id, patch }),
  deleteProfile:       (id)        => ipcRenderer.invoke('profiles:delete', id),
  setActiveProfile:    (id)        => ipcRenderer.invoke('profiles:setActive', id),
  getProfileDir:       (id)        => ipcRenderer.invoke('profiles:getDir', id),
  ensureProfileFolders:(id)        => ipcRenderer.invoke('profiles:ensureFolders', id),
  selectProfileGameDir:(id)        => ipcRenderer.invoke('profiles:selectGameDir', id),

  // Folder manager
  listFolders:  (profileId) => ipcRenderer.invoke('folders:list', profileId),
  openFolder:   (path)      => ipcRenderer.invoke('folders:open', path),
  ensureFolders:(profileId) => ipcRenderer.invoke('folders:ensure', profileId),
  addFiles:     (opts)      => ipcRenderer.invoke('folders:addFiles', opts),
  deleteFile:   (filePath)  => ipcRenderer.invoke('folders:deleteFile', filePath),

  // Versions
  getManifest:   () => ipcRenderer.invoke('versions:getManifest'),
  getFabric:     () => ipcRenderer.invoke('versions:getFabric'),
  getForge:      () => ipcRenderer.invoke('versions:getForge'),
  getInstalled:  () => ipcRenderer.invoke('versions:getInstalled'),
  deleteVersion: (v) => ipcRenderer.invoke('versions:delete', v),

  // Install
  installVanilla: (v)    => ipcRenderer.invoke('install:vanilla', v),
  installFabric:  (opts) => ipcRenderer.invoke('install:fabric', opts),
  installForge:   (opts) => ipcRenderer.invoke('install:forge', opts),
  onInstallProgress: (cb) => {
    ipcRenderer.on('install:progress', (e, data) => cb(data));
    return () => ipcRenderer.removeAllListeners('install:progress');
  },

  // Game — с поддержкой подключения к серверу
  launchGame: (opts) => ipcRenderer.invoke('game:launch', opts),
  onGameStatus: (cb) => {
    ipcRenderer.on('game:status', (e, data) => cb(data));
    return () => ipcRenderer.removeAllListeners('game:status');
  },

  // Auth
  authOffline:         (username) => ipcRenderer.invoke('auth:offline', username),
  authMicrosoft:       ()         => ipcRenderer.invoke('auth:microsoft'),
  refreshMicrosoft:    (id)       => ipcRenderer.invoke('auth:refreshMicrosoft', id),
  removeAccount:       (id)       => ipcRenderer.invoke('auth:remove', id),
  setActiveAccount:    (id)       => ipcRenderer.invoke('auth:setActive', id),

  // Skin
  getSkin:           (uuid)      => ipcRenderer.invoke('skin:get', uuid),
  setOfflineSkin:    (accountId) => ipcRenderer.invoke('skin:setOffline', accountId),
  removeOfflineSkin: (accountId) => ipcRenderer.invoke('skin:removeOffline', accountId),
  getSkinPath:       (accountId) => ipcRenderer.invoke('skin:getSkinPath', accountId),

  // News
  getNews: () => ipcRenderer.invoke('news:get'),

  // Mods (Modrinth)
  searchMods:        (opts) => ipcRenderer.invoke('mods:search', opts),
  getModVersions:    (opts) => ipcRenderer.invoke('mods:getVersions', opts),
  downloadMod:       (opts) => ipcRenderer.invoke('mods:download', opts),
  getModCategories:  ()     => ipcRenderer.invoke('mods:getCategories'),
  getModGameVersions:()     => ipcRenderer.invoke('mods:getGameVersions'),
  onModDownloadProgress: (cb) => {
    ipcRenderer.on('mods:downloadProgress', (e, data) => cb(data));
    return () => ipcRenderer.removeAllListeners('mods:downloadProgress');
  },

  // System
  getSystemInfo:      () => ipcRenderer.invoke('system:info'),
  checkJava:          () => ipcRenderer.invoke('system:checkJava'),
  openExternal:       (url) => ipcRenderer.invoke('system:openExternal', url),
  getLauncherVersion: () => ipcRenderer.invoke('launcher:version'),
  getRuntimesDir:     () => ipcRenderer.invoke('launcher:getRuntimesDir'),
  openRuntimesDir:    () => ipcRenderer.invoke('launcher:openRuntimesDir'),
  checkVersionUpdates:() => ipcRenderer.invoke('versions:checkUpdates'),
});

