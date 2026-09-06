"use strict";

/* =========================================================
   ToonVerse AI
   Main JavaScript — V1 Foundation
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  initSmoothNavigation();
  initScrollButtons();
  initActiveNavigation();
  initYear();
  initSafeButtons();
});

/* ---------- Smooth Navigation ---------- */

function initSmoothNavigation() {
  const links = document.querySelectorAll('a[href^="#"]');

  links.forEach((link) => {
    link.addEventListener("click", (event) => {
      const targetId = link.getAttribute("href");

      if (!targetId || targetId === "#") return;

      const target = document.querySelector(targetId);

      if (!target) return;

      event.preventDefault();

      target.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  });
}

/* ---------- Top / Bottom Scroll Buttons ---------- */

function initScrollButtons() {
  const topButton = document.querySelector("[data-scroll-top]");
  const bottomButton = document.querySelector("[data-scroll-bottom]");

  if (topButton) {
    topButton.addEventListener("click", () => {
      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    });
  }

  if (bottomButton) {
    bottomButton.addEventListener("click", () => {
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: "smooth",
      });
    });
  }
}

/* ---------- Active Navigation ---------- */

function initActiveNavigation() {
  const sections = document.querySelectorAll("section[id]");
  const navLinks = document.querySelectorAll('.nav-links a[href^="#"]');

  if (!sections.length || !navLinks.length) return;

  const updateActiveLink = () => {
    let currentSection = "";

    sections.forEach((section) => {
      const sectionTop = section.offsetTop - 140;

      if (window.scrollY >= sectionTop) {
        currentSection = section.getAttribute("id");
      }
    });

    navLinks.forEach((link) => {
      link.classList.remove("active");

      if (link.getAttribute("href") === `#${currentSection}`) {
        link.classList.add("active");
      }
    });
  };

  updateActiveLink();

  window.addEventListener("scroll", updateActiveLink, {
    passive: true,
  });
}

/* ---------- Dynamic Footer Year ---------- */

function initYear() {
  const yearElement = document.querySelector("[data-current-year]");

  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }
}

/* ---------- Safe Placeholder Buttons ---------- */

function initSafeButtons() {
  const buttons = document.querySelectorAll("[data-action]");

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;

      switch (action) {
        case "create":
          announce("Create Studio is being prepared.");
