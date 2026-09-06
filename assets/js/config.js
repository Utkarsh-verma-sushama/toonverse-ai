"use strict";

/* =========================================================
   ToonVerse AI
   Public Frontend Configuration — V1 Foundation

   IMPORTANT:
   Never place passwords, private API keys, access tokens,
   database credentials, or other secrets in this file.
   ========================================================= */

window.ToonVerseConfig = Object.freeze({
  app: Object.freeze({
    name: "ToonVerse AI",
    version: "1.0.0",
    environment: "development"
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

    photoToCartoon: false,
    aiImageGeneration: false,
    aiCamera: false,
    aiColoringStudio: false,
    wallpaperStudio: false,
    memoryStudio: false,
    videoToText: false,
    imageToText: false,

    cloudSync: false,
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
