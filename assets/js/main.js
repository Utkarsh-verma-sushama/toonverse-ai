"use strict";

/* =========================================================
   ToonVerse AI
   Main JavaScript — V1 Foundation
   ========================================================= */

(() => {
  const APP = {
    name: "ToonVerse AI",
    version: "1.0.0",
  };

  document.addEventListener("DOMContentLoaded", initApp);

  function initApp() {
    try {
      initSmoothNavigation();
      initActiveNavigation();
      initActionButtons();
      initScrollControls();
      initCurrentYear();
      initKeyboardSupport();
      ensureToastContainer();

      console.info(`${APP.name} v${APP.version} initialized`);
    } catch (error) {
      console.error("ToonVerse AI initialization error:", error);
    }
  }

  /* =======================================================
     SMOOTH NAVIGATION
     ======================================================= */

  function initSmoothNavigation() {
    const links = document.querySelectorAll('a[href^="#"]');

    links.forEach((link) => {
      link.addEventListener("click", (event) => {
        const targetId = link.getAttribute("href");

        if (!targetId || targetId === "#") {
          return;
        }

        const target = document.querySelector(targetId);

        if (!target) {
          return;
        }

        event.preventDefault();

        target.scrollIntoView({
          behavior: prefersReducedMotion() ? "auto" : "smooth",
          block: "start",
        });
      });
    });
  }

  /* =======================================================
     ACTIVE NAVIGATION
     ======================================================= */

  function initActiveNavigation() {
    const sections = Array.from(
      document.querySelectorAll("section[id]")
    );

    const navLinks = Array.from(
      document.querySelectorAll('.nav-links a[href^="#"]')
    );

    if (!sections.length || !navLinks.length) {
      return;
    }

    const updateActiveNavigation = () => {
      const offset = window.scrollY + 160;
      let currentId = sections[0]?.id || "";

      sections.forEach((section) => {
        if (section.offsetTop <= offset) {
          currentId = section.id;
        }
      });

      navLinks.forEach((link) => {
        const isActive =
          link.getAttribute("href") === `#${currentId}`;

        link.classList.toggle("active", isActive);

        if (isActive) {
          link.setAttribute("aria-current", "page");
        } else {
          link.removeAttribute("aria-current");
        }
      });
    };

    updateActiveNavigation();

    window.addEventListener(
      "scroll",
      throttle(updateActiveNavigation, 100),
      { passive: true }
    );

    window.addEventListener(
      "resize",
      throttle(updateActiveNavigation, 150)
    );
  }

  /* =======================================================
     ACTION BUTTONS
     ======================================================= */

  function initActionButtons() {
    const buttons = document.querySelectorAll("[data-action]");

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.action;

        handleAction(action);
      });
    });
  }

  function handleAction(action) {
    switch (action) {
      case "create":
        showToast(
          "Create Studio foundation is ready. AI creation tools will connect here.",
          "info"
        );
        break;

      case "edit":
        showToast(
          "Unified AI Editor foundation is ready. Editing tools will connect here.",
          "info"
        );
        break;

      case "library":
        showToast(
          "My Library foundation is ready. Projects and cloud sync will connect here.",
          "info"
        );
        break;

      case "share":
        showToast(
          "Share & Export foundation is ready. Export workflows will connect here.",
          "info"
        );
        break;

      case "print":
        showToast(
          "Print Studio foundation is ready. Printer workflows will connect here.",
          "info"
        );
        break;

      default:
        showToast(
          "This ToonVerse AI feature is being prepared.",
          "info"
        );
    }
  }

  /* =======================================================
     TOAST NOTIFICATION SYSTEM
     ======================================================= */

  function ensureToastContainer() {
    let container = document.getElementById(
      "toonverse-toast-container"
    );

    if (container) {
      return container;
    }

    container = document.createElement("div");
    container.id = "toonverse-toast-container";

    container.setAttribute("aria-live", "polite");
    container.setAttribute("aria-atomic", "true");

    Object.assign(container.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      zIndex: "99999",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
      width: "min(360px, calc(100vw - 32px))",
      pointerEvents: "none",
    });

    document.body.appendChild(container);

    return container;
  }

  function showToast(message, type = "info") {
    const container = ensureToastContainer();

    const toast = document.createElement("div");

    toast.setAttribute("role", "status");

    Object.assign(toast.style, {
      pointerEvents: "auto",
      padding: "14px 16px",
      borderRadius: "14px",
      background: "rgba(18, 27, 49, 0.97)",
      color: "#ffffff",
      border: "1px solid rgba(255,255,255,0.14)",
      boxShadow: "0 12px 35px rgba(0,0,0,0.35)",
      backdropFilter: "blur(14px)",
      WebkitBackdropFilter: "blur(14px)",
      fontSize: "14px",
      lineHeight: "1.45",
      opacity: "0",
      transform: "translateY(10px)",
      transition:
        "opacity 180ms ease, transform 180ms ease",
    });

    const title = document.createElement("strong");

    title.textContent =
      type === "success"
        ? "Success"
        : type === "error"
        ? "Error"
        : APP.name;

    title.style.display = "block";
    title.style.marginBottom = "4px";

    const text = document.createElement("span");
    text.textContent = message;

    toast.appendChild(title);
    toast.appendChild(text);

    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateY(0)";
    });

    const dismiss = () => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(10px)";

      window.setTimeout(() => {
        toast.remove();
      }, 200);
    };

    toast.addEventListener("click", dismiss);

    window.setTimeout(dismiss, 3600);
  }

  /* =======================================================
     SCROLL CONTROLS
     ======================================================= */

  function initScrollControls() {
    const topButton =
      document.querySelector("[data-scroll-top]");

    const bottomButton =
      document.querySelector("[data-scroll-bottom]");

    if (topButton) {
      topButton.addEventListener("click", () => {
        window.scrollTo({
          top: 0,
          behavior: prefersReducedMotion()
            ? "auto"
            : "smooth",
        });
      });
    }

    if (bottomButton) {
      bottomButton.addEventListener("click", () => {
        window.scrollTo({
          top: document.documentElement.scrollHeight,
          behavior: prefersReducedMotion()
            ? "auto"
            : "smooth",
        });
      });
    }
  }

  /* =======================================================
     CURRENT YEAR
     ======================================================= */

  function initCurrentYear() {
    const elements =
      document.querySelectorAll("[data-current-year]");

    const year = String(new Date().getFullYear());

    elements.forEach((element) => {
      element.textContent = year;
    });
  }

  /* =======================================================
     KEYBOARD ACCESSIBILITY
     ======================================================= */

  function initKeyboardSupport() {
    document.addEventListener("keydown", (event) => {
      if (event.key === "Home" && event.ctrlKey) {
        window.scrollTo({
          top: 0,
          behavior: prefersReducedMotion()
            ? "auto"
            : "smooth",
        });
      }

      if (event.key === "End" && event.ctrlKey) {
        window.scrollTo({
          top: document.documentElement.scrollHeight,
          behavior: prefersReducedMotion()
            ? "auto"
            : "smooth",
        });
      }
    });
  }

  /* =======================================================
     HELPERS
     ======================================================= */

  function prefersReducedMotion() {
    return window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
  }

  function throttle(callback, delay = 100) {
    let waiting = false;

    return (...args) => {
      if (waiting) {
        return;
      }

      waiting = true;

      callback(...args);

      window.setTimeout(() => {
        waiting = false;
      }, delay);
    };
  }

  /* =======================================================
     GLOBAL PUBLIC API
     Future modules can safely call these.
     ======================================================= */

  window.ToonVerseAI = Object.freeze({
    name: APP.name,
    version: APP.version,

    showToast,

    scrollToTop() {
      window.scrollTo({
        top: 0,
        behavior: prefersReducedMotion()
          ? "auto"
          : "smooth",
      });
    },

    scrollToBottom() {
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: prefersReducedMotion()
          ? "auto"
          : "smooth",
      });
    },
  });
})();
