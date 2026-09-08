(() => {
  "use strict";

  const DB_NAME = "toonverse-project-system";
  const DB_VERSION = 1;
  const PROJECTS = "projects";
  const VERSIONS = "versions";
  const QUEUE = "syncQueue";
  const SETTINGS = "settings";
  const PROJECT_ID_KEY = "toonverse:project:active-id";
  const DEVICE_ID_KEY = "toonverse:device:id";
  const LEGACY_KEY = "toonverse:editor:last-project";
  const MAX_VERSIONS = 20;
  const channel =
    typeof BroadcastChannel === "function"
      ? new BroadcastChannel("toonverse-projects")
      : null;
  let syncAdapter = null;

  const makeId = prefix => {
    const secureCrypto = globalThis.crypto;
    return `${prefix}-${typeof secureCrypto?.randomUUID === "function"
      ? secureCrypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
  };

  function stableId(key, prefix) {
    try {
      const existing = localStorage.getItem(key);
      if (existing) return existing;
      const created = makeId(prefix);
      localStorage.setItem(key, created);
      return created;
    } catch {
      return makeId(prefix);
    }
  }

  const deviceId = stableId(DEVICE_ID_KEY, "device");

  function activeProjectId() {
    return stableId(PROJECT_ID_KEY, "project");
  }

  function setActiveProjectId(id) {
    if (!id) return;
    try { localStorage.setItem(PROJECT_ID_KEY, id); } catch {}
  }

  function openDatabase() {
    if (!("indexedDB" in globalThis)) {
      return Promise.reject(new Error("IndexedDB is unavailable."));
    }
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(PROJECTS)) {
          db.createObjectStore(PROJECTS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(VERSIONS)) {
          const store = db.createObjectStore(VERSIONS, { keyPath: "id" });
          store.createIndex("projectId", "projectId");
          store.createIndex("savedAt", "savedAt");
        }
        if (!db.objectStoreNames.contains(QUEUE)) {
          const store = db.createObjectStore(QUEUE, { keyPath: "id" });
          store.createIndex("projectId", "projectId");
          store.createIndex("createdAt", "createdAt");
        }
        if (!db.objectStoreNames.contains(SETTINGS)) {
          db.createObjectStore(SETTINGS, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Project database upgrade is blocked by another tab."));
    });
  }

  async function withStore(names, mode, task) {
    const db = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(names, mode);
        const stores = Object.fromEntries(
          names.map(name => [name, transaction.objectStore(name)])
        );
        let result;
        try { result = task(stores, transaction); }
        catch (error) { reject(error); return; }
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error("Project transaction was aborted."));
      });
    } finally {
      db.close();
    }
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function trimVersions(projectId) {
    const versions = await listVersions(projectId);
    const excess = versions.slice(MAX_VERSIONS);
    if (!excess.length) return;
    await withStore([VERSIONS], "readwrite", stores => {
      excess.forEach(version => stores[VERSIONS].delete(version.id));
    });
  }

  async function saveProject(metadata, options = {}) {
    const now = new Date().toISOString();
    const id = metadata.id || activeProjectId();
    setActiveProjectId(id);
    const existing = await getProject(id).catch(() => null);
    const record = {
      ...(existing || {}),
      ...metadata,
      id,
      schemaVersion: 1,
      deviceId,
      createdAt: existing?.createdAt || metadata.createdAt || now,
      updatedAt: now,
      syncState: "pending",
      deleted: false
    };
    if (!metadata.preview && existing?.preview) record.preview = existing.preview;

    const queueRecord = {
      id: `project:${id}`,
      projectId: id,
      operation: "upsert",
      createdAt: now,
      attempts: 0,
      deviceId
    };
    const version = options.createVersion ? {
      id: makeId("version"),
      projectId: id,
      name: record.name,
      width: record.width,
      height: record.height,
      preview: record.preview || "",
      savedAt: now,
      deviceId
    } : null;

    try {
      await withStore(
        version ? [PROJECTS, QUEUE, VERSIONS] : [PROJECTS, QUEUE],
        "readwrite",
        stores => {
          stores[PROJECTS].put(record);
          stores[QUEUE].put(queueRecord);
          if (version) stores[VERSIONS].put(version);
        }
      );
      if (version) await trimVersions(id);
    } catch (error) {
      // Older/private TV and mobile WebViews can disable IndexedDB.
      try {
        localStorage.setItem(LEGACY_KEY, JSON.stringify(record));
      } catch {
        throw error;
      }
      record.syncState = "local-only";
    }
    channel?.postMessage({ type: "project-saved", projectId: id, at: now });
    globalThis.dispatchEvent?.(new CustomEvent("toonverse:project-saved", { detail: { projectId: id } }));
    return record;
  }

  async function getProject(id = activeProjectId()) {
    try {
      const db = await openDatabase();
      try {
        const tx = db.transaction(PROJECTS, "readonly");
        return await requestResult(tx.objectStore(PROJECTS).get(id));
      } finally { db.close(); }
    } catch {
      try {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
        return legacy ? { ...legacy, id, syncState: "local-only" } : null;
      } catch {
        return null;
      }
    }
  }

  async function listProjects() {
    try {
      const db = await openDatabase();
      try {
        const tx = db.transaction(PROJECTS, "readonly");
        const records = await requestResult(tx.objectStore(PROJECTS).getAll());
        return records
          .filter(record => !record.deleted)
          .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      } finally { db.close(); }
    } catch {
      const fallback = await getProject();
      return fallback ? [fallback] : [];
    }
  }

  async function listVersions(projectId = activeProjectId()) {
    if (!("indexedDB" in globalThis)) return [];
    const db = await openDatabase();
    try {
      const tx = db.transaction(VERSIONS, "readonly");
      const records = await requestResult(
        tx.objectStore(VERSIONS).index("projectId").getAll(projectId)
      );
      return records.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
    } finally { db.close(); }
  }

  async function removeProject(projectId) {
    const now = new Date().toISOString();
    if (!("indexedDB" in globalThis)) {
      try { localStorage.removeItem(LEGACY_KEY); } catch {}
      return;
    }
    await withStore([PROJECTS, QUEUE, VERSIONS], "readwrite", stores => {
      stores[PROJECTS].delete(projectId);
      stores[QUEUE].put({
        id: `project:${projectId}`,
        projectId,
        operation: "delete",
        createdAt: now,
        attempts: 0,
        deviceId
      });
      const request = stores[VERSIONS].index("projectId").openCursor(projectId);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
    });
    channel?.postMessage({ type: "project-removed", projectId, at: now });
  }

  async function syncStatus() {
    if (!("indexedDB" in globalThis)) {
      return { online: typeof navigator?.onLine === "boolean" ? navigator.onLine : true, backendConnected: false, pending: 0, usage: 0, quota: 0, deviceId, localOnly: true };
    }
    const db = await openDatabase();
    try {
      const tx = db.transaction(QUEUE, "readonly");
      const pending = await requestResult(tx.objectStore(QUEUE).count());
      const estimate = typeof navigator?.storage?.estimate === "function"
        ? await navigator.storage.estimate().catch(() => ({}))
        : {};
      return {
        online: typeof navigator?.onLine === "boolean" ? navigator.onLine : true,
        backendConnected: Boolean(syncAdapter),
        pending,
        usage: estimate.usage || 0,
        quota: estimate.quota || 0,
        deviceId
      };
    } finally { db.close(); }
  }

  function registerSyncAdapter(adapter) {
    if (!adapter || typeof adapter.push !== "function") {
      throw new TypeError("A sync adapter must provide push(change).");
    }
    syncAdapter = adapter;
  }

  async function flushSync() {
    if (!syncAdapter) return { synced: 0, pending: (await syncStatus()).pending };
    const db = await openDatabase();
    try {
      const tx = db.transaction(QUEUE, "readonly");
      const changes = await requestResult(tx.objectStore(QUEUE).getAll());
      let synced = 0;
      for (const change of changes.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))) {
        await syncAdapter.push(change);
        await withStore([QUEUE, PROJECTS], "readwrite", stores => {
          stores[QUEUE].delete(change.id);
          if (change.operation === "upsert") {
            const request = stores[PROJECTS].get(change.projectId);
            request.onsuccess = () => {
              if (!request.result) return;
              stores[PROJECTS].put({ ...request.result, syncState: "synced", syncedAt: new Date().toISOString() });
            };
          }
        });
        synced += 1;
      }
      return { synced, pending: Math.max(0, changes.length - synced) };
    } finally { db.close(); }
  }

  async function migrateLegacy() {
    let legacy;
    try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null"); }
    catch { legacy = null; }
    if (!legacy) return;
    const current = await getProject().catch(() => null);
    if (current) return;
    await saveProject({
      name: legacy.name || "Recovered Project",
      width: legacy.width || 0,
      height: legacy.height || 0,
      preview: legacy.preview || "",
      savedAt: legacy.savedAt || new Date().toISOString(),
      source: "legacy-migration"
    });
  }

  const api = Object.freeze({
    activeProjectId,
    setActiveProjectId,
    saveProject,
    getProject,
    listProjects,
    listVersions,
    removeProject,
    syncStatus,
    registerSyncAdapter,
    flushSync,
    migrateLegacy,
    deviceId
  });
  globalThis.ToonVerseProjectStore = api;
  migrateLegacy().catch(error => console.warn("Project migration deferred.", error));
})();
