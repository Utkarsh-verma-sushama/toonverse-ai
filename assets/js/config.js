"use strict";

/* =========================================================
   ToonVerse AI
   Public Frontend Configuration — V1 Foundation

   IMPORTANT:
   Firebase's web configuration identifies the public app; it
   does not grant administrative access. Passwords, service
   account keys, private API keys, access tokens, and database
   credentials must never be placed in this file.
   ========================================================= */

window.ToonVerseConfig = Object.freeze({
  app: Object.freeze({
    name: "ToonVerse AI",
    version: "1.2.0",
    environment: "production"
  }),

  firebase: Object.freeze({
    apiKey: "AIzaSyCxYLPaubt0r17JCYpNQAGpg8y7Ki0oKXY",
    authDomain: "toonverse-ai.firebaseapp.com",
    projectId: "toonverse-ai",
    storageBucket: "toonverse-ai.firebasestorage.app",
    messagingSenderId: "594612167862",
    appId: "1:594612167862:web:ef546372ab121fcf767217",
    measurementId: "G-WGS4L16H5Z"
  }),

  services: Object.freeze({
    // Public endpoint only. Secrets and private keys belong on the backend.
    apiBaseUrl: "",
    faxApiBaseUrl: "",
    requestTimeoutMs: 30000
  }),

  paths: Object.freeze({
    home: "./",
    assets: "./assets/",
    css: "./assets/css/",
    js: "./assets/js/",
    images: "./assets/images/"
  }),

  features: Object.freeze({
    createStudio: true,
    aiEditor: true,
    library: true,
    sharing: true,
    printing: true,
    // Rollout flag only. Fax also requires a server-verified paid entitlement.
    fax: false,
    faxAllowedPlans: Object.freeze(["premium", "business", "pro"]),

    photoToCartoon: false,
    aiImageGeneration: false,
    aiCamera: false,
    aiColoringStudio: false,
    wallpaperStudio: false,
    memoryStudio: false,
    videoToText: false,
    imageToText: false,

    cloudSync: false,
    // Safe-off until production cloud bindings, identity and providers pass release gates.
    cloudBackend: false,
    autonomousAgents: false,
    multimodalModelRouting: false,
    authentication: false,
    payments: false
  }),

  ui: Object.freeze({
    defaultTheme: "dark",
    defaultLanguage: "en",
    animations: true,
    autoSave: true
  }),

  limits: Object.freeze({
    maxUploadBytes: 25 * 1024 * 1024,
    maxBatchItems: 100
  })
});
