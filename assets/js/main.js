"use strict";

/* =========================================================
   ToonVerse AI
   Global Frontend Controller — V1.1 Stable Foundation

   Core responsibilities:
   - App bootstrap
   - Central routing
   - Home/Create/Editor navigation
   - Safe placeholder handling for future pages
   - Global actions
   - Toast notifications
   - Accessibility announcements
   - Active section navigation
   - Scroll controls
   - Network state
   - Local storage helpers
   - App-wide event system
   - Future module registration
   - Runtime protection

   IMPORTANT:
   Never place private API keys, secrets, passwords,
   access tokens or backend credentials in frontend JS.
   ========================================================= */

(() => {

  /* =======================================================
     APP CONSTANTS
     ======================================================= */

  const APP = Object.freeze({
    name: "ToonVerse AI",
    version: "1.1.0",
    namespace: "toonverse",
    environment:
      window.ToonVerseConfig?.app?.environment ||
      "development"
  });


  /* =======================================================
     ROUTE REGISTRY

     "enabled" means the standalone page is now live.

     As future pages are created, only their enabled state
     needs to become true. The central routing structure
     does not need to be redesigned.
     ======================================================= */

  const ROUTES = Object.freeze({

    home: Object.freeze({
      path: "./index.html",
      enabled: true,
      label: "Home"
    }),

    create: Object.freeze({
      path: "./create.html",
      enabled: true,
      label: "Create Studio"
    }),

    editor: Object.freeze({
      path: "./editor.html",
      enabled: true,
      label: "Unified AI Editor"
    }),

    library: Object.freeze({
      path: "./library.html",
      enabled: false,
      label: "My Library"
    }),

    share: Object.freeze({
      path: "./share.html",
      enabled: false,
      label: "Share & Export"
    }),

    print: Object.freeze({
      path: "./print.html",
      enabled: false,
      label: "Print Studio"
    }),

    settings: Object.freeze({
      path: "./settings.html",
      enabled: false,
      label: "Settings"
    }),

    account: Object.freeze({
      path: "./account.html",
      enabled: false,
      label: "Account"
    }),

    support: Object.freeze({
      path: "./support.html",
      enabled: false,
      label: "Support"
    })
  });


  /* =======================================================
     RUNTIME STATE
     ======================================================= */

  const state = {
    initialized: false,
    online: navigator.onLine,
    currentPage: detectCurrentPage(),
    activeSection: "",
    modules: new Map(),
    toastContainer: null
  };


  /* =======================================================
     BOOTSTRAP
     ======================================================= */

  if (document.readyState === "loading") {

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

      initializeGlobalActions();

      initializeActiveNavigation();

      initializeScrollControls();

      initializeCurrentYear();

      initializeKeyboardSupport();

      initializeNetworkMonitoring();

      initializeExternalLinkSafety();

      initializeErrorProtection();

      emitAppEvent(
        "app:ready",
        {
          page: state.currentPage,
          version: APP.version
        }
      );


      console.info(
        `${APP.name} v${APP.version} initialized`,
        {
          page: state.currentPage,
          environment: APP.environment,
          online: state.online
        }
      );


    } catch (error) {

      console.error(
        "ToonVerse AI initialization error:",
        error
      );


      showToast(
        "The interface loaded with a recoverable startup issue.",
        "error"
      );
    }
  }


  /* =======================================================
     PAGE DETECTION
     ======================================================= */

  function detectCurrentPage() {

    const path =
      window.location.pathname
        .toLowerCase();


    const entries =
      Object.entries(ROUTES);


    for (
      const [name, route]
      of entries
    ) {

      if (name === "home") {
        continue;
      }


      if (
        path.endsWith(
          route.path.replace("./", "/")
        )
      ) {

        return name;
      }
    }


    return "home";
  }


  /* =======================================================
     CENTRAL NAVIGATION
     ======================================================= */

  function navigate(
    destination,
    options = {}
  ) {

    const {
      replace = false,
      newTab = false,
      force = false
    } = options;


    /* -----------------------------------------------------
       Route name
       ----------------------------------------------------- */

    if (
      typeof destination === "string" &&
      Object.prototype.hasOwnProperty.call(
        ROUTES,
        destination
      )
    ) {

      const route =
        ROUTES[destination];


      if (
        !route.enabled &&
        !force
      ) {

        showUnavailableRoute(
          route
        );

        return false;
      }


      return openURL(
        route.path,
        {
          replace,
          newTab
        }
      );
    }


    /* -----------------------------------------------------
       Direct URL/path
       ----------------------------------------------------- */

    if (
      typeof destination !== "string" ||
      !destination.trim()
    ) {

      showToast(
        "This destination is not available.",
        "info"
      );

      return false;
    }


    return openURL(
      destination,
      {
        replace,
        newTab
      }
    );
  }


  function openURL(
    url,
    options = {}
  ) {

    const {
      replace = false,
      newTab = false
    } = options;


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


  function showUnavailableRoute(
    route
  ) {

    showToast(
      `${route.label} foundation is prepared, but its standalone workspace is not live yet.`,
      "info"
    );
  }


  /* =======================================================
     GLOBAL ACTION SYSTEM

     Existing HTML can use:
     data-action="create"
     data-action="edit"
     data-action="library"
     data-action="share"
     data-action="print"
     etc.
     ======================================================= */

  function initializeGlobalActions() {

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

      case "home":
        navigate("home");
        break;

      case "create":
        navigate("create");
        break;

      case "edit":
      case "editor":
        navigate("editor");
        break;

      case "library":
        navigate("library");
        break;

      case "share":
        navigate("share");
        break;

      case "print":
        navigate("print");
        break;

      case "settings":
        navigate("settings");
        break;

      case "account":
        navigate("account");
        break;

      case "support":
        navigate("support");
        break;

      case "scroll-top":
        scrollToTop();
        break;

      case "scroll-bottom":
        scrollToBottom();
        break;

      case "reload":
        window.location.reload();
        break;

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
     NAVIGATION LINKS
     ======================================================= */

  function initializeNavigation() {

    initializeSmoothAnchors();

    initializeDataRoutes();
  }


  function initializeSmoothAnchors() {

    document
      .querySelectorAll(
        'a[href^="#"]'
      )
      .forEach((link) => {

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


  function initializeDataRoutes() {

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
     ACTIVE HOME NAVIGATION
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


    const update =
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


    update();


    window.addEventListener(
      "scroll",
      throttle(
        update,
        100
      ),
      {
        passive: true
      }
    );


    window.addEventListener(
      "resize",
      throttle(
        update,
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
      .forEach((element) => {

        element.addEventListener(
          "click",
          scrollToTop
        );
      });


    document
      .querySelectorAll(
        "[data-scroll-bottom]"
      )
      .forEach((element) => {

        element.addEventListener(
          "click",
          scrollToBottom
        );
      });
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
      .forEach((element) => {

        element.textContent =
          year;
      });
  }


  /* =======================================================
     ACCESSIBILITY
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


    Object.assign(
      container.style,
      {
        position:
          "fixed",

        right:
          "16px",

        bottom:
          "16px",

        zIndex:
          "10000",

        width:
          "min(360px, calc(100vw - 32px))",

        display:
          "flex",

        flexDirection:
          "column",

        gap:
          "10px",

        pointerEvents:
          "none"
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

    const duration =
      Number.isFinite(
        options.duration
      )
        ? options.duration
        : 3600;


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
          "1px solid rgba(255,255,255,.13)",

        borderRadius:
          "14px",

        background:
          "rgba(18,27,49,.98)",

        color:
          "#fff",

        boxShadow:
          "0 14px 40px rgba(0,0,0,.38)",

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


    const row =
      document.createElement(
        "div"
      );


    Object.assign(
      row.style,
      {
        display:
          "flex",

        alignItems:
          "flex-start",

        justifyContent:
          "space-between",

        gap:
          "12px"
      }
    );


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


    title.textContent =
      getToastTitle(type);


    title.style.display =
      "block";


    const text =
      document.createElement(
        "div"
      );


    text.textContent =
      String(message);


    Object.assign(
      text.style,
      {
        marginTop:
          "3px",

        color:
          "rgba(255,255,255,.76)",

        fontSize:
          ".9rem",

        lineHeight:
          "1.45"
      }
    );


    const close =
      document.createElement(
        "button"
      );


    close.type =
      "button";


    close.setAttribute(
      "aria-label",
      "Dismiss notification"
    );


    close.textContent =
      "×";


    Object.assign(
      close.style,
      {
        width:
          "28px",

        height:
          "28px",

        flex:
          "0 0 auto",

        display:
          "grid",

        placeItems:
          "center",

        border:
          "0",

        borderRadius:
          "8px",

        background:
          "rgba(255,255,255,.06)",

        color:
          "#fff",

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


    row.appendChild(
      content
    );


    row.appendChild(
      close
    );


    toast.appendChild(
      row
    );


    container.appendChild(
      toast
    );


    announce(message);


    let removed =
      false;


    const dismiss =
      () => {

        if (removed) {
          return;
        }


        removed =
          true;


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


    close.addEventListener(
      "click",
      dismiss
    );


    toast.addEventListener(
      "click",
      (event) => {

        if (
          event.target !== close
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


    if (duration > 0) {

      window.setTimeout(
        dismiss,
        duration
      );
    }


    return Object.freeze({
      element: toast,
      dismiss
    });
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
     NETWORK STATE
     ======================================================= */

  function initializeNetworkMonitoring() {

    window.addEventListener(
      "online",
      () => {

        state.online =
          true;


        emitAppEvent(
          "network:online"
        );


        showToast(
          "Internet connection restored.",
          "success"
        );
      }
    );


    window.addEventListener(
      "offline",
      () => {

        state.online =
          false;


        emitAppEvent(
          "network:offline"
        );


        showToast(
          "You are offline. Local features can continue where supported.",
          "warning"
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
     EXTERNAL LINK SAFETY
     ======================================================= */

  function initializeExternalLinkSafety() {

    document
      .querySelectorAll(
        'a[target="_blank"]'
      )
      .forEach((link) => {

        const existing =
          link.getAttribute("rel") || "";


        const values =
          new Set(
            existing
              .split(/\s+/)
              .filter(Boolean)
          );


        values.add(
          "noopener"
        );


        values.add(
          "noreferrer"
        );


        link.setAttribute(
          "rel",
          Array.from(values).join(" ")
        );
      });
  }


  /* =======================================================
     STORAGE HELPERS
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
     MODULE REGISTRY

     Future files such as:
     editor-engine.js
     auth.js
     cloud-sync.js
     print.js
     etc.
     can register themselves here.
     ======================================================= */

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
        `Module "${name}" is already registered.`
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
          app: publicAPI,
          config:
            window.ToonVerseConfig ||
            null
        });

      } catch (error) {

        console.error(
          `Module "${name}" initialization failed:`,
          error
        );


        state.modules.delete(
          name
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
     APP EVENT BUS
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
     ERROR PROTECTION
     ======================================================= */

  function initializeErrorProtection() {

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
          "ToonVerse AI promise rejection:",
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
     UTILITIES
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


  function getCurrentPage() {

    return state.currentPage;
  }


  function isOnline() {

    return state.online;
  }


  function getRoute(name) {

    return (
      ROUTES[name] ||
      null
    );
  }


  /* =======================================================
     PUBLIC API
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

      throttle,

      debounce,

      isOnline,

      getCurrentPage,

      getRoute,

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
