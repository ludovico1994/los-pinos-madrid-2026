const AUTH = {
  username: "PINOS_MADRID_2026",
  password: "2026PINOS!"
};

const HOTEL_ADDRESS = "Calle Minas 12, 28004 Madrid";
const DB_FILE = "DATABASE/madrid_database_definitivo_unico.json";
const VOTE_API = "/api/votes";
const CATEGORY_ORDER = ["pranzo", "visite_culturali", "aperitivi", "cena", "post_cena_discoteca", "discoteca_dopo_cena"];
const INFO_FIELDS = [
  { key: "description", label: "description" },
  { key: "dress_code", label: "dress code" },
  { key: "driving_minutes", label: "driving minutes" },
  { key: "full_address", label: "full address" },
  { key: "practical_notes", label: "Practical notes" },
  { key: "recommended_days", label: "recommended_days" },
  { key: "recommended_for_groups", label: "recommended_for_groups" },
  { key: "reservation_needed", label: "reservation_needed" },
  { key: "subcategory", label: "subcategory" },
  { key: "tags", label: "tags" }
];

const loginView = document.getElementById("loginView");
const appView = document.getElementById("appView");
const loginBtn = document.getElementById("loginBtn");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginError = document.getElementById("loginError");

const dbStatus = document.getElementById("dbStatus");
const catalogTabs = document.getElementById("catalogTabs");
const catalogGrid = document.getElementById("catalogGrid");

let dbRows = [];
let selectedCatalogCategory = "all";
let voteState = { counts: {}, selectedEntries: {} };
let voteSyncTimer = null;
let remoteVoteMode = false;

function authHeaders() {
  const token = btoa(`${AUTH.username}:${AUTH.password}`);
  return { Authorization: `Basic ${token}` };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setDbStatus(message) {
  if (dbStatus) {
    dbStatus.textContent = message;
  }
}

function categoryLabel(category) {
  const labels = {
    pranzo: "PRANZO",
    visite_culturali: "VISITE CULTURALI",
    aperitivi: "APERITIVO",
    cena: "CENA",
    discoteca_dopo_cena: "DISCO E DOPO CENA",
    post_cena_discoteca: "DISCO E DOPO CENA"
  };
  return labels[category] || category;
}

function mapsPlaceLink(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address || "Madrid")}`;
}

function mapsRouteLink(address) {
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(HOTEL_ADDRESS)}&destination=${encodeURIComponent(
    address || "Madrid"
  )}&travelmode=walking`;
}

function getClientId() {
  const key = "voteClientId";
  let id = localStorage.getItem(key);
  if (id) {
    return id;
  }

  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    id = crypto.randomUUID();
  } else {
    id = `client-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
  localStorage.setItem(key, id);
  return id;
}

function getLocalVoteState() {
  let legacyCounts = {};
  try {
    legacyCounts = JSON.parse(localStorage.getItem("catalogVotes") || "{}");
  } catch (error) {
    legacyCounts = {};
  }

  try {
    const state = JSON.parse(localStorage.getItem("catalogVoteState") || "null");
    if (state && typeof state === "object") {
      return { counts: state.counts || {}, selectedEntries: state.selectedEntries || {} };
    }
  } catch (error) {
    // ignore and fallback
  }

  return { counts: legacyCounts, selectedEntries: {} };
}

function setLocalVoteState(state) {
  localStorage.setItem("catalogVoteState", JSON.stringify(state));
  localStorage.setItem("catalogVotes", JSON.stringify(state.counts || {}));
}

async function fetchRemoteVoteState() {
  const voterId = encodeURIComponent(getClientId());
  const response = await fetch(`${VOTE_API}?voter_id=${voterId}`, {
    method: "GET",
    cache: "no-store",
    headers: authHeaders()
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  return { counts: data.counts || {}, selectedEntries: data.selectedEntries || {} };
}

async function loadVoteState() {
  try {
    voteState = await fetchRemoteVoteState();
    remoteVoteMode = true;
    return;
  } catch (error) {
    voteState = getLocalVoteState();
    remoteVoteMode = false;
  }
}

async function toggleVote(entryKey) {
  const selected = Boolean(voteState.selectedEntries[entryKey]);

  try {
    const response = await fetch(VOTE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        action: selected ? "remove" : "add",
        voter_id: getClientId(),
        entry_key: entryKey
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    voteState = { counts: data.counts || {}, selectedEntries: data.selectedEntries || {} };
    remoteVoteMode = true;
    return;
  } catch (error) {
    const local = getLocalVoteState();
    local.counts = local.counts || {};
    local.selectedEntries = local.selectedEntries || {};

    if (local.selectedEntries[entryKey]) {
      local.counts[entryKey] = Math.max(0, Number(local.counts[entryKey] || 0) - 1);
      delete local.selectedEntries[entryKey];
    } else {
      local.counts[entryKey] = Number(local.counts[entryKey] || 0) + 1;
      local.selectedEntries[entryKey] = true;
    }

    setLocalVoteState(local);
    voteState = local;
    remoteVoteMode = false;
  }
}

async function refreshVotesFromRemote() {
  if (!remoteVoteMode) {
    return;
  }
  try {
    const latest = await fetchRemoteVoteState();
    const changed = JSON.stringify(latest.counts || {}) !== JSON.stringify(voteState.counts || {});
    voteState = latest;
    if (changed) {
      renderCatalog();
    }
  } catch (error) {
    // keep current state without interrupting UI
  }
}

function entryKey(category, name) {
  return `${String(category || "").toLowerCase()}|${String(name || "").toLowerCase()}`;
}

function valueAsText(value) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "si" : "no";
  }
  return String(value);
}

function collectFieldMap(records) {
  const fieldMap = {};
  records.forEach((record) => {
    Object.entries(record).forEach(([key, value]) => {
      fieldMap[key] = fieldMap[key] || new Set();
      fieldMap[key].add(valueAsText(value));
    });
  });
  return fieldMap;
}

function spendRangeFromRecords(records) {
  const spends = records
    .map((r) => Number(r.average_spend_per_person))
    .filter((v) => Number.isFinite(v) && v > 0);

  if (!spends.length) {
    return "-";
  }

  const min = Math.floor(Math.min(...spends));
  const max = Math.ceil(Math.max(...spends));
  if (min === max) {
    return `${Math.max(0, min - 5)}€-${max + 5}€`;
  }
  return `${min}€-${max}€`;
}

function catalogEntries(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    if (!row || !row.category || !row.name) {
      return;
    }
    const key = entryKey(row.category, row.name);
    if (!groups.has(key)) {
      groups.set(key, { category: row.category, name: row.name, records: [] });
    }
    groups.get(key).records.push(row);
  });

  return [...groups.values()].map((group) => {
    const first = group.records[0];
    const budgets = [...new Set(group.records.map((r) => r.budget).filter(Boolean))];
    const websites = [
      ...new Set(group.records.map((r) => r.official_website || r.source_url || (r.source && r.source.base_url)).filter(Boolean))
    ];
    const neighborhoods = [...new Set(group.records.map((r) => r.neighborhood).filter(Boolean))];
    const k = entryKey(group.category, group.name);

    return {
      key: k,
      category: group.category,
      name: group.name,
      address: first.full_address || "Madrid",
      distanceKm: first.distance_km,
      walkingMinutes: first.walking_minutes,
      budgets,
      websites,
      neighborhoods,
      fieldMap: collectFieldMap(group.records),
      spendRange: spendRangeFromRecords(group.records),
      votes: Number((voteState.counts || {})[k] || 0),
      userVoted: Boolean((voteState.selectedEntries || {})[k])
    };
  });
}

function orderedCategories(entries) {
  const found = [...new Set(entries.map((e) => e.category))];
  return [...CATEGORY_ORDER.filter((c) => found.includes(c)), ...found.filter((c) => !CATEGORY_ORDER.includes(c))];
}

function renderCatalog() {
  const entries = catalogEntries(dbRows);
  const categories = orderedCategories(entries);

  if (!categories.length) {
    catalogTabs.innerHTML = "";
    catalogGrid.innerHTML = "<article class='card'><p>Nessuna opzione disponibile nel database.</p></article>";
    return;
  }

  const tabs = ["all", ...categories];
  if (!tabs.includes(selectedCatalogCategory)) {
    selectedCatalogCategory = "all";
  }

  catalogTabs.innerHTML = tabs
    .map((category) => {
      const label = category === "all" ? "Tutte" : categoryLabel(category);
      return `<button type=\"button\" class=\"chapter-tab ${selectedCatalogCategory === category ? "active" : ""}\" data-catalog-category=\"${escapeHtml(
        category
      )}\">${escapeHtml(label)}</button>`;
    })
    .join("");

  const filtered =
    selectedCatalogCategory === "all" ? entries : entries.filter((e) => e.category === selectedCatalogCategory);

  filtered.sort((a, b) => {
    if (b.votes !== a.votes) {
      return b.votes - a.votes;
    }
    return a.name.localeCompare(b.name);
  });

  catalogGrid.innerHTML = filtered
    .map((item) => {
      const websites = item.websites
        .map((url) => `<a href=\"${escapeHtml(url)}\" target=\"_blank\" rel=\"noopener noreferrer\">Sito</a>`)
        .join(" | ");
      const fieldRows = INFO_FIELDS.map((field) => {
        const values = item.fieldMap[field.key] ? [...item.fieldMap[field.key]] : [];
        if (!values.length) {
          return `<li><strong>${escapeHtml(field.label)}:</strong> -</li>`;
        }
        return `<li><strong>${escapeHtml(field.label)}:</strong> ${escapeHtml(values.join(" | "))}</li>`;
      }).join("");

      return `
        <article class=\"card db-card ${item.votes > 0 ? "option-winner" : ""}\">
          <span class=\"tag\">${escapeHtml(categoryLabel(item.category))}</span>
          <h5>${escapeHtml(item.name)}</h5>
          <p class=\"db-meta\"><strong>Voti:</strong> ${item.votes}</p>
          <p class=\"db-meta\"><strong>Distanza:</strong> ${escapeHtml(item.distanceKm)} km | <strong>A piedi:</strong> ${escapeHtml(
        item.walkingMinutes
      )} min</p>
          <p class=\"db-meta\"><strong>Range € persona:</strong> ${escapeHtml(item.spendRange)}</p>
          <p class=\"db-meta\"><strong>Budget:</strong> ${escapeHtml(item.budgets.join(", ") || "-")}</p>
          <p class=\"db-meta\"><strong>Quartiere:</strong> ${escapeHtml(item.neighborhoods.join(", ") || "-")}</p>
          <div class=\"vote-row\">
            <button type=\"button\" class=\"vote-btn ${item.userVoted ? "active" : ""}\" data-vote-entry=\"${escapeHtml(
        item.key
      )}\">${item.userVoted ? "Voto inserito (clicca per togliere)" : "Vota opzione"}</button>
            <span class=\"vote-count\">${item.votes} voto${item.votes === 1 ? "" : "i"}</span>
          </div>
          <div class=\"option-links\">
            ${websites || ""}
            <a href=\"${escapeHtml(mapsPlaceLink(item.address))}\" target=\"_blank\" rel=\"noopener noreferrer\">Apri su Maps</a>
            <a href=\"${escapeHtml(mapsRouteLink(item.address))}\" target=\"_blank\" rel=\"noopener noreferrer\">Itinerario da hotel</a>
          </div>
          <details class=\"db-details\">
            <summary>INFOS</summary>
            <ul class=\"db-list\">${fieldRows}</ul>
          </details>
        </article>
      `;
    })
    .join("");
}

catalogTabs.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const category = target.dataset.catalogCategory;
  if (!category) {
    return;
  }
  selectedCatalogCategory = category;
  renderCatalog();
});

catalogGrid.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const key = target.dataset.voteEntry;
  if (!key) {
    return;
  }

  toggleVote(key).then(() => renderCatalog());
});

async function loadDatabase() {
  if (Array.isArray(window.MADRID_DB) && window.MADRID_DB.length) {
    dbRows = window.MADRID_DB;
    setDbStatus("");
    return true;
  }

  try {
    const response = await fetch(DB_FILE, { cache: "no-store" });
    if (!response.ok) {
      setDbStatus("");
      return false;
    }
    const text = await response.text();
    const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    dbRows = JSON.parse(clean);
    setDbStatus("");
    return true;
  } catch (error) {
    setDbStatus("");
    return false;
  }
}

async function initializeApp() {
  await loadDatabase();
  await loadVoteState();
  renderCatalog();

  if (voteSyncTimer) {
    clearInterval(voteSyncTimer);
    voteSyncTimer = null;
  }

  if (remoteVoteMode) {
    voteSyncTimer = setInterval(refreshVotesFromRemote, 5000);
  }
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshVotesFromRemote();
  }
});

function login() {
  const u = usernameInput.value.trim();
  const p = passwordInput.value;

  if (u === AUTH.username && p === AUTH.password) {
    sessionStorage.setItem("madridTripAuth", "ok");
    loginView.classList.add("hidden");
    appView.classList.remove("hidden");
    loginError.textContent = "";
    initializeApp();
    return;
  }

  loginError.textContent = "Credenziali non corrette. Riprova.";
}

loginBtn.addEventListener("click", login);
passwordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    login();
  }
});

if (sessionStorage.getItem("madridTripAuth") === "ok") {
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
  initializeApp();
}
