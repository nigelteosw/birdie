(function () {
  "use strict";

  var root = document.documentElement;
  var THEME_KEY = "birdie-theme";

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {}
  }

  var themeToggle = document.querySelector("[data-theme-toggle]");
  if (themeToggle) {
    themeToggle.addEventListener("click", function () {
      var current = root.getAttribute("data-theme") === "light" ? "light" : "dark";
      applyTheme(current === "light" ? "dark" : "light");
    });
  }

  var sidenav = document.getElementById("sidenav");
  var navToggle = document.querySelector("[data-nav-toggle]");
  var navScrim = document.querySelector("[data-nav-scrim]");
  var navFilter = document.querySelector("[data-nav-filter]");
  var filterTrigger = document.querySelector("[data-filter-trigger]");
  var MOBILE_QUERY = window.matchMedia("(max-width: 860px)");

  function openDrawer() {
    if (!sidenav || !navToggle || !navScrim) return;
    sidenav.classList.add("is-open");
    navToggle.setAttribute("aria-expanded", "true");
    navScrim.hidden = false;
  }

  function closeDrawer() {
    if (!sidenav || !navToggle || !navScrim) return;
    sidenav.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
    navScrim.hidden = true;
  }

  if (navToggle) {
    navToggle.addEventListener("click", function () {
      if (sidenav.classList.contains("is-open")) {
        closeDrawer();
      } else {
        openDrawer();
      }
    });
  }

  if (navScrim) {
    navScrim.addEventListener("click", closeDrawer);
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && sidenav && sidenav.classList.contains("is-open")) {
      closeDrawer();
      navToggle.focus();
    }
  });

  document.querySelectorAll("[data-nav-link]").forEach(function (link) {
    link.addEventListener("click", function () {
      if (MOBILE_QUERY.matches) closeDrawer();
    });
  });

  if (filterTrigger && navFilter) {
    filterTrigger.addEventListener("click", function () {
      if (MOBILE_QUERY.matches) {
        openDrawer();
      }
      navFilter.focus();
    });
  }

  if (navFilter) {
    navFilter.addEventListener("input", function () {
      var query = navFilter.value.trim().toLowerCase();
      document.querySelectorAll(".nav-group").forEach(function (group) {
        var anyVisible = false;
        group.querySelectorAll("li").forEach(function (item) {
          var text = item.textContent.trim().toLowerCase();
          var match = query === "" || text.indexOf(query) !== -1;
          item.hidden = !match;
          if (match) anyVisible = true;
        });
        group.hidden = !anyVisible;
      });
    });
  }

  var copyButton = document.querySelector("[data-copy-page]");
  if (copyButton) {
    copyButton.addEventListener("click", function () {
      var content = document.getElementById("content");
      var text = content ? content.innerText : document.title;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          var original = copyButton.textContent;
          copyButton.textContent = "Copied";
          setTimeout(function () {
            copyButton.textContent = original;
          }, 1500);
        });
      }
    });
  }

  var sections = Array.prototype.slice.call(document.querySelectorAll("#top, article > section[id]"));
  var navLinks = document.querySelectorAll("[data-nav-link]");
  var outlineLinks = document.querySelectorAll("[data-outline-link]");

  function setActive(links, href) {
    links.forEach(function (link) {
      link.classList.toggle("is-active", link.getAttribute("href") === "#" + href);
    });
  }

  if ("IntersectionObserver" in window && sections.length) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var section = entry.target;
          setActive(navLinks, section.id);
          var heading = section.querySelector("h2[id]");
          if (heading) {
            setActive(outlineLinks, heading.id);
          } else {
            outlineLinks.forEach(function (link) {
              link.classList.remove("is-active");
            });
          }
        });
      },
      { rootMargin: "-64px 0px -70% 0px", threshold: 0 }
    );
    sections.forEach(function (section) {
      observer.observe(section);
    });
  }
})();
