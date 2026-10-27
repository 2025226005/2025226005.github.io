(() => {
  const peopleLink = document.querySelector('.site-nav > a[href="people.html"]');
  if (peopleLink) {
    const dropdown = document.createElement("div");
    dropdown.className = "nav-dropdown";
    peopleLink.replaceWith(dropdown);
    peopleLink.classList.add("nav-parent");
    dropdown.append(peopleLink);

    const submenu = document.createElement("div");
    submenu.className = "nav-dropdown-menu";
    submenu.setAttribute("aria-label", "People pages");
    submenu.innerHTML = `
      <a href="people.html">CURRENT</a>
      <a href="people_undergraduate.html">UNDERGRADUATE RESEARCHERS</a>
      <a href="people_alumni.html">ALUMNI</a>
    `;
    dropdown.append(submenu);
  }

  const nav = document.querySelector(".site-nav");
  const toggle = document.querySelector(".nav-toggle");
  if (nav && toggle) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    nav.addEventListener("click", event => {
      if (event.target.closest("a")) {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  const page = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".site-nav a").forEach(link => {
    const linkPage = link.getAttribute("href").split("?")[0];
    if (linkPage === page) link.setAttribute("aria-current", "page");
  });
  if (page.startsWith("people")) {
    document.querySelector('.nav-parent[href="people.html"]')?.setAttribute("aria-current", "page");
  }

  const yearTabs = document.querySelector("[data-year-tabs]");
  if (yearTabs) {
    const panels = [...document.querySelectorAll("[data-year-panel]")];
    const validYears = panels.map(panel => panel.dataset.yearPanel);
    const queryYear = new URLSearchParams(location.search).get("year");

    const showYear = year => {
      const selectedYear = validYears.includes(String(year)) ? String(year) : validYears[0];
      panels.forEach(panel => { panel.hidden = panel.dataset.yearPanel !== selectedYear; });
      yearTabs.querySelectorAll("button[data-year]").forEach(button => {
        const active = button.dataset.year === selectedYear;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", String(active));
        button.tabIndex = active ? 0 : -1;
      });
      const url = new URL(location.href);
      url.searchParams.set("year", selectedYear);
      history.replaceState(null, "", url);
    };

    yearTabs.addEventListener("click", event => {
      const button = event.target.closest("button[data-year]");
      if (button) showYear(button.dataset.year);
    });
    yearTabs.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      const buttons = [...yearTabs.querySelectorAll("button[data-year]")];
      const current = buttons.indexOf(document.activeElement);
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const next = buttons[(current + direction + buttons.length) % buttons.length];
      event.preventDefault();
      next.focus();
      showYear(next.dataset.year);
    });
    showYear(queryYear || validYears[0]);
  }

  const hero = document.querySelector(".hero");
  const lens = document.querySelector(".hero-lens");
  const grid = document.querySelector(".hero-grid");
  const ring = document.querySelector(".hero-ring");
  if (hero && lens && grid && ring && matchMedia("(pointer: fine)").matches) {
    hero.addEventListener("pointermove", event => {
      const box = hero.getBoundingClientRect();
      const x = event.clientX - box.left;
      const y = event.clientY - box.top;
      lens.style.clipPath = `circle(90px at ${x}px ${y}px)`;
      grid.style.clipPath = `circle(90px at ${x}px ${y}px)`;
      grid.style.opacity = "1";
      ring.style.transform = `translate(${x}px, ${y}px)`;
      ring.style.opacity = "1";
    });
    hero.addEventListener("pointerleave", () => {
      lens.style.clipPath = "circle(0 at -100px -100px)";
      grid.style.opacity = "0";
      ring.style.opacity = "0";
    });
  }
})();
