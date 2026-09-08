(() => {
  "use strict";

  const STORAGE_KEY = "toonverse:auth:session-hint";
  const DEVICE_KEY = "toonverse:auth:device-id";
  const listeners = new Set();
  let accessToken = "";
  let refreshPromise = null;
  let state = Object.freeze({
    status: "signed-out",
    user: null,
    expiresAt: 0,
    backendConnected: Boolean(window.ToonVerseConfig?.services?.apiBaseUrl),
    lastError: ""
  });

  const emit = () => {
    const snapshot = getState();
    listeners.forEach(listener => {
      try { listener(snapshot); } catch (error) { console.error("Auth listener failed.", error); }
    });
    window.dispatchEvent(new CustomEvent("toonverse:auth-change", { detail: snapshot }));
  };

  const setState = patch => {
    state = Object.freeze({ ...state, ...patch });
    emit();
    return state;
  };

  const getState = () => ({ ...state, user: state.user ? { ...state.user } : null });

  const deviceId = () => {
    try {
      const existing = localStorage.getItem(DEVICE_KEY);
      if (existing) return existing;
      const created = crypto.randomUUID?.() || `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(DEVICE_KEY, created);
      return created;
    } catch {
      return `session-${Date.now().toString(36)}`;
    }
  };

  const endpoint = path => {
    const base = String(window.ToonVerseConfig?.services?.apiBaseUrl || "").replace(/\/$/, "");
    if (!base) throw new Error("ACCOUNT_SERVICE_UNAVAILABLE");
    return `${base}${path}`;
  };

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeout = Math.max(5000, Number(window.ToonVerseConfig?.services?.requestTimeoutMs) || 30000);
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const headers = new Headers(options.headers || {});
      headers.set("Accept", "application/json");
      headers.set("X-ToonVerse-Device", deviceId());
      if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
      const response = await fetch(endpoint(path), {
        ...options,
        headers,
        credentials: "include",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.message || "Account request failed.");
        error.code = payload.code || `HTTP_${response.status}`;
        throw error;
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  function acceptSession(payload) {
    accessToken = String(payload?.accessToken || "");
    const user = payload?.user && typeof payload.user === "object" ? {
      id: String(payload.user.id || ""),
      name: String(payload.user.name || ""),
      email: String(payload.user.email || ""),
      avatar: String(payload.user.avatar || ""),
      emailVerified: Boolean(payload.user.emailVerified),
      mfaEnabled: Boolean(payload.user.mfaEnabled)
    } : null;
    if (!user?.id) throw new Error("INVALID_SESSION");
    const expiresAt = Number(payload.expiresAt) || Date.now() + 10 * 60 * 1000;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        user: { id: user.id, name: user.name, avatar: user.avatar },
        lastSeenAt: Date.now()
      }));
    } catch {}
    return setState({ status: "signed-in", user, expiresAt, lastError: "" });
  }

  async function restore() {
    if (!state.backendConnected) return getState();
    setState({ status: "restoring", lastError: "" });
    try {
      return acceptSession(await request("/v1/auth/session", { method: "POST" }));
    } catch (error) {
      accessToken = "";
      return setState({ status: "signed-out", user: null, expiresAt: 0, lastError: error.code || error.message });
    }
  }

  async function signInWithEmail(email, password) {
    if (!email || !password) throw new Error("Enter your email and password.");
    setState({ status: "signing-in", lastError: "" });
    try {
      return acceptSession(await request("/v1/auth/sign-in", {
        method: "POST",
        body: JSON.stringify({ email: String(email).trim(), password: String(password) })
      }));
    } catch (error) {
      setState({ status: "signed-out", lastError: error.code || error.message });
      throw error;
    }
  }

  async function createAccount(profile) {
    setState({ status: "signing-in", lastError: "" });
    try {
      return acceptSession(await request("/v1/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: String(profile?.name || "").trim(),
          email: String(profile?.email || "").trim(),
          password: String(profile?.password || "")
        })
      }));
    } catch (error) {
      setState({ status: "signed-out", lastError: error.code || error.message });
      throw error;
    }
  }

  async function sendOtp(destination) {
    return request("/v1/auth/otp/request", {
      method: "POST",
      body: JSON.stringify({ destination: String(destination || "").trim() })
    });
  }

  async function verifyOtp(challengeId, code) {
    return acceptSession(await request("/v1/auth/otp/verify", {
      method: "POST",
      body: JSON.stringify({ challengeId, code: String(code || "").trim() })
    }));
  }

  async function beginProvider(provider, returnTo = location.href) {
    const allowed = new Set(["google", "apple", "microsoft", "facebook", "linkedin", "x", "github"]);
    if (!allowed.has(provider)) throw new Error("Unsupported sign-in provider.");
    const payload = await request(`/v1/auth/oauth/${provider}/start`, {
      method: "POST",
      body: JSON.stringify({ returnTo })
    });
    if (!payload.authorizationUrl) throw new Error("Provider sign-in could not start.");
    location.assign(payload.authorizationUrl);
  }

  async function refresh() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = request("/v1/auth/refresh", { method: "POST" })
      .then(acceptSession)
      .catch(error => {
        accessToken = "";
        setState({ status: "signed-out", user: null, expiresAt: 0, lastError: error.code || error.message });
        throw error;
      })
      .finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  async function getAccessToken() {
    if (!accessToken) await refresh();
    else if (state.expiresAt - Date.now() < 60000) await refresh();
    return accessToken;
  }

  async function signOut(options = {}) {
    try { if (state.backendConnected) await request("/v1/auth/sign-out", {
      method: "POST",
      body: JSON.stringify({ allDevices: Boolean(options.allDevices) })
    }); } catch (error) { console.warn("Server sign-out could not complete.", error); }
    accessToken = "";
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    return setState({ status: "signed-out", user: null, expiresAt: 0, lastError: "" });
  }

  async function listSessions() {
    const payload = await request("/v1/auth/sessions");
    return Array.isArray(payload.sessions) ? payload.sessions : [];
  }

  async function revokeSession(sessionId) {
    return request(`/v1/auth/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  }

  async function beginPasskey() {
    if (!window.PublicKeyCredential || !navigator.credentials) throw new Error("Passkeys are unavailable on this device.");
    const options = await request("/v1/auth/passkeys/authenticate/options", { method: "POST" });
    const credential = await navigator.credentials.get({ publicKey: options.publicKey });
    return acceptSession(await request("/v1/auth/passkeys/authenticate/verify", {
      method: "POST",
      body: JSON.stringify({ credential })
    }));
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(getState());
    return () => listeners.delete(listener);
  }

  window.ToonVerseAuth = Object.freeze({
    getState, subscribe, restore, signInWithEmail, createAccount, sendOtp, verifyOtp,
    beginProvider, beginPasskey, getAccessToken, signOut, listSessions, revokeSession
  });
})();