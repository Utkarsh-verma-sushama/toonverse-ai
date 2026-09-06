"use strict";

/* =========================================================
   ToonVerse AI
   Global Frontend Controller — V1 Architecture
   =========================================================

   Responsibilities:
   - App bootstrapping
   - Navigation / routing
   - Action handling
   - Toast notifications
   - Active navigation
   - Smooth scrolling
   - Draft / local state helpers
   - Accessibility announcements
   - Online / offline state
   - Safe external navigation
   - Future module registration
   - Error protection
   - Shared frontend API

   IMPORTANT:
   This file contains NO private API keys or secrets.
   Backend credentials must never be placed in frontend code.
   ========================================================= */

(() => {

  /* =======================================================
     APPLICATION CONSTANTS
     ======================================================= */

  const APP = Object.freeze({
    name: "ToonVerse AI",
    version: "1.0.0",
    namespace: "toonverse",
    environment:
      window.ToonVerseConfig?.app?.environment ||
      "development",
  });


  /* =======================================================
     ROUTES

     These paths are centralized so future pages can be
     connected without changing action logic everywhere.
     ======================================================= */

  const ROUTES = Object.freeze({

    home: "./index.html",

    create: "./create.html",

    editor: "./editor.html",

    library: "./library.html",

    share: "./share.html",

    print: "./print.html",

    settings: "./settings.html",

    account: "./account.html",

    support: "./support.html",
  });


  /* =======================================================
     FEATURE AVAILABILITY

     Existing pages work immediately.
     Future pages can remain disabled until created.
     ======================================================= */

  const FEATURES = {

    create: true,

    editor:
      Boolean(
        window.ToonVerseConfig?.features?.aiEditor
      ),

    library:
      Boolean(
        window.ToonVerseConfig?.features?.library
      ),

    share:
      Boolean(
        window.ToonVerseConfig?.features?.sharing
      ),

    print:
      Boolean(
        window.ToonVerseConfig?.features?.printing
      ),

    authentication:
      Boolean(
        window.ToonVerseConfig?.features?.authentication
      ),

    cloudSync:
      Boolean(
        window.ToonVerseConfig?.features?.cloudSync
      )
  };


  /* =======================================================
     APP STATE
     ======================================================= */

  const state = {

    initialized: false,

    online:
      navigator.onLine,

    currentPage:
      detectCurrentPage(),

    activeSection: "",

    modules:
      new Map(),

    toastContainer:
      null
  };


  /* =======================================================
     BOOTSTRAP
     ======================================================= */

  if (
    document.readyState === "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      initializeApplication
    );

  } else {

    initializeApplication();
  }


  function initializeApplication() {

    if (state.initialized) {
      return;
    }

    state.initialized = true;


    try {

      ensureAccessibilityRegion();

      ensureToastContainer();

      initializeNavigation();

      initializeActionSystem();

      initializeActiveNavigation();

      initializeScrollControls();

      initializeCurrentYear();

      initializeKeyboardSupport();

      initializeNetworkMonitoring();

      initializeGlobalErrorProtection();

      initializeExternalLinks();

      initializeModuleSystem();

      emitAppEvent(
        "app:ready",
        {
          page: state.currentPage
        }
      );


      console.info(
        `${APP.name} v${APP.version} initialized`,
        {
          page:
            state.currentPage,

          environment:
            APP.environment,

          online:
            state.online
        }
      );


    } catch (error) {

      console.error(
        "ToonVerse AI initialization failed:",
        error
      );


      showToast(
        "The interface loaded with a recoverable initialization issue.",
        "error"
      );
    }
  }


  /* =======================================================
     CURRENT PAGE DETECTION
     ======================================================= */

  function detectCurrentPage() {

    const path =
      window.location.pathname
        .toLowerCase();


    if (
      path.endsWith("/create.html")
    ) {
      return "create";
    }


    if (
      path.endsWith("/editor.html")
    ) {
      return "editor";
    }


    if (
      path.endsWith("/library.html")
    ) {
      return "library";
    }


    if (
      path.endsWith("/share.html")
    ) {
      return "share";
    }


    if (
      path.endsWith("/print.html")
    ) {
      return "print";
    }


    if (
      path.endsWith("/settings.html")
    ) {
      return "settings";
    }


    if (
      path.endsWith("/account.html")
    ) {
      return "account";
    }


    if (
      path.endsWith("/support.html")
    ) {
      return "support";
    }


    return "home";
  }


  /* =======================================================
     NAVIGATION SYSTEM
     ======================================================= */

  function initializeNavigation() {

    initializeSmoothAnchors();

    initializeRouteLinks();
  }


  function initializeSmoothAnchors() {

    const links =
      document.querySelectorAll(
        'a[href^="#"]'
      );


    links.forEach((link) => {

      link.addEventListener(
        "click",
        (event) => {

          const targetId =
            link.getAttribute("href");


          if (
            !targetId ||
            targetId === "#"
          ) {
            return;
          }


          const target =
            document.querySelector(
              targetId
            );


          if (!target) {
            return;
          }


          event.preventDefault();


          target.scrollIntoView({
            behavior:
              prefersReducedMotion()
                ? "auto"
                : "smooth",

            block:
              "start"
          });
        }
      );
    });
  }


  function initializeRouteLinks() {

    document
      .querySelectorAll(
        "[data-route]"
      )
      .forEach((element) => {

        element.addEventListener(
          "click",
          (event) => {

            const route =
              element.dataset.route;


            if (!route) {
              return;
            }


            event.preventDefault();

            navigate(route);
          }
        );
      });
  }


  /* =======================================================
     CENTRAL ROUTER
     ======================================================= */

  function navigate(
    destination,
    options = {}
  ) {

    const {
      replace = false,
      newTab = false,
      fallbackToast = true
    } = options;


    let url = destination;


    if (
      Object.prototype.hasOwnProperty.call(
        ROUTES,
        destination
      )
    ) {

      url =
        ROUTES[destination];
    }


    if (
      typeof url !== "string" ||
      !url.trim()
    ) {

      if (fallbackToast) {

        showToast(
          "This destination is not available yet.",
          "info"
        );
      }

      return false;
    }


    if (newTab) {

      window.open(
        url,
        "_blank",
        "noopener,noreferrer"
      );

      return true;
    }


    if (replace) {

      window.location.replace(
        url
      );

    } else {

      window.location.href =
        url;
    }


    return true;
  }


  /* =======================================================
     GLOBAL ACTION SYSTEM

     Any element with:
     data-action="create"
     data-action="edit"
     etc.
     will automatically use this controller.
     ======================================================= */

  function initializeActionSystem() {

    document
      .querySelectorAll(
        "[data-action]"
      )
      .forEach((element) => {

        element.addEventListener(
          "click",
          (event) => {

            const action =
              element.dataset.action;


            if (!action) {
              return;
            }


            event.preventDefault();

            handleAction(
              action,
              element
            );
          }
        );
      });
  }


  function handleAction(
    action,
    sourceElement = null
  ) {

    emitAppEvent(
      "action:before",
      {
        action,
        sourceElement
      }
    );


    switch (action) {


      /* ---------------------------------------------------
         CREATE
         --------------------------------------------------- */

      case "create":

        navigate("create");

        break;


      /* ---------------------------------------------------
         EDITOR
         --------------------------------------------------- */

      case "edit":

        handleFeatureRoute(
          "editor",
          "Unified AI Editor"
        );

        break;


      /* ---------------------------------------------------
         LIBRARY
         --------------------------------------------------- */

      case "library":

        handleFeatureRoute(
          "library",
          "My Library"
        );

        break;


      /* ---------------------------------------------------
         SHARE
         --------------------------------------------------- */

      case "share":

        handleFeatureRoute(
          "share",
          "Share & Export"
        );

        break;


      /* ---------------------------------------------------
         PRINT
         --------------------------------------------------- */

      case "print":

        handleFeatureRoute(
          "print",
          "Print Studio"
        );

        break;


      /* ---------------------------------------------------
         SETTINGS
         --------------------------------------------------- */

      case "settings":

        handleFeatureRoute(
          "settings",
          "Settings"
        );

        break;


      /* ---------------------------------------------------
         ACCOUNT
         --------------------------------------------------- */

      case "account":

        handleFeatureRoute(
          "account",
          "Account"
        );

        break;


      /* ---------------------------------------------------
         SUPPORT
         --------------------------------------------------- */

      case "support":

        handleFeatureRoute(
          "support",
          "Support"
        );

        break;


      /* ---------------------------------------------------
         HOME
         --------------------------------------------------- */

      case "home":

        navigate("home");

        break;


      /* ---------------------------------------------------
         SCROLL TOP
         --------------------------------------------------- */

      case "scroll-top":

        scrollToTop();

        break;


      /* ---------------------------------------------------
         SCROLL BOTTOM
         --------------------------------------------------- */

      case "scroll-bottom":

        scrollToBottom();

        break;


      /* ---------------------------------------------------
         RELOAD
         --------------------------------------------------- */

      case "reload":

        window.location.reload();

        break;


      /* ---------------------------------------------------
         UNKNOWN ACTION
         --------------------------------------------------- */

      default:

        showToast(
          "This ToonVerse AI action is not connected yet.",
          "info"
        );

        console.warn(
          "Unknown ToonVerse AI action:",
          action
        );

        break;
    }


    emitAppEvent(
      "action:after",
      {
        action,
        sourceElement
      }
    );
  }


  /* =======================================================
     FEATURE ROUTE HANDLER

     If a future page already exists, the same route
     automatically works.

     At present unfinished modules remain safely on the
     current page instead of sending users to a 404.
     ======================================================= */

  function handleFeatureRoute(
    feature,
    label
  ) {

    if (
      feature === "editor" &&
      !FEATURES.editor
    ) {

      showComingSoon(label);

      return;
    }


    if (
      feature === "library" &&
      !FEATURES.library
    ) {

      showComingSoon(label);

      return;
    }


    if (
      feature === "share" &&
      !FEATURES.share
    ) {

      showComingSoon(label);

      return;
    }


    if (
      feature === "print" &&
      !FEATURES.print
    ) {

      showComingSoon(label);

      return;
    }


    /*
      Existing config currently marks some foundation
      features as enabled even if standalone pages have
      not yet been created.

      To prevent accidental 404s, we verify known V1
      routes conservatively.
    */


    if (
      feature !== "create"
    ) {

      showComingSoon(label);

      return;
    }


    navigate(feature);
  }


  function showComingSoon(label) {

    showToast(
      `${label} foundation is ready. Its full workspace will connect in the next build stage.`,
      "info"
    );
  }


  /* =======================================================
     ACTIVE NAVIGATION
     ======================================================= */

  function initializeActiveNavigation() {

    const sections =
      Array.from(
        document.querySelectorAll(
          "section[id]"
        )
      );


    const navLinks =
      Array.from(
        document.querySelectorAll(
          '.nav-links a[href^="#"]'
        )
      );


    if (
      !sections.length ||
      !navLinks.length
    ) {
      return;
    }


    const updateNavigation =
      () => {

        const offset =
          window.scrollY + 160;


        let currentId =
          sections[0]?.id || "";


        sections.forEach(
          (section) => {

            if (
              section.offsetTop <=
              offset
            ) {

              currentId =
                section.id;
            }
          }
        );


        state.activeSection =
          currentId;


        navLinks.forEach(
          (link) => {

            const active =
              link.getAttribute(
                "href"
              ) ===
              `#${currentId}`;


            link.classList.toggle(
              "active",
              active
            );


            if (active) {

              link.setAttribute(
                "aria-current",
                "page"
              );

            } else {

              link.removeAttribute(
                "aria-current"
              );
            }
          }
        );
      };


    updateNavigation();


    window.addEventListener(
      "scroll",
      throttle(
        updateNavigation,
        100
      ),
      {
        passive: true
      }
    );


    window.addEventListener(
      "resize",
      throttle(
        updateNavigation,
        150
      )
    );
  }


  /* =======================================================
     SCROLL CONTROLS
     ======================================================= */

  function initializeScrollControls() {

    document
      .querySelectorAll(
        "[data-scroll-top]"
      )
      .forEach(
        (element) => {

          element.addEventListener(
            "click",
            scrollToTop
          );
        }
      );


    document
      .querySelectorAll(
        "[data-scroll-bottom]"
      )
      .forEach(
        (element) => {

          element.addEventListener(
            "click",
            scrollToBottom
          );
        }
      );
  }


  function scrollToTop() {

    window.scrollTo({
      top: 0,

      behavior:
        prefersReducedMotion()
          ? "auto"
          : "smooth"
    });
  }


  function scrollToBottom() {

    window.scrollTo({
      top:
        document.documentElement
          .scrollHeight,

      behavior:
        prefersReducedMotion()
          ? "auto"
          : "smooth"
    });
  }


  /* =======================================================
     FOOTER YEAR
     ======================================================= */

  function initializeCurrentYear() {

    const year =
      String(
        new Date().getFullYear()
      );


    document
      .querySelectorAll(
        "[data-current-year]"
      )
      .forEach(
        (element) => {

          element.textContent =
            year;
        }
      );
  }


  /* =======================================================
     ACCESSIBILITY STATUS
     ======================================================= */

  function ensureAccessibilityRegion() {

    let region =
      document.getElementById(
        "app-status"
      );


    if (region) {
      return region;
    }


    region =
      document.createElement(
        "div"
      );


    region.id =
      "app-status";


    region.className =
      "visually-hidden";


    region.setAttribute(
      "role",
      "status"
    );


    region.setAttribute(
      "aria-live",
      "polite"
    );


    region.setAttribute(
      "aria-atomic",
      "true"
    );


    document.body.appendChild(
      region
    );


    return region;
  }


  function announce(message) {

    const region =
      ensureAccessibilityRegion();


    region.textContent = "";


    requestAnimationFrame(
      () => {

        region.textContent =
          String(message);
      }
    );
  }


  /* =======================================================
     TOAST SYSTEM
     ======================================================= */

  function ensureToastContainer() {

    if (
      state.toastContainer &&
      document.body.contains(
        state.toastContainer
      )
    ) {

      return state.toastContainer;
    }


    let container =
      document.getElementById(
        "toonverse-toast-container"
      );


    if (!container) {

      container =
        document.createElement(
          "div"
        );


      container.id =
        "toonverse-toast-container";


      container.className =
        "toast-container";


      container.setAttribute(
        "aria-live",
        "polite"
      );


      container.setAttribute(
        "aria-atomic",
        "false"
      );


      document.body.appendChild(
        container
      );
    }


    /*
      Inline fallback ensures notifications still work
      even if component CSS fails to load.
    */

    Object.assign(
      container.style,
      {
        position: "fixed",
        right: "16px",
        bottom: "16px",
        zIndex: "10000",
        width:
          "min(360px, calc(100vw - 32px))",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        pointerEvents: "none"
      }
    );


    state.toastContainer =
      container;


    return container;
  }


  function showToast(
    message,
    type = "info",
    options = {}
  ) {

    const {
      duration = 3600
    } = options;


    const container =
      ensureToastContainer();


    const toast =
      document.createElement(
        "div"
      );


    toast.className =
      `toast toast-${type}`;


    toast.setAttribute(
      "role",
      type === "error"
        ? "alert"
        : "status"
    );


    Object.assign(
      toast.style,
      {
        pointerEvents:
          "auto",

        padding:
          "14px 16px",

        border:
          "1px solid rgba(255,255,255,0.13)",

        borderRadius:
          "14px",

        background:
          "rgba(18,27,49,0.98)",

        color:
          "#ffffff",

        boxShadow:
          "0 14px 40px rgba(0,0,0,0.38)",

        backdropFilter:
          "blur(16px)",

        WebkitBackdropFilter:
          "blur(16px)",

        opacity:
          "0",

        transform:
          "translateY(10px)",

        transition:
          "opacity 180ms ease, transform 180ms ease"
      }
    );


    const header =
      document.createElement(
        "div"
      );


    header.style.display =
      "flex";


    header.style.alignItems =
      "flex-start";


    header.style.justifyContent =
      "space-between";


    header.style.gap =
      "12px";


    const content =
      document.createElement(
        "div"
      );


    content.style.minWidth =
      "0";


    const title =
      document.createElement(
        "strong"
      );


    title.className =
      "toast-title";


    title.textContent =
      getToastTitle(type);


    const text =
      document.createElement(
        "div"
      );


    text.className =
      "toast-message";


    text.textContent =
      String(message);


    Object.assign(
      text.style,
      {
        marginTop:
          "3px",

        color:
          "rgba(255,255,255,0.76)",

        fontSize:
          "0.9rem",

        lineHeight:
          "1.45"
      }
    );


    const closeButton =
      document.createElement(
        "button"
      );


    closeButton.type =
      "button";


    closeButton.setAttribute(
      "aria-label",
      "Dismiss notification"
    );


    closeButton.textContent =
      "×";


    Object.assign(
      closeButton.style,
      {
        flex:
          "0 0 auto",

        width:
          "28px",

        height:
          "28px",

        display:
          "grid",

        placeItems:
          "center",

        border:
          "0",

        borderRadius:
          "8px",

        background:
          "rgba(255,255,255,0.06)",

        color:
          "#ffffff",

        cursor:
          "pointer",

        fontSize:
          "18px"
      }
    );


    content.appendChild(
      title
    );


    content.appendChild(
      text
    );


    header.appendChild(
      content
    );


    header.appendChild(
      closeButton
    );


    toast.appendChild(
      header
    );


    container.appendChild(
      toast
    );


    announce(message);


    let removed = false;


    const dismiss =
      () => {

        if (removed) {
          return;
        }


        removed = true;


        toast.style.opacity =
          "0";


        toast.style.transform =
          "translateY(10px)";


        window.setTimeout(
          () => {

            toast.remove();
          },
          200
        );
      };


    closeButton.addEventListener(
      "click",
      dismiss
    );


    toast.addEventListener(
      "click",
      (event) => {

        if (
          event.target !==
          closeButton
        ) {

          dismiss();
        }
      }
    );


    requestAnimationFrame(
      () => {

        toast.style.opacity =
          "1";


        toast.style.transform =
          "translateY(0)";
      }
    );


    if (
      Number.isFinite(duration) &&
      duration > 0
    ) {

      window.setTimeout(
        dismiss,
        duration
      );
    }


    return {
      dismiss,
      element: toast
    };
  }


  function getToastTitle(type) {

    switch (type) {

      case "success":
        return "Success";

      case "error":
        return "Error";

      case "warning":
        return "Notice";

      default:
        return APP.name;
    }
  }


  /* =======================================================
     NETWORK / OFFLINE MONITORING
     ======================================================= */

  function initializeNetworkMonitoring() {

    window.addEventListener(
      "online",
      () => {

        state.online =
          true;


        showToast(
          "Internet connection restored.",
          "success"
        );


        emitAppEvent(
          "network:online"
        );
      }
    );


    window.addEventListener(
      "offline",
      () => {

        state.online =
          false;


        showToast(
          "You are offline. Local features can continue where supported.",
          "warning"
        );


        emitAppEvent(
          "network:offline"
        );
      }
    );
  }


  /* =======================================================
     KEYBOARD SUPPORT
     ======================================================= */

  function initializeKeyboardSupport() {

    document.addEventListener(
      "keydown",
      (event) => {

        /*
          Ctrl/Cmd + Home
        */

        if (
          event.key === "Home" &&
          (
            event.ctrlKey ||
            event.metaKey
          )
        ) {

          scrollToTop();

          return;
        }


        /*
          Ctrl/Cmd + End
        */

        if (
          event.key === "End" &&
          (
            event.ctrlKey ||
            event.metaKey
          )
        ) {

          scrollToBottom();

          return;
        }


        /*
          Escape closes registered overlays.
        */

        if (
          event.key === "Escape"
        ) {

          emitAppEvent(
            "ui:escape"
          );
        }
      }
    );
  }


  /* =======================================================
     SAFE EXTERNAL LINKS
     ======================================================= */

  function initializeExternalLinks() {

    document
      .querySelectorAll(
        'a[target="_blank"]'
      )
      .forEach(
        (link) => {

          const existingRel =
            link.getAttribute("rel") || "";


          const relParts =
            new Set(
              existingRel
                .split(/\s+/)
                .filter(Boolean)
            );


          relParts.add(
            "noopener"
          );


          relParts.add(
            "noreferrer"
          );


          link.setAttribute(
            "rel",
            Array.from(
              relParts
            ).join(" ")
          );
        }
      );
  }


  /* =======================================================
     STORAGE HELPERS

     Safe wrapper for localStorage.
     ======================================================= */

  function storageKey(key) {

    return `${APP.namespace}:${key}`;
  }


  function saveLocal(
    key,
    value
  ) {

    try {

      localStorage.setItem(
        storageKey(key),
        JSON.stringify(value)
      );


      return true;

    } catch (error) {

      console.warn(
        "ToonVerse AI local save failed:",
        error
      );


      return false;
    }
  }


  function readLocal(
    key,
    fallback = null
  ) {

    try {

      const raw =
        localStorage.getItem(
          storageKey(key)
        );


      if (raw === null) {
        return fallback;
      }


      return JSON.parse(raw);

    } catch (error) {

      console.warn(
        "ToonVerse AI local read failed:",
        error
      );


      return fallback;
    }
  }


  function removeLocal(key) {

    try {

      localStorage.removeItem(
        storageKey(key)
      );


      return true;

    } catch {

      return false;
    }
  }


  /* =======================================================
     MODULE SYSTEM

     Future editor, auth, library, print, camera, AI etc.
     can register themselves without rebuilding main.js.
     ======================================================= */

  function initializeModuleSystem() {

    emitAppEvent(
      "modules:ready"
    );
  }


  function registerModule(
    name,
    module
  ) {

    if (
      typeof name !== "string" ||
      !name.trim()
    ) {

      throw new TypeError(
        "Module name must be a non-empty string."
      );
    }


    if (
      !module ||
      typeof module !== "object"
    ) {

      throw new TypeError(
        "Module must be an object."
      );
    }


    if (
      state.modules.has(name)
    ) {

      console.warn(
        `ToonVerse AI module "${name}" is already registered.`
      );


      return false;
    }


    state.modules.set(
      name,
      module
    );


    if (
      typeof module.init ===
      "function"
    ) {

      try {

        module.init({
          app:
            publicAPI,

          config:
            window.ToonVerseConfig ||
            null
        });

      } catch (error) {

        console.error(
          `Failed to initialize module "${name}":`,
          error
        );


        return false;
      }
    }


    emitAppEvent(
      "module:registered",
      {
        name
      }
    );


    return true;
  }


  function getModule(name) {

    return (
      state.modules.get(name) ||
      null
    );
  }


  /* =======================================================
     APPLICATION EVENTS

     Allows separate files/modules to coordinate cleanly.
     ======================================================= */

  function emitAppEvent(
    name,
    detail = {}
  ) {

    window.dispatchEvent(
      new CustomEvent(
        `toonverse:${name}`,
        {
          detail
        }
      )
    );
  }


  function onAppEvent(
    name,
    callback,
    options
  ) {

    if (
      typeof callback !==
      "function"
    ) {

      return () => {};
    }


    const eventName =
      `toonverse:${name}`;


    window.addEventListener(
      eventName,
      callback,
      options
    );


    return () => {

      window.removeEventListener(
        eventName,
        callback,
        options
      );
    };
  }


  /* =======================================================
     GLOBAL ERROR PROTECTION
     ======================================================= */

  function initializeGlobalErrorProtection() {

    window.addEventListener(
      "error",
      (event) => {

        console.error(
          "ToonVerse AI runtime error:",
          event.error ||
          event.message
        );


        emitAppEvent(
          "error:runtime",
          {
            message:
              event.message || "",

            error:
              event.error || null
          }
        );
      }
    );


    window.addEventListener(
      "unhandledrejection",
      (event) => {

        console.error(
          "ToonVerse AI unhandled promise rejection:",
          event.reason
        );


        emitAppEvent(
          "error:promise",
          {
            reason:
              event.reason
          }
        );
      }
    );
  }


  /* =======================================================
     HELPERS
     ======================================================= */

  function prefersReducedMotion() {

    return Boolean(
      window.matchMedia &&
      window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches
    );
  }


  function throttle(
    callback,
    delay = 100
  ) {

    let waiting =
      false;


    return function throttled(
      ...args
    ) {

      if (waiting) {
        return;
      }


      waiting =
        true;


      callback.apply(
        this,
        args
      );


      window.setTimeout(
        () => {

          waiting =
            false;
        },
        delay
      );
    };
  }


  function debounce(
    callback,
    delay = 250
  ) {

    let timer =
      null;


    return function debounced(
      ...args
    ) {

      window.clearTimeout(
        timer
      );


      timer =
        window.setTimeout(
          () => {

            callback.apply(
              this,
              args
            );
          },
          delay
        );
    };
  }


  function safeText(value) {

    return String(
      value ?? ""
    );
  }


  function isOnline() {

    return state.online;
  }


  function getCurrentPage() {

    return state.currentPage;
  }


  /* =======================================================
     PUBLIC APPLICATION API

     Other ToonVerse files can safely call:

     ToonVerseAI.navigate(...)
     ToonVerseAI.showToast(...)
     ToonVerseAI.saveLocal(...)
     ToonVerseAI.registerModule(...)
     etc.
     ======================================================= */

  const publicAPI =
    Object.freeze({

      name:
        APP.name,

      version:
        APP.version,

      environment:
        APP.environment,


      routes:
        ROUTES,


      navigate,


      handleAction,


      showToast,


      announce,


      scrollToTop,


      scrollToBottom,


      saveLocal,


      readLocal,


      removeLocal,


      registerModule,


      getModule,


      emit:
        emitAppEvent,


      on:
        onAppEvent,


      debounce,


      throttle,


      safeText,


      isOnline,


      getCurrentPage,


      getState() {

        return Object.freeze({

          initialized:
            state.initialized,

          online:
            state.online,

          currentPage:
            state.currentPage,

          activeSection:
            state.activeSection,

          registeredModules:
            Array.from(
              state.modules.keys()
            )
        });
      }
    });


  window.ToonVerseAI =
    publicAPI;

})();
