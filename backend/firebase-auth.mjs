// Firebase ID tokens only. No request header or environment flag can supply a UID.
const KEYS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const LOOKUP_URL = "https://identitytoolkit.googleapis.com/v1/accounts:lookup";
const encoder = new TextEncoder();

export class IdentityError extends Error {
  constructor(code, status = 401) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const invalid = () => new IdentityError("UNAUTHORIZED");
const unavailable = () => new IdentityError("IDENTITY_UNAVAILABLE", 503);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const timestamp = value => Number.isSafeInteger(value) && value >= 0;

function decode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw invalid();
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64 + "=".repeat((4 - base64.length % 4) % 4)), c => c.charCodeAt(0));
}

export function createFirebaseAuthenticator({ fetch: fetcher = (...args) => fetch(...args), now = Date.now } = {}) {
  let keys = new Map(), expiresAt = 0, refreshAfter = 0, refreshPromise;

  async function fetchJson(url, options = {}) {
    try {
      const response = await fetcher(url, { ...options, redirect: "error", signal: AbortSignal.timeout(5000) });
      const payload = await response.json();
      return { response, payload };
    } catch { throw unavailable(); }
  }

  async function refreshKeys() {
    if (refreshPromise) return refreshPromise;
    if (now() < refreshAfter) throw unavailable();
    // One bounded refresh for concurrent requests; unknown kids cannot trigger a request flood.
    refreshAfter = now() + 30000;
    refreshPromise = (async () => {
      const { response, payload } = await fetchJson(KEYS_URL, { headers: { accept: "application/json" } });
      if (!response.ok || !Array.isArray(payload?.keys) || !payload.keys.length || payload.keys.length > 20) throw unavailable();
      const next = new Map();
      for (const jwk of payload.keys) {
        if (jwk.kty !== "RSA" || jwk.alg !== "RS256" || jwk.use !== "sig" || typeof jwk.kid !== "string" || jwk.kid.length > 256) continue;
        try {
          next.set(jwk.kid, await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
        } catch { throw unavailable(); }
      }
      if (!next.size) throw unavailable();
      const ttl = Number(response.headers.get("cache-control")?.match(/(?:^|[,\s])max-age=(\d+)/)?.[1] ?? 300);
      keys = next;
      expiresAt = now() + Math.min(ttl, 21600) * 1000;
    })();
    try { await refreshPromise; } finally { refreshPromise = undefined; }
  }

  async function signingKey(kid) {
    if (now() >= expiresAt) await refreshKeys();
    else if (!keys.has(kid) && now() >= refreshAfter) await refreshKeys();
    const key = keys.get(kid);
    if (!key) throw invalid();
    return key;
  }

  return async function authenticate(request, env, { details = false } = {}) {
    const authorization = request.headers.get("authorization") || "";
    const match = authorization.match(/^Bearer ([A-Za-z0-9_.-]+)$/i);
    if (!match || match[1].length > 16384) throw invalid();
    const project = String(env.FIREBASE_PROJECT_ID || "").trim();
    const apiKey = String(env.FIREBASE_WEB_API_KEY || "").trim();
    if (!project || !apiKey) throw new IdentityError("IDENTITY_NOT_CONFIGURED", 503);

    const parts = match[1].split(".");
    let header, claims, signature;
    try {
      if (parts.length !== 3) throw invalid();
      header = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decode(parts[0])));
      claims = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decode(parts[1])));
      signature = decode(parts[2]);
    } catch { throw invalid(); }
    const seconds = Math.floor(now() / 1000);
    if (!object(header) || header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid || header.kid.length > 256 || header.crit !== undefined) throw invalid();
    if (!object(claims) || claims.aud !== project || claims.iss !== `https://securetoken.google.com/${project}` ||
        typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 128 ||
        !timestamp(claims.exp) || !timestamp(claims.iat) || !timestamp(claims.auth_time) ||
        claims.exp <= seconds || claims.iat > seconds || claims.auth_time > seconds ||
        claims.exp <= claims.iat || claims.auth_time > claims.iat) throw invalid();
    // This deployment is a single Firebase project, not an Identity Platform tenant.
    if (claims.firebase?.tenant !== undefined) throw invalid();
    const key = await signingKey(header.kid);
    if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, encoder.encode(`${parts[0]}.${parts[1]}`))) throw invalid();

    // Check current account state on every request. Signature verification alone
    // does not reject sessions revoked since the ID token was minted.
    const { response, payload } = await fetchJson(`${LOOKUP_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: match[1] })
    });
    if (!response.ok) {
      const code = String(payload?.error?.message || "").split(" : ")[0];
      if (["INVALID_ID_TOKEN", "TOKEN_EXPIRED", "USER_DISABLED", "USER_NOT_FOUND"].includes(code)) throw invalid();
      throw unavailable();
    }
    if (!Array.isArray(payload?.users) || payload.users.length !== 1) throw invalid();
    const account = payload.users[0];
    const validSince = typeof account.validSince === "string" && /^\d+$/.test(account.validSince) ? Number(account.validSince) : NaN;
    if (account.localId !== claims.sub || account.disabled === true || !timestamp(validSince) || claims.auth_time < validSince) throw invalid();
    const identity={sub:claims.sub,verified:true,emailVerified:account.emailVerified===true};
    if(details)Object.assign(identity,{authTime:claims.auth_time*1000,tokenExpiresAt:claims.exp*1000,
      email:typeof account.email==='string'?account.email:'',name:typeof account.displayName==='string'?account.displayName:'',
      providers:(account.providerUserInfo||[]).map(p=>p.providerId).filter(p=>typeof p==='string'),
      mfaEnabled:Array.isArray(account.mfaInfo)&&account.mfaInfo.length>0,
      mfaMethods:(account.mfaInfo||[]).map(m=>({id:m.mfaEnrollmentId,name:m.displayName||'Authenticator',totp:Boolean(m.totpInfo)}))});
    return Object.freeze(identity);
  };
}

export const authenticateFirebaseRequest = createFirebaseAuthenticator();
