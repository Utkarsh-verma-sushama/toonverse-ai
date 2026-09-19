(() => {
  "use strict";
  const KEY = "uvenaro.chat.v1", MAX_MESSAGES = 200;
  const state = JSON.parse(localStorage.getItem(KEY) || '{"messages":[]}');
  const save = () => localStorage.setItem(KEY, JSON.stringify({ messages: state.messages.slice(-MAX_MESSAGES) }));
  const endpoint = () => String(window.UvenaroConfig?.services?.apiBaseUrl || "").replace(/\/$/, "");
  const connected = () => Boolean(endpoint() && window.UvenaroConfig?.features?.chatCore);
  async function send(content) {
    const text = String(content || "").trim();
    if (!text || text.length > 12000) throw new Error("Message must contain 1 to 12,000 characters.");
    const user = { id: crypto.randomUUID(), role: "user", content: text, createdAt: new Date().toISOString() };
    state.messages.push(user); save();
    if (!connected()) return { user, assistant: null, unavailable: true };
    const token = await window.UvenaroAuth?.getAccessToken?.().catch(() => "");
    const response = await fetch(`${endpoint()}/v1/chat/responses`, { method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json", "Idempotency-Key": user.id, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ message: text, conversation: state.messages.slice(-40).map(({ role, content }) => ({ role, content })) }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.message || "Chat request failed."), { code: body.code });
    const assistant = { id: String(body.id || crypto.randomUUID()), role: "assistant", content: String(body.output || ""), createdAt: new Date().toISOString(), usage: body.usage || null };
    state.messages.push(assistant); save(); return { user, assistant };
  }
  function clear() { state.messages = []; save(); }
  window.UvenaroChat = Object.freeze({ connected, send, clear, messages: () => state.messages.map(x => ({ ...x })) });
})();
