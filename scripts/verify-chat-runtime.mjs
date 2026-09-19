import worker from "../backend/worker.mjs";

const disabled = await worker.fetch(new Request("https://api.uvenaro.invalid/v1/chat/responses", {
  method: "POST",
  headers: {
    authorization: "Bearer test-only",
    "x-uvenaro-verified-sub": "verification-user",
    "content-type": "application/json",
    "idempotency-key": "verification-request"
  },
  body: JSON.stringify({ message: "This request must never reach a provider." })
}), { ENVIRONMENT: "production", AUTH_REQUIRED: "true", CHAT_EXECUTION_ENABLED: "false" });

const payload = await disabled.json();
if (disabled.status !== 503 || payload.code !== "CHAT_EXECUTION_DISABLED") {
  throw new Error("Chat safe-off invariant failed.");
}

const unverified = await worker.fetch(new Request("https://api.uvenaro.invalid/v1/chat/responses", {
  method: "POST",
  headers: { authorization: "Bearer unverified", "content-type": "application/json" },
  body: JSON.stringify({ message: "Must be rejected before execution." })
}), { ENVIRONMENT: "production", AUTH_REQUIRED: "true", CHAT_EXECUTION_ENABLED: "true" });

if (unverified.status !== 401) throw new Error("Verified-identity invariant failed.");
console.log("Verified Chat Core safe-off and identity gates.");
