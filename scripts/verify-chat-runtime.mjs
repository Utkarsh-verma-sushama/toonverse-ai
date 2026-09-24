import worker from "../backend/worker.mjs";
import {env, token, mockIdentity} from "./security-fixtures.mjs";
const originalFetch=globalThis.fetch;
globalThis.fetch=mockIdentity().fetch;
const validToken=await token();

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
console.log("Verified Chat Core safe-off and cryptographic identity gates.");

globalThis.fetch=originalFetch;
