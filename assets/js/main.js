"use strict";

/*
=========================================================
 ToonVerse AI
 MAIN.JS — CONSOLIDATED EDITOR CORE v1
=========================================================

Core responsibilities:
- Image import
- Image validation
- Zoom in / zoom out
- Rotate
- Flip horizontal / vertical
- Reset
- Drag / Pan
- Undo / Redo
- Keyboard shortcuts
- Touch / Pointer support
- Safe editor state
- Download / Export foundation
- Defensive DOM handling
- Future editor feature hooks

Architecture note:
Large future systems such as AI generation, cloud sync,
accounts, video editor, billing, etc. should remain in
separate modules.
=========================================================
*/

document.addEventListener("DOMContentLoaded", () => {
  /* =====================================================
     1. DOM HELPERS
  ===================================================== */

  const $ = (id) => document.getElementById(id);

  const elements = {
    imageInput: $("imageInput"),

    editorImage:
      $("editorImage") ||
      $("previewImage") ||
      $("canvasImage"),

    editorCanvas:
      $("editorCanvas") ||
      $("canvas") ||
      $("imageCanvas") ||
      $("workspace"),

    zoomInBtn:
      $("zoomInBtn") ||
      $("zoomIn"),

    zoomOutBtn:
      $("zoomOutBtn") ||
      $("zoomOut"),

    rotateBtn:
      $("rotateBtn") ||
      $("rotate"),

    rotateLeftBtn:
      $("rotateLeftBtn"),

    rotateRightBtn:
      $("rotateRightBtn"),

    resetBtn:
      $("resetBtn") ||
      $("reset"),

    undoBtn:
      $("undoBtn"),

    redoBtn:
      $("redoBtn"),

    flipHorizontalBtn:
      $("flipHorizontalBtn"),

    flipVerticalBtn:
      $("flipVerticalBtn"),

    downloadBtn:
      $("downloadBtn") ||
      $("saveBtn") ||
      $("exportBtn"),

    statusText:
      $("statusText") ||
      $("editorStatus")
  };


  /* =====================================================
     2. EDITOR CONFIGURATION
  ===================================================== */

  const CONFIG = {
    minScale: 0.2,
    maxScale: 5,
    zoomStep: 0.2,

    rotationStep: 90,

    maxFileSizeMB: 25,

    acceptedTypes: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif"
    ],

    transitionDuration: 180,

    maxHistory: 50
  };


  /* =====================================================
     3. EDITOR STATE
  ===================================================== */

  const state = {
    scale: 1,

    rotation: 0,

    flipX: 1,
    flipY: 1,

    translateX: 0,
    translateY: 0,

    imageLoaded: false,

    fileName: "",

    dragging: false,

    pointerStartX: 0,
    pointerStartY: 0,

    dragStartX: 0,
    dragStartY: 0,

    history: [],
    historyIndex: -1
  };


  /* =====================================================
     4. UTILITY FUNCTIONS
  ===================================================== */

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }


  function normalizeRotation(rotation) {
    let result = rotation % 360;

    if (result < 0) {
      result += 360;
    }

    return result;
  }


  function setStatus(message = "") {
    if (elements.statusText) {
      elements.statusText.textContent = message;
    }
  }


  function logError(context, error) {
    console.error(`[ToonVerse AI] ${context}:`, error);
  }


  function hasImage() {
    return Boolean(
      elements.editorImage &&
      state.imageLoaded &&
      elements.editorImage.src
    );
  }


  /* =====================================================
     5. TRANSFORM ENGINE
  ===================================================== */

  function applyTransform(animate = true) {
    if (!elements.editorImage) {
      return;
    }

    const image = elements.editorImage;

    image.style.transformOrigin = "center center";

    image.style.transition = animate
      ? `transform ${CONFIG.transitionDuration}ms ease`
      : "none";

    image.style.transform = `
      translate(${state.translateX}px, ${state.translateY}px)
      scale(${state.scale})
      rotate(${state.rotation}deg)
      scaleX(${state.flipX})
      scaleY(${state.flipY})
    `.replace(/\s+/g, " ").trim();

    updateButtonStates();
  }


  /* =====================================================
     6. HISTORY / UNDO / REDO
  ===================================================== */

  function captureState() {
    return {
      scale: state.scale,
      rotation: state.rotation,
      flipX: state.flipX,
      flipY: state.flipY,
      translateX: state.translateX,
      translateY: state.translateY
    };
  }


  function restoreState(savedState) {
    if (!savedState) return;

    state.scale = savedState.scale;
    state.rotation = savedState.rotation;

    state.flipX = savedState.flipX;
    state.flipY = savedState.flipY;

    state.translateX = savedState.translateX;
    state.translateY = savedState.translateY;

    applyTransform();
  }


  function pushHistory() {
    if (!state.imageLoaded) return;

    const snapshot = captureState();

    state.history = state.history.slice(
      0,
      state.historyIndex + 1
    );

    state.history.push(snapshot);

    if (state.history.length > CONFIG.maxHistory) {
      state.history.shift();
    }

    state.historyIndex = state.history.length - 1;

    updateButtonStates();
  }


  function undo() {
    if (state.historyIndex <= 0) {
      return;
    }

    state.historyIndex--;

    restoreState(
      state.history[state.historyIndex]
    );

    setStatus("Undo");
  }


  function redo() {
    if (
      state.historyIndex >=
      state.history.length - 1
    ) {
      return;
    }

    state.historyIndex++;

    restoreState(
      state.history[state.historyIndex]
    );

    setStatus("Redo");
  }


  /* =====================================================
     7. RESET ENGINE
  ===================================================== */

  function resetTransform({
    saveHistory = true
  } = {}) {

    state.scale = 1;
    state.rotation = 0;

    state.flipX = 1;
    state.flipY = 1;

    state.translateX = 0;
    state.translateY = 0;

    applyTransform();

    if (saveHistory && state.imageLoaded) {
      pushHistory();
    }

    setStatus("Image reset");
  }


  /* =====================================================
     8. IMAGE VALIDATION
  ===================================================== */

  function validateImageFile(file) {

    if (!file) {
      return {
        valid: false,
        message: "No image selected."
      };
    }

    const isAcceptedMime =
      CONFIG.acceptedTypes.includes(file.type) ||
      file.type.startsWith("image/");

    if (!isAcceptedMime) {
      return {
        valid: false,
        message: "Please select a valid image file."
      };
    }

    const maxBytes =
      CONFIG.maxFileSizeMB *
      1024 *
      1024;

    if (file.size > maxBytes) {
      return {
        valid: false,
        message:
          `Image must be smaller than ${CONFIG.maxFileSizeMB} MB.`
      };
    }

    return {
      valid: true
    };
  }


  /* =====================================================
     9. IMAGE IMPORT ENGINE
  ===================================================== */

  function loadImageFile(file) {

    if (!elements.editorImage) {
      logError(
        "Image Import",
        new Error(
          "Editor image element was not found."
        )
      );

      return;
    }

    const validation =
      validateImageFile(file);

    if (!validation.valid) {
      alert(validation.message);
      return;
    }

    const reader = new FileReader();

    setStatus("Loading image...");


    reader.onload = (event) => {

      try {

        const imageSource =
          event.target.result;

        elements.editorImage.onload = () => {

          state.imageLoaded = true;
          state.fileName =
            file.name || "toonverse-image";

          elements.editorImage.style.display =
            "block";

          resetTransform({
            saveHistory: false
          });

          state.history = [];
          state.historyIndex = -1;

          pushHistory();

          setStatus("Image ready");
        };


        elements.editorImage.onerror = () => {

          state.imageLoaded = false;

          setStatus(
            "Unable to load image."
          );

          alert(
            "The selected image could not be loaded."
          );
        };


        elements.editorImage.src =
          imageSource;

      } catch (error) {

        logError(
          "Image Loading",
          error
        );

        alert(
          "Something went wrong while loading the image."
        );
      }
    };


    reader.onerror = () => {

      alert(
        "Unable to read this image file."
      );

      setStatus(
        "Image loading failed"
      );
    };


    reader.readAsDataURL(file);
  }


  /* =====================================================
     10. ZOOM ENGINE
  ===================================================== */

  function zoomIn() {

    if (!hasImage()) return;

    const nextScale =
      clamp(
        state.scale +
        CONFIG.zoomStep,

        CONFIG.minScale,
        CONFIG.maxScale
      );

    if (nextScale === state.scale) {
      return;
    }

    state.scale = nextScale;

    applyTransform();

    pushHistory();

    setStatus(
      `Zoom: ${Math.round(
        state.scale * 100
      )}%`
    );
  }


  function zoomOut() {

    if (!hasImage()) return;

    const nextScale =
      clamp(
        state.scale -
        CONFIG.zoomStep,

        CONFIG.minScale,
        CONFIG.maxScale
      );

    if (nextScale === state.scale) {
      return;
    }

    state.scale = nextScale;

    applyTransform();

    pushHistory();

    setStatus(
      `Zoom: ${Math.round(
        state.scale * 100
      )}%`
    );
  }


  /* =====================================================
     11. ROTATION ENGINE
  ===================================================== */

  function rotateRight() {

    if (!hasImage()) return;

    state.rotation =
      normalizeRotation(
        state.rotation +
        CONFIG.rotationStep
      );

    applyTransform();

    pushHistory();

    setStatus(
      `Rotation: ${state.rotation}°`
    );
  }


  function rotateLeft() {

    if (!hasImage()) return;

    state.rotation =
      normalizeRotation(
        state.rotation -
        CONFIG.rotationStep
      );

    applyTransform();

    pushHistory();

    setStatus(
      `Rotation: ${state.rotation}°`
    );
  }


  /* =====================================================
     12. FLIP ENGINE
  ===================================================== */

  function flipHorizontal() {

    if (!hasImage()) return;

    state.flipX *= -1;

    applyTransform();

    pushHistory();

    setStatus(
      "Flipped horizontally"
    );
  }


  function flipVertical() {

    if (!hasImage()) return;

    state.flipY *= -1;

    applyTransform();

    pushHistory();

    setStatus(
      "Flipped vertically"
    );
  }


  /* =====================================================
     13. DRAG / PAN ENGINE
  ===================================================== */

  function pointerDown(event) {

    if (!hasImage()) return;

    /*
      Only primary pointer / touch.
    */

    if (
      event.pointerType === "mouse" &&
      event.button !== 0
    ) {
      return;
    }

    state.dragging = true;

    state.pointerStartX =
      event.clientX;

    state.pointerStartY =
      event.clientY;

    state.dragStartX =
      state.translateX;

    state.dragStartY =
      state.translateY;

    elements.editorImage
      ?.setPointerCapture?.(
        event.pointerId
      );
  }


  function pointerMove(event) {

    if (!state.dragging) {
      return;
    }

    const deltaX =
      event.clientX -
      state.pointerStartX;

    const deltaY =
      event.clientY -
      state.pointerStartY;

    state.translateX =
      state.dragStartX +
      deltaX;

    state.translateY =
      state.dragStartY +
      deltaY;

    applyTransform(false);
  }


  function pointerUp(event) {

    if (!state.dragging) {
      return;
    }

    state.dragging = false;

    elements.editorImage
      ?.releasePointerCapture?.(
        event.pointerId
      );

    applyTransform();

    pushHistory();

    setStatus(
      "Image moved"
    );
  }


  /* =====================================================
     14. BUTTON STATE MANAGEMENT
  ===================================================== */

  function updateButtonStates() {

    const imageAvailable =
      hasImage();

    const disableWithoutImage = [
      elements.zoomInBtn,
      elements.zoomOutBtn,
      elements.rotateBtn,
      elements.rotateLeftBtn,
      elements.rotateRightBtn,
      elements.resetBtn,
      elements.flipHorizontalBtn,
      elements.flipVerticalBtn,
      elements.downloadBtn
    ];

    disableWithoutImage.forEach(
      (button) => {

        if (!button) return;

        button.disabled =
          !imageAvailable;
      }
    );


    if (elements.undoBtn) {

      elements.undoBtn.disabled =
        !imageAvailable ||
        state.historyIndex <= 0;
    }


    if (elements.redoBtn) {

      elements.redoBtn.disabled =
        !imageAvailable ||
        state.historyIndex >=
          state.history.length - 1;
    }
  }


  /* =====================================================
     15. DOWNLOAD / EXPORT FOUNDATION
  ===================================================== */

  function downloadImage() {

    if (!hasImage()) {
      return;
    }

    /*
    IMPORTANT:

    This downloads the currently loaded source image.

    When crop/filter/full canvas rendering is added later,
    this function can be replaced by a canvas renderer
    without changing the rest of the editor architecture.
    */

    try {

      const anchor =
        document.createElement("a");

      anchor.href =
        elements.editorImage.src;

      anchor.download =
        state.fileName ||
        "toonverse-image.png";

      document.body.appendChild(anchor);

      anchor.click();

      anchor.remove();

      setStatus(
        "Download started"
      );

    } catch (error) {

      logError(
        "Image Download",
        error
      );

      alert(
        "Unable to download the image."
      );
    }
  }


  /* =====================================================
     16. BUTTON EVENT BINDING
  ===================================================== */

  function bindButton(
    button,
    handler
  ) {

    if (!button) return;

    button.addEventListener(
      "click",
      (event) => {

        event.preventDefault();
        event.stopPropagation();

        try {

          handler();

        } catch (error) {

          logError(
            "Editor Button",
            error
          );
        }
      }
    );
  }


  bindButton(
    elements.zoomInBtn,
    zoomIn
  );


  bindButton(
    elements.zoomOutBtn,
    zoomOut
  );


  /*
  Existing single Rotate button
  rotates clockwise.
  */

  bindButton(
    elements.rotateBtn,
    rotateRight
  );


  bindButton(
    elements.rotateRightBtn,
    rotateRight
  );


  bindButton(
    elements.rotateLeftBtn,
    rotateLeft
  );


  bindButton(
    elements.resetBtn,
    () =>
      resetTransform({
        saveHistory: true
      })
  );


  bindButton(
    elements.undoBtn,
    undo
  );


  bindButton(
    elements.redoBtn,
    redo
  );


  bindButton(
    elements.flipHorizontalBtn,
    flipHorizontal
  );


  bindButton(
    elements.flipVerticalBtn,
    flipVertical
  );


  bindButton(
    elements.downloadBtn,
    downloadImage
  );


  /* =====================================================
     17. FILE INPUT EVENT
  ===================================================== */

  if (elements.imageInput) {

    elements.imageInput.addEventListener(
      "change",
      (event) => {

        const file =
          event.target.files?.[0];

        if (file) {
          loadImageFile(file);
        }
      }
    );
  }


  /* =====================================================
     18. IMAGE POINTER EVENTS
  ===================================================== */

  if (elements.editorImage) {

    elements.editorImage.style.userSelect =
      "none";

    elements.editorImage.style.webkitUserDrag =
      "none";

    elements.editorImage.style.touchAction =
      "none";

    elements.editorImage.style.cursor =
      "grab";


    elements.editorImage.addEventListener(
      "dragstart",
      (event) =>
        event.preventDefault()
    );


    elements.editorImage.addEventListener(
      "pointerdown",
      (event) => {

        pointerDown(event);

        if (state.dragging) {

          elements.editorImage.style.cursor =
            "grabbing";
        }
      }
    );


    elements.editorImage.addEventListener(
      "pointermove",
      pointerMove
    );


    elements.editorImage.addEventListener(
      "pointerup",
      (event) => {

        pointerUp(event);

        elements.editorImage.style.cursor =
          "grab";
      }
    );


    elements.editorImage.addEventListener(
      "pointercancel",
      (event) => {

        pointerUp(event);

        elements.editorImage.style.cursor =
          "grab";
      }
    );
  }


  /* =====================================================
     19. KEYBOARD SHORTCUTS
  ===================================================== */

  document.addEventListener(
    "keydown",
    (event) => {

      /*
      Ignore keyboard shortcuts while typing
      into inputs / text areas.
      */

      const target =
        event.target;

      const typing =
        target &&
        (
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable
        );

      if (typing) {
        return;
      }


      const ctrlOrCmd =
        event.ctrlKey ||
        event.metaKey;


      /* CTRL/CMD + Z */
      if (
        ctrlOrCmd &&
        event.key.toLowerCase() === "z" &&
        !event.shiftKey
      ) {

        event.preventDefault();

        undo();

        return;
      }


      /* CTRL/CMD + SHIFT + Z */
      if (
        ctrlOrCmd &&
        event.shiftKey &&
        event.key.toLowerCase() === "z"
      ) {

        event.preventDefault();

        redo();

        return;
      }


      /* CTRL/CMD + Y */
      if (
        ctrlOrCmd &&
        event.key.toLowerCase() === "y"
      ) {

        event.preventDefault();

        redo();

        return;
      }


      /*
      + key
      */

      if (
        event.key === "+" ||
        event.key === "="
      ) {

        event.preventDefault();

        zoomIn();

        return;
      }


      /*
      - key
      */

      if (
        event.key === "-"
      ) {

        event.preventDefault();

        zoomOut();

        return;
      }


      /*
      R = rotate right
      */

      if (
        event.key.toLowerCase() === "r"
      ) {

        event.preventDefault();

        rotateRight();

        return;
      }


      /*
      0 = reset
      */

      if (
        event.key === "0"
      ) {

        event.preventDefault();

        resetTransform({
          saveHistory: true
        });
      }
    }
  );


  /* =====================================================
     20. FUTURE FEATURE HOOKS
  ===================================================== */

  /*
  These functions intentionally exist now so later
  modules can connect without restructuring main.js.
  */


  window.ToonVerseEditor = {

    getState() {
      return {
        ...captureState(),

        imageLoaded:
          state.imageLoaded,

        fileName:
          state.fileName
      };
    },


    zoomIn,

    zoomOut,

    rotateLeft,

    rotateRight,

    reset() {

      resetTransform({
        saveHistory: true
      });
    },

    undo,

    redo,

    flipHorizontal,

    flipVertical,


    /*
    Future features can call this
    after externally changing state.
    */

    refresh() {
      applyTransform();
    },


    /*
    Future crop module hook
    */

    crop: null,


    /*
    Future filters module hook
    */

    filters: null,


    /*
    Future AI tools module hook
    */

    aiTools: null
  };


  /* =====================================================
     21. INITIALIZATION
  ===================================================== */

  updateButtonStates();

  applyTransform(false);

  setStatus(
    "Editor ready"
  );

  console.log(
    "[ToonVerse AI] Editor Core v1 initialized."
  );
});
