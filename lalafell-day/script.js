const header = document.querySelector("#siteHeader");
const menuButton = document.querySelector("#menuButton");
const siteNav = document.querySelector("#siteNav");
const toast = document.querySelector("#toast");

const eventStart = new Date("2026-08-30T20:30:00+09:00");
const eventEnd = new Date("2026-08-30T21:35:00+09:00");

function setMenu(open) {
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
  siteNav.classList.toggle("open", open);
  document.body.classList.toggle("menu-open", open);
}

menuButton.addEventListener("click", () => {
  setMenu(menuButton.getAttribute("aria-expanded") !== "true");
});

siteNav.addEventListener("click", (event) => {
  if (event.target.closest("a, button")) setMenu(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && siteNav.classList.contains("open")) setMenu(false);
});

function updateHeader() {
  header.classList.toggle("scrolled", window.scrollY > 24);
}

updateHeader();
window.addEventListener("scroll", updateHeader, { passive: true });

const revealObserver = new IntersectionObserver(
  (entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("revealed");
      observer.unobserve(entry.target);
    });
  },
  { threshold: 0.12 },
);

document.querySelectorAll("[data-reveal]").forEach((element) => revealObserver.observe(element));

const sectionLinks = [...document.querySelectorAll('.site-nav a[href^="#"]')];
const sections = sectionLinks
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);

const sectionObserver = new IntersectionObserver(
  (entries) => {
    const current = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

    if (!current) return;
    sectionLinks.forEach((link) => {
      const selected = link.getAttribute("href") === `#${current.target.id}`;
      link.classList.toggle("active", selected);
      if (selected) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
  },
  { rootMargin: "-25% 0px -60%", threshold: [0, 0.25, 0.6] },
);

sections.forEach((section) => sectionObserver.observe(section));

function pad(value) {
  return String(value).padStart(2, "0");
}

function updateCountdown() {
  const now = new Date();
  const difference = Math.max(0, eventStart.getTime() - now.getTime());
  const totalSeconds = Math.floor(difference / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  document.querySelector("[data-days]").textContent = pad(days);
  document.querySelector("[data-hours]").textContent = pad(hours);
  document.querySelector("[data-minutes]").textContent = pad(minutes);
  document.querySelector("[data-seconds]").textContent = pad(seconds);

  const countdownLabel = document.querySelector("#countdownLabel");
  if (now >= eventStart && now <= eventEnd) {
    countdownLabel.textContent = "지금, 감자데이가 진행 중이에요!";
  } else if (now > eventEnd) {
    countdownLabel.textContent = "함께해 주셔서 고마워요!";
  }
}

updateCountdown();
setInterval(updateCountdown, 1000);

function formatIcsDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function downloadCalendar() {
  const arrivalTime = new Date("2026-08-30T20:20:00+09:00");
  const now = new Date();
  const uid = `lalafell-day-20260830@huis-snow.github.io`;
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lalafell Day//Parade Event//KO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${formatIcsDate(now)}`,
    `DTSTART:${formatIcsDate(arrivalTime)}`,
    `DTEND:${formatIcsDate(eventEnd)}`,
    "SUMMARY:감자데이 대행진 이벤트",
    "LOCATION:초코보 서버\\, 중부 라노시아 (림사 로민사 하층갑판 입구)",
    "DESCRIPTION:라라펠 유저 대행진 이벤트입니다. 20:30 시작이며 원활한 진행을 위해 10분 전까지 도착해 주세요.",
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    "DESCRIPTION:감자데이 집합 30분 전입니다.",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "감자데이-대행진-이벤트.ics";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("캘린더 파일을 저장했어요.");
}

document.querySelectorAll("[data-calendar]").forEach((button) => {
  button.addEventListener("click", downloadCalendar);
});

let toastTimer;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      showToast("집합 장소를 복사했어요.");
    } catch {
      showToast("복사하지 못했어요. 장소를 직접 선택해 주세요.");
    }
  });
});

function setupImageDialog(dialogSelector, openSelector, closeSelector) {
  const dialog = document.querySelector(dialogSelector);
  if (!dialog) return;

  document.querySelectorAll(openSelector).forEach((button) => {
    button.addEventListener("click", () => dialog.showModal());
  });

  dialog.querySelector(closeSelector).addEventListener("click", () => dialog.close());

  dialog.addEventListener("click", (event) => {
    const bounds = dialog.getBoundingClientRect();
    const outside =
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom;
    if (outside) dialog.close();
  });
}

setupImageDialog("#posterDialog", "[data-poster-open]", "[data-poster-close]");
setupImageDialog("#invitationDialog", "[data-invitation-open]", "[data-invitation-close]");
