import worker from "../backend/worker.mjs";
import {env, token, mockIdentity} from "./security-fixtures.mjs";
const originalFetch=globalThis.fetch;
globalThis.fetch=mockIdentity().fetch;
const validToken='uv1.'+'a'.repeat(43);

const disabled = await worker.fetch(new Request("https://api.uvenaro.invalid/v1/chat/responses", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "idempotency-key": "verification-request",
    "authorization": `Bearer ${validToken}`
  },
  body: JSON.stringify({ message: "This request must never reach a provider." })
}), { ...env, ENVIRONMENT: "verification", CHAT_EXECUTION_ENABLED: "false" });

const payload = await disabled.json();
if (disabled.status !== 503 || payload.code !== "CHAT_EXECUTION_DISABLED") {
  throw new Error("Chat safe-off invariant failed.");
}

const unverified = await worker.fetch(new Request("https://api.uvenaro.invalid/v1/chat/responses", {
  method: "POST",
  headers: { authorization: "Bearer unverified", "x-uvenaro-verified-sub": "spoofed-user", "content-type": "application/json" },
  body: JSON.stringify({ message: "Must be rejected before execution." })
}), { ...env, ENVIRONMENT: "production", AUTH_REQUIRED: "true", FIREBASE_PROJECT_ID: "toonverse-ai", CHAT_EXECUTION_ENABLED: "true" });

if (unverified.status !== 401) throw new Error("Spoofed identity header was not rejected.");
const productionMisconfigured = await worker.fetch(new Request("https://api.uvenaro.invalid/v1/chat/responses", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "idempotency-key": "paid-confirmation-guard",
    "authorization": `Bearer ${validToken}`
  },
  body: JSON.stringify({ message: "Must not cross the paid provider boundary." })
}), {
  ...env,
  ENVIRONMENT: "production",
  CHAT_EXECUTION_ENABLED: "true",
  CHAT_PROVIDER: "configured-but-blocked",
  CHAT_MODEL: "configured-but-blocked",
  CHAT_PROVIDER_URL: "https://metered.example.invalid/responses",
  CHAT_PROVIDER_ALLOWED_ORIGIN: "https://metered.example.invalid",
  CHAT_PROVIDER_PROTOCOL: "metered-v1",
  CHAT_PROVIDER_API_KEY: "verification-only",
  CHAT_GLOBAL_DAILY_COST_MICROUSD: "1"
});
const blockedPayload = await productionMisconfigured.json();
if (productionMisconfigured.status !== 503 || blockedPayload.code !== "PAID_EXECUTION_CONFIRMATION_REQUIRED") {
  throw new Error("Production paid-chat dual-confirmation invariant failed.");
}

console.log("Verified Chat Core safe-off, paid-dispatch confirmation and cryptographic identity gates.");

globalThis.fetch=originalFetch;
