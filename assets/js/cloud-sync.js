(() => {
  "use strict";

  const config = globalThis.ToonVerseConfig || {};
  const store = globalThis.ToonVerseProjectStore;
  const rawBaseUrl = String(config.services?.apiBaseUrl || "").trim().replace(/\/$/, "");
  const timeoutMs = Math.max(5000, Math.min(120000, Number(config.services?.requestTimeoutMs) || 30000));
  let flushTimer = null;

  function validSecureEndpoint(value) {
    if (!value) return false;
    try {
      const url = new URL(value, location.href);
      return url.protocol === "https:" ||
        (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
    } catch {
      return false;
    }
  }

  async function accessToken() {
    const auth = globalThis.ToonVerseAuth;
    if (!auth || typeof auth.getAccessToken !== "function") {
      throw new Error("Sign in is required before cloud synchronization.");
    }
    const token = await auth.getAccessToken();
    if (!token || typeof token !== "string") {
      throw new Error("A valid sign-in session is required.");
    }
    return token;
  }

  function snapshotForm(project, snapshot, change) {
    const form = new FormData();
    const manifest = {
      schemaVersion: 1,
      project: {
        id: project?.id || change.projectId,
        name: project?.name || "Untitled Project",
        width: Number(project?.width) || 0,
        height: Number(project?.height) || 0,
        createdAt: project?.createdAt || null,
        updatedAt: project?.updatedAt || change.createdAt,
        deviceId: change.deviceId
      },
      change: {
        id: change.id,
        operation: change.operation,
        createdAt: change.createdAt
      },
      recovery: snapshot ? {
        version: snapshot.version || 1,
        activeLayerId: snapshot.activeLayerId || null,
        state: snapshot.state || {},
        zoom: snapshot.zoom || 1,
        activeTool: snapshot.activeTool || null,
        activeOperation: snapshot.activeOperation || null,
        selectionState: snapshot.selectionState || null,
        brush: snapshot.brush || null,
        retouch: snapshot.retouch || null,
        maskBrush: snapshot.maskBrush || null,
        exportSettings: snapshot.exportSettings || null,
        layers: (snapshot.layers || []).map((layer, index) => ({
          index,
          id: layer.id,
          name: layer.name,
          visible: layer.visible,
          locked: layer.locked,
          opacity: layer.opacity,
          blendMode: layer.blendMode,
          groupId: layer.groupId,
          kind: layer.kind,
          contentData: layer.contentData,
          maskEnabled: layer.maskEnabled
        }))
      } : null
    };
    form.append("manifest", new Blob([JSON.stringify(manifest)], { type: "application/json" }), "manifest.json");

    if (snapshot?.originalBlob instanceof Blob) {
      form.append("original", snapshot.originalBlob, "original");
    }
    (snapshot?.layers || []).forEach((layer, index) => {
      if (layer.blob instanceof Blob) {
        form.append(`layer-${index}`, layer.blob, `layer-${index}.png`);
      }
      if (layer.maskBlob instanceof Blob) {
        form.append(`mask-${index}`, layer.maskBlob, `mask-${index}.png`);
      }
    });
    return form;
  }

  async function push(change) {
    const token = await accessToken();
    const project = change.operation === "delete"
      ? null
      : await store.getProject(change.projectId);
    const snapshot = change.operation === "delete"
      ? null
      : await store.getRecoverySnapshot(change.projectId);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${rawBaseUrl}/v1/projects/sync`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Idempotency-Key": change.id,
          Accept: "application/json",
          "X-ToonVerse-Schema": "1"
        },
        body: snapshotForm(project, snapshot, change),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal
      });

      if (response.status === 401 || response.status === 403) {
        throw new Error("Your sign-in session has expired.");
      }
      if (response.status === 409) {
        const conflict = await response.json().catch(() => ({}));
        globalThis.dispatchEvent?.(new CustomEvent("toonverse:sync-conflict", {
          detail: { projectId: change.projectId, conflict }
        }));
        throw new Error("A newer cloud version needs conflict resolution.");
      }
      if (!response.ok) {
        throw new Error(`Cloud synchronization failed with status ${response.status}.`);
      }
      return await response.json().catch(() => ({ ok: true }));
    } finally {
      clearTimeout(timeout);
    }
  }

  async function flush() {
    if (!store || !validSecureEndpoint(rawBaseUrl)) {
      return { synced: 0, pending: 0, inactive: true };
    }
    try {
      const result = await store.flushSync();
      globalThis.dispatchEvent?.(new CustomEvent("toonverse:sync-complete", { detail: result }));
      return result;
    } catch (error) {
      console.warn("Cloud sync remains queued.", error);
      globalThis.dispatchEvent?.(new CustomEvent("toonverse:sync-deferred", {
        detail: { message: error?.message || "Cloud sync deferred." }
      }));
      return { synced: 0, pending: (await store.syncStatus()).pending, error: error?.message };
    }
  }

  function scheduleFlush(delay = 1000) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, delay);
  }

  const active = Boolean(store && validSecureEndpoint(rawBaseUrl));
  if (active) {
    store.registerSyncAdapter({ push });
    addEventListener("online", () => scheduleFlush(300));
    addEventListener("toonverse:project-saved", () => scheduleFlush(1200));
    if (document.readyState === "loading") {
      addEventListener("DOMContentLoaded", () => scheduleFlush(800), { once: true });
    } else {
      scheduleFlush(800);
    }
  }

  globalThis.ToonVerseCloudSync = Object.freeze({
    active,
    endpoint: active ? rawBaseUrl : "",
    flush,
    scheduleFlush
  });
})();
