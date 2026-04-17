(function () {
  const STORAGE_KEY = "dls-tournament-v1";
  const META_KEY = "dls-local-save-ts";
  const SYNC_FLAG = "dls-supabase-sync-v1";

  const defaultState = () => ({
    tournamentName: "",
    tomorrow: "",
    upcoming: [],
    results: [],
  });

  function normalizeState(data) {
    if (!data || typeof data !== "object") return defaultState();
    return {
      ...defaultState(),
      ...data,
      upcoming: Array.isArray(data.upcoming) ? data.upcoming : [],
      results: Array.isArray(data.results) ? data.results : [],
    };
  }

  function meaningfulState(s) {
    return (
      !!(s.tournamentName && String(s.tournamentName).trim()) ||
      (Array.isArray(s.results) && s.results.length > 0) ||
      (Array.isArray(s.upcoming) && s.upcoming.length > 0)
    );
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return normalizeState(JSON.parse(raw));
    } catch {
      return defaultState();
    }
  }

  let _supabaseClient = null;
  let _cloudTimer = null;

  function getSupabase() {
    if (_supabaseClient) return _supabaseClient;
    const cfg = window.DLS_CONFIG;
    const apiKey = cfg?.supabasePublishableKey || cfg?.supabaseAnonKey;
    if (!cfg?.supabaseUrl || !apiKey) return null;
    if (/PEGA_AQUI|REEMPLAZ|TU_ANON|PLACEHOLDER/i.test(String(apiKey))) return null;
    const lib = globalThis.supabase;
    if (!lib || typeof lib.createClient !== "function") return null;
    try {
      _supabaseClient = lib.createClient(cfg.supabaseUrl, apiKey);
      return _supabaseClient;
    } catch {
      return null;
    }
  }

  function getLocalSaveTs() {
    return localStorage.getItem(META_KEY) || "1970-01-01T00:00:00.000Z";
  }

  function save(next) {
    if (next !== undefined) {
      state = normalizeState(next);
    }
    const ts = new Date().toISOString();
    localStorage.setItem(META_KEY, ts);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    scheduleCloudSync();
  }

  async function pushStateRaw() {
    const sb = getSupabase();
    if (!sb) return;
    const ts = new Date().toISOString();
    const { error } = await sb.from("dls_state").upsert(
      { id: "main", data: state, updated_at: ts },
      { onConflict: "id" }
    );
    if (!error) {
      localStorage.setItem(META_KEY, ts);
    } else {
      console.warn("[DLS] Supabase sync:", error.message);
    }
  }

  function scheduleCloudSync() {
    const sb = getSupabase();
    if (!sb) return;
    clearTimeout(_cloudTimer);
    _cloudTimer = setTimeout(() => {
      pushStateRaw().catch(() => {});
    }, 450);
  }

  async function pullMerge() {
    state = load();
    const sb = getSupabase();
    if (!sb) return;

    const { data: row, error } = await sb
      .from("dls_state")
      .select("data, updated_at")
      .eq("id", "main")
      .maybeSingle();

    if (error) {
      console.warn("[DLS]", error.message);
      return;
    }

    if (!localStorage.getItem(SYNC_FLAG)) {
      const remoteData = row?.data;
      const hasRemote =
        remoteData &&
        typeof remoteData === "object" &&
        meaningfulState(normalizeState(remoteData));
      if (hasRemote) {
        state = normalizeState(remoteData);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        localStorage.setItem(META_KEY, row.updated_at);
      } else if (meaningfulState(state)) {
        await pushStateRaw();
      } else {
        localStorage.setItem(META_KEY, new Date().toISOString());
      }
      localStorage.setItem(SYNC_FLAG, "1");
      return;
    }

    if (!row || row.data == null) {
      if (meaningfulState(state)) await pushStateRaw();
      return;
    }

    const remoteTs = row.updated_at;
    const localTs = getLocalSaveTs();
    const remoteState = normalizeState(row.data);

    if (new Date(remoteTs) > new Date(localTs)) {
      state = remoteState;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      localStorage.setItem(META_KEY, remoteTs);
    } else if (new Date(localTs) > new Date(remoteTs)) {
      await pushStateRaw();
    }
  }

  function updateSyncStatusUI() {
    const node = document.getElementById("syncStatus");
    if (!node) return;
    const sb = getSupabase();
    if (!sb) {
      node.textContent =
        "Estado: sin conexión. Revisá config.js (URL + supabasePublishableKey) y recargá la página.";
      node.classList.remove("syncStatus--ok");
      return;
    }
    node.textContent =
      "Estado: conectado a Supabase. Al guardar se sube la nube; al abrir la página se bajan los datos.";
    node.classList.add("syncStatus--ok");
  }

  let state = load();

  const el = {
    appTournamentTitle: document.getElementById("appTournamentTitle"),
    dashLead: document.getElementById("dashLead"),
    inputTournamentName: document.getElementById("inputTournamentName"),
    inputTomorrow: document.getElementById("inputTomorrow"),
    listUpcoming: document.getElementById("listUpcoming"),
    listResults: document.getElementById("listResults"),
    formUpcoming: document.getElementById("formUpcoming"),
    formResult: document.getElementById("formResult"),
    btnAddUpcoming: document.getElementById("btnAddUpcoming"),
    btnAddResult: document.getElementById("btnAddResult"),
    cancelUpcoming: document.getElementById("cancelUpcoming"),
    cancelResult: document.getElementById("cancelResult"),
    btnExport: document.getElementById("btnExport"),
    importFile: document.getElementById("importFile"),
    screenApp: document.getElementById("screen-app"),
  };

  const CODEGEN_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

  function generateRandomCode(len) {
    let s = "";
    for (let i = 0; i < len; i++) {
      s += CODEGEN_CHARS[Math.floor(Math.random() * CODEGEN_CHARS.length)];
    }
    return s;
  }

  function runCodegen() {
    const code = generateRandomCode(6);
    const out = document.getElementById("generatedCode");
    if (out) out.textContent = code;
  }

  async function copyCodegenToClipboard() {
    const out = document.getElementById("generatedCode");
    const text = out ? String(out.textContent || "").trim() : "";
    if (!text || text === "—") return;
    const msg = document.getElementById("codegenCopyMsg");
    try {
      await navigator.clipboard.writeText(text);
      if (msg) {
        msg.classList.remove("hidden");
        setTimeout(() => msg.classList.add("hidden"), 2200);
      }
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        if (msg) {
          msg.classList.remove("hidden");
          setTimeout(() => msg.classList.add("hidden"), 2200);
        }
      } catch {
        alert(text);
      }
    }
  }

  const btnGenCode = document.getElementById("btnGenCode");
  const btnCopyCode = document.getElementById("btnCopyCode");
  if (btnGenCode) btnGenCode.addEventListener("click", runCodegen);
  if (btnCopyCode) btnCopyCode.addEventListener("click", copyCodegenToClipboard);

  function showPanel(name) {
    ["resumen", "torneo", "ajustes"].forEach((id) => {
      const p = document.getElementById(`panel-${id}`);
      if (!p) return;
      const on = id === name;
      p.classList.toggle("hidden", !on);
      p.classList.toggle("is-visible", on);
    });
    document.querySelectorAll(".app-nav-btn[data-panel]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-panel") === name);
    });
  }

  function showAppShell() {
    if (el.screenApp) el.screenApp.classList.remove("hidden");
    showPanel("resumen");
    render();
  }

  function goToResumenIfApp() {
    showPanel("resumen");
  }

  function uid() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso + "T12:00:00");
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("es", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }

  function formatDateLong(iso) {
    if (!iso) return "";
    const d = new Date(iso + "T12:00:00");
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("es", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function teamInitials(name) {
    const s = String(name || "").trim();
    if (!s) return "?";
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return s.slice(0, 2).toUpperCase();
  }

  function teamHue(name) {
    let h = 2166136261;
    const s = String(name || "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h) % 360;
  }

  function elCrest(name) {
    const d = document.createElement("div");
    d.className = "sb-crest";
    d.textContent = teamInitials(name);
    d.style.setProperty("--team-h", String(teamHue(name)));
    d.title = name;
    return d;
  }

  function parseAgg(fd) {
    const ah = String(fd.get("aggHome") ?? "").trim();
    const aa = String(fd.get("aggAway") ?? "").trim();
    if (ah === "" && aa === "") return { aggHome: undefined, aggAway: undefined };
    const x = parseInt(ah, 10);
    const y = parseInt(aa, 10);
    if (Number.isNaN(x) || Number.isNaN(y)) {
      return { aggHome: undefined, aggAway: undefined };
    }
    return { aggHome: x, aggAway: y };
  }

  function resultSubline(m) {
    const hasAgg =
      typeof m.aggHome === "number" &&
      !Number.isNaN(m.aggHome) &&
      typeof m.aggAway === "number" &&
      !Number.isNaN(m.aggAway);
    if (hasAgg) {
      return `Global ${m.aggHome} – ${m.aggAway}`;
    }
    if (m.date) return formatDateLong(m.date);
    return "";
  }

  function normalizeTeamKey(name) {
    return String(name || "").trim().toLowerCase();
  }

  function computeStandings(results) {
    const rows = new Map();

    function ensureRow(rawName) {
      const key = normalizeTeamKey(rawName);
      if (!key) return null;
      if (!rows.has(key)) {
        rows.set(key, {
          team: String(rawName).trim(),
          pj: 0,
          pg: 0,
          pe: 0,
          pp: 0,
          gf: 0,
          gc: 0,
          pts: 0,
        });
      }
      return rows.get(key);
    }

    for (const m of results) {
      const h = ensureRow(m.home);
      const a = ensureRow(m.away);
      if (!h || !a) continue;

      const sh = Number(m.scoreHome);
      const sa = Number(m.scoreAway);
      if (Number.isNaN(sh) || Number.isNaN(sa)) continue;

      h.pj++;
      a.pj++;
      h.gf += sh;
      h.gc += sa;
      a.gf += sa;
      a.gc += sh;

      if (sh > sa) {
        h.pg++;
        h.pts += 3;
        a.pp++;
      } else if (sh < sa) {
        a.pg++;
        a.pts += 3;
        h.pp++;
      } else {
        h.pe++;
        a.pe++;
        h.pts++;
        a.pts++;
      }
    }

    const list = Array.from(rows.values()).map((r) => ({
      ...r,
      dg: r.gf - r.gc,
    }));

    list.sort((a, b) => {
      if (b.pts !== a.pts) return b.pts - a.pts;
      if (b.dg !== a.dg) return b.dg - a.dg;
      if (b.gf !== a.gf) return b.gf - a.gf;
      return a.team.localeCompare(b.team, "es", { sensitivity: "base" });
    });

    return list;
  }

  function formatDg(n) {
    if (n > 0) return `+${n}`;
    return String(n);
  }

  function renderStandings() {
    const tbl = document.getElementById("standingsTable");
    const body = document.getElementById("standingsBody");
    const empty = document.getElementById("standingsEmpty");
    if (!tbl || !body || !empty) return;

    const list = computeStandings(state.results);
    body.innerHTML = "";

    if (list.length === 0) {
      tbl.classList.add("hidden");
      empty.classList.remove("hidden");
      return;
    }

    empty.classList.add("hidden");
    tbl.classList.remove("hidden");

    list.forEach((r, i) => {
      const tr = document.createElement("tr");
      if (i === 0) tr.classList.add("standings-row--lead");

      const tdRank = document.createElement("td");
      tdRank.className = "standings-rank";
      tdRank.textContent = String(i + 1);

      const tdTeam = document.createElement("td");
      tdTeam.className = "standings-team";
      const crest = elCrest(r.team);
      crest.classList.add("sb-crest--sm");
      const nm = document.createElement("span");
      nm.className = "standings-name";
      nm.textContent = r.team;
      tdTeam.appendChild(crest);
      tdTeam.appendChild(nm);

      function addNum(n, extra) {
        const td = document.createElement("td");
        td.className = "standings-num" + (extra ? ` ${extra}` : "");
        td.textContent = String(n);
        return td;
      }

      tr.appendChild(tdRank);
      tr.appendChild(tdTeam);
      tr.appendChild(addNum(r.pj));
      tr.appendChild(addNum(r.pg));
      tr.appendChild(addNum(r.pe));
      tr.appendChild(addNum(r.pp));
      tr.appendChild(addNum(r.gf));
      tr.appendChild(addNum(r.gc));

      const tdDg = document.createElement("td");
      tdDg.className = "standings-num";
      if (r.dg > 0) tdDg.classList.add("standings-num--pos");
      else if (r.dg < 0) tdDg.classList.add("standings-num--neg");
      tdDg.textContent = formatDg(r.dg);

      const tdPts = document.createElement("td");
      tdPts.className = "standings-num standings-pts";
      tdPts.textContent = String(r.pts);

      tr.appendChild(tdDg);
      tr.appendChild(tdPts);
      body.appendChild(tr);
    });
  }

  function renderDashboard() {
    const ds = document.getElementById("dashStandings");
    const du = document.getElementById("dashUpcoming");
    const dr = document.getElementById("dashResults");
    if (!ds || !du || !dr) return;

    const st = computeStandings(state.results);
    ds.innerHTML = "";
    if (st.length === 0) {
      const p = document.createElement("p");
      p.className = "dash-empty";
      p.textContent = "Sin datos todavía. Cargá resultados en Gestionar.";
      ds.appendChild(p);
    } else {
      const table = document.createElement("table");
      table.className = "dash-mini-table";
      const thead = document.createElement("thead");
      const hr = document.createElement("tr");
      ["#", "Equipo", "DG", "Pts"].forEach((lab) => {
        const th = document.createElement("th");
        th.textContent = lab;
        hr.appendChild(th);
      });
      thead.appendChild(hr);
      table.appendChild(thead);
      const tb = document.createElement("tbody");
      st.slice(0, 8).forEach((r, i) => {
        const tr = document.createElement("tr");
        if (i === 0) tr.classList.add("dash-lead-row");
        const tdN = document.createElement("td");
        tdN.textContent = String(i + 1);
        const tdT = document.createElement("td");
        tdT.className = "dash-td-team";
        tdT.textContent = r.team;
        const tdDg = document.createElement("td");
        tdDg.textContent = formatDg(r.dg);
        if (r.dg > 0) tdDg.classList.add("dash-num-pos");
        else if (r.dg < 0) tdDg.classList.add("dash-num-neg");
        const tdP = document.createElement("td");
        tdP.className = "dash-td-pts";
        tdP.textContent = String(r.pts);
        tr.appendChild(tdN);
        tr.appendChild(tdT);
        tr.appendChild(tdDg);
        tr.appendChild(tdP);
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      ds.appendChild(table);
    }

    const date = state.tomorrow;
    const filtered = date
      ? state.upcoming.filter((m) => m.date === date)
      : state.upcoming;
    du.innerHTML = "";
    if (filtered.length === 0) {
      const p = document.createElement("p");
      p.className = "dash-empty";
      p.textContent = date
        ? "Nada agendado para esa fecha. Cambiá la fecha en Ajustes o agregá partidos."
        : "No hay próximos cargados.";
      du.appendChild(p);
    } else {
      filtered.slice(0, 6).forEach((m) => {
        const row = document.createElement("div");
        row.className = "dash-mini-row";
        const teams = document.createElement("div");
        teams.className = "dash-mini-teams";
        teams.textContent = `${m.home}  vs  ${m.away}`;
        row.appendChild(teams);
        const meta = document.createElement("div");
        meta.className = "dash-mini-meta";
        const bits = [];
        if (m.time) bits.push(m.time);
        if (m.date) bits.push(formatDateLong(m.date));
        meta.textContent = bits.join(" · ");
        if (meta.textContent) row.appendChild(meta);
        du.appendChild(row);
      });
    }

    const sortedRes = [...state.results].sort((a, b) => {
      const da = a.date || "";
      const db = b.date || "";
      if (db !== da) return db.localeCompare(da);
      return String(b.id || "").localeCompare(String(a.id || ""));
    });
    dr.innerHTML = "";
    if (sortedRes.length === 0) {
      const p = document.createElement("p");
      p.className = "dash-empty";
      p.textContent = "Aún no hay marcadores.";
      dr.appendChild(p);
    } else {
      sortedRes.slice(0, 6).forEach((m) => {
        const wrap = document.createElement("div");
        wrap.className = "dash-mini-row dash-mini-row--result";
        const line = document.createElement("div");
        line.className = "dash-result-line";
        line.textContent = `${m.home}  ${m.scoreHome} – ${m.scoreAway}  ${m.away}`;
        wrap.appendChild(line);
        if (m.date) {
          const d = document.createElement("div");
          d.className = "dash-mini-meta";
          d.textContent = formatDateLong(m.date);
          wrap.appendChild(d);
        }
        dr.appendChild(wrap);
      });
    }
  }

  function syncHeader() {
    const name = state.tournamentName.trim();
    const title = name || "Mi torneo";
    if (el.appTournamentTitle) el.appTournamentTitle.textContent = title;
    if (el.dashLead) {
      el.dashLead.textContent = name
        ? `Resumen de ${name}.`
        : "Poné el nombre del torneo en Ajustes y cargá partidos abajo.";
    }
    if (el.inputTournamentName) el.inputTournamentName.value = state.tournamentName;
    if (el.inputTomorrow) el.inputTomorrow.value = state.tomorrow || "";
  }

  function renderUpcoming() {
    if (!el.listUpcoming) return;
    const date = state.tomorrow;
    const filtered = date
      ? state.upcoming.filter((m) => m.date === date)
      : state.upcoming;

    el.listUpcoming.innerHTML = "";
    if (filtered.length === 0) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = date
        ? "No hay partidos para esa fecha. Agregá partidos con la fecha o cambiá la fecha de “mañana”."
        : "Elegí una fecha arriba o agregá partidos (se muestran todos si no hay fecha).";
      el.listUpcoming.appendChild(p);
      return;
    }

    filtered.forEach((m) => {
      const li = document.createElement("li");
      li.className = "sb-item sb-item--fixture";

      const row = document.createElement("div");
      row.className = "sb-row";

      const homeSide = document.createElement("div");
      homeSide.className = "sb-side sb-side--home";
      const homeName = document.createElement("span");
      homeName.className = "sb-name";
      homeName.textContent = m.home;
      homeSide.appendChild(homeName);
      homeSide.appendChild(elCrest(m.home));

      const mid = document.createElement("div");
      mid.className = "sb-mid";
      const st = document.createElement("span");
      st.className = "sb-state";
      st.textContent = "Próximo";
      const timeEl = document.createElement("div");
      timeEl.className = "sb-goals sb-goals--time";
      if (m.time) {
        timeEl.textContent = m.time;
      } else {
        timeEl.classList.add("sb-goals--placeholder");
        timeEl.textContent = "— —";
      }
      const extra = document.createElement("span");
      extra.className = "sb-extra";
      const sub = [];
      if (m.date) sub.push(formatDateLong(m.date));
      extra.textContent = sub.join("");

      mid.appendChild(st);
      mid.appendChild(timeEl);
      if (extra.textContent) mid.appendChild(extra);

      const awaySide = document.createElement("div");
      awaySide.className = "sb-side sb-side--away";
      awaySide.appendChild(elCrest(m.away));
      const awayName = document.createElement("span");
      awayName.className = "sb-name";
      awayName.textContent = m.away;
      awaySide.appendChild(awayName);

      const flag = document.createElement("div");
      flag.className = "sb-events";
      flag.setAttribute("aria-hidden", "true");

      row.appendChild(homeSide);
      row.appendChild(mid);
      row.appendChild(awaySide);
      row.appendChild(flag);

      const admin = document.createElement("div");
      admin.className = "sb-admin";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "btn-icon";
      edit.textContent = "Editar";
      edit.addEventListener("click", () => editUpcoming(m.id));
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn-icon danger";
      del.textContent = "Borrar";
      del.addEventListener("click", () => {
        if (confirm("¿Borrar este partido?")) {
          state.upcoming = state.upcoming.filter((x) => x.id !== m.id);
          save(state);
          render();
        }
      });
      admin.appendChild(edit);
      admin.appendChild(del);

      li.appendChild(row);
      li.appendChild(admin);
      el.listUpcoming.appendChild(li);
    });
  }

  let editingUpcomingId = null;
  let editingResultId = null;

  function editUpcoming(id) {
    const m = state.upcoming.find((x) => x.id === id);
    if (!m) return;
    editingUpcomingId = id;
    el.formUpcoming.classList.remove("hidden");
    el.formUpcoming.home.value = m.home;
    el.formUpcoming.away.value = m.away;
    el.formUpcoming.time.value = m.time || "";
    const di = upcomingDateInput();
    if (di) di.value = m.date || state.tomorrow || "";
  }

  function renderResults() {
    if (!el.listResults) return;
    const sorted = [...state.results].sort((a, b) => {
      const da = a.date || "";
      const db = b.date || "";
      return db.localeCompare(da);
    });

    el.listResults.innerHTML = "";
    if (sorted.length === 0) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "Todavía no hay resultados.";
      el.listResults.appendChild(p);
      return;
    }

    sorted.forEach((m) => {
      const li = document.createElement("li");
      li.className = "sb-item sb-item--final";

      const row = document.createElement("div");
      row.className = "sb-row";

      const homeSide = document.createElement("div");
      homeSide.className = "sb-side sb-side--home";
      const homeName = document.createElement("span");
      homeName.className = "sb-name";
      homeName.textContent = m.home;
      const fav = document.createElement("span");
      fav.className = "sb-fav";
      fav.setAttribute("aria-hidden", "true");
      fav.textContent = "☆";
      homeSide.appendChild(homeName);
      homeSide.appendChild(fav);
      homeSide.appendChild(elCrest(m.home));

      const mid = document.createElement("div");
      mid.className = "sb-mid";
      const st = document.createElement("span");
      st.className = "sb-state";
      st.textContent = "Finalizado";
      const goals = document.createElement("div");
      goals.className = "sb-goals";
      const g1 = document.createElement("span");
      g1.textContent = String(m.scoreHome);
      const sep = document.createElement("span");
      sep.className = "sb-sep";
      sep.textContent = "-";
      const g2 = document.createElement("span");
      g2.textContent = String(m.scoreAway);
      goals.appendChild(g1);
      goals.appendChild(sep);
      goals.appendChild(g2);

      const sub = resultSubline(m);
      mid.appendChild(st);
      mid.appendChild(goals);
      if (sub) {
        const extra = document.createElement("span");
        extra.className = "sb-extra";
        extra.textContent = sub;
        mid.appendChild(extra);
      }

      const awaySide = document.createElement("div");
      awaySide.className = "sb-side sb-side--away";
      awaySide.appendChild(elCrest(m.away));
      const awayName = document.createElement("span");
      awayName.className = "sb-name";
      awayName.textContent = m.away;
      awaySide.appendChild(awayName);

      const flag = document.createElement("div");
      flag.className = "sb-events";
      flag.setAttribute("aria-hidden", "true");

      row.appendChild(homeSide);
      row.appendChild(mid);
      row.appendChild(awaySide);
      row.appendChild(flag);

      const admin = document.createElement("div");
      admin.className = "sb-admin";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "btn-icon";
      edit.textContent = "Editar";
      edit.addEventListener("click", () => editResult(m.id));
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn-icon danger";
      del.textContent = "Borrar";
      del.addEventListener("click", () => {
        if (confirm("¿Borrar este resultado?")) {
          state.results = state.results.filter((x) => x.id !== m.id);
          save(state);
          render();
        }
      });
      admin.appendChild(edit);
      admin.appendChild(del);

      li.appendChild(row);
      li.appendChild(admin);
      el.listResults.appendChild(li);
    });
  }

  function editResult(id) {
    const m = state.results.find((x) => x.id === id);
    if (!m) return;
    editingResultId = id;
    el.formResult.classList.remove("hidden");
    el.formResult.home.value = m.home;
    el.formResult.away.value = m.away;
    el.formResult.scoreHome.value = m.scoreHome;
    el.formResult.scoreAway.value = m.scoreAway;
    el.formResult.date.value = m.date || "";
    const aggH = el.formResult.querySelector('input[name="aggHome"]');
    const aggA = el.formResult.querySelector('input[name="aggAway"]');
    if (aggH) aggH.value = m.aggHome != null ? String(m.aggHome) : "";
    if (aggA) aggA.value = m.aggAway != null ? String(m.aggAway) : "";
  }

  function render() {
    syncHeader();
    renderUpcoming();
    renderResults();
    renderStandings();
    renderDashboard();
  }

  if (el.inputTournamentName) {
    el.inputTournamentName.addEventListener("input", () => {
      state.tournamentName = el.inputTournamentName.value;
      save(state);
      syncHeader();
    });
  }

  if (el.inputTomorrow) {
    el.inputTomorrow.addEventListener("change", () => {
      state.tomorrow = el.inputTomorrow.value;
      save(state);
      renderUpcoming();
    });
  }

  function upcomingDateInput() {
    return el.formUpcoming
      ? el.formUpcoming.querySelector('input[name="date"]')
      : null;
  }

  if (el.btnAddUpcoming && el.formUpcoming) {
    el.btnAddUpcoming.addEventListener("click", () => {
      editingUpcomingId = null;
      el.formUpcoming.reset();
      const di = upcomingDateInput();
      if (di) di.value = state.tomorrow || "";
      el.formUpcoming.classList.remove("hidden");
    });
  }

  if (el.cancelUpcoming && el.formUpcoming) {
    el.cancelUpcoming.addEventListener("click", () => {
      el.formUpcoming.classList.add("hidden");
      editingUpcomingId = null;
    });
  }

  if (el.formUpcoming) {
    el.formUpcoming.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(el.formUpcoming);
      const home = String(fd.get("home") || "").trim();
      const away = String(fd.get("away") || "").trim();
      const time = String(fd.get("time") || "").trim();
      let date = String(fd.get("date") || "").trim();
      if (!date) date = state.tomorrow || "";
      if (!home || !away) return;

      if (editingUpcomingId) {
        state.upcoming = state.upcoming.map((x) =>
          x.id === editingUpcomingId
            ? { ...x, home, away, time, date: date || x.date }
            : x
        );
        editingUpcomingId = null;
      } else {
        state.upcoming.push({
          id: uid(),
          home,
          away,
          time,
          date,
        });
      }
      save(state);
      el.formUpcoming.classList.add("hidden");
      el.formUpcoming.reset();
      render();
      goToResumenIfApp();
    });
  }

  if (el.btnAddResult && el.formResult) {
    el.btnAddResult.addEventListener("click", () => {
      editingResultId = null;
      el.formResult.reset();
      el.formResult.classList.remove("hidden");
    });
  }

  if (el.cancelResult && el.formResult) {
    el.cancelResult.addEventListener("click", () => {
      el.formResult.classList.add("hidden");
      editingResultId = null;
    });
  }

  if (el.formResult) {
    el.formResult.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(el.formResult);
      const home = String(fd.get("home") || "").trim();
      const away = String(fd.get("away") || "").trim();
      const scoreHome = parseInt(fd.get("scoreHome"), 10);
      const scoreAway = parseInt(fd.get("scoreAway"), 10);
      const date = String(fd.get("date") || "").trim();
      if (!home || !away || Number.isNaN(scoreHome) || Number.isNaN(scoreAway))
        return;

      const { aggHome, aggAway } = parseAgg(fd);

      function patchResult(base) {
        const n = { ...base, home, away, scoreHome, scoreAway, date };
        if (aggHome != null && aggAway != null) {
          n.aggHome = aggHome;
          n.aggAway = aggAway;
        } else {
          delete n.aggHome;
          delete n.aggAway;
        }
        return n;
      }

      if (editingResultId) {
        state.results = state.results.map((x) =>
          x.id === editingResultId ? patchResult(x) : x
        );
        editingResultId = null;
      } else {
        state.results.push(
          patchResult({
            id: uid(),
          })
        );
      }
      save(state);
      el.formResult.classList.add("hidden");
      el.formResult.reset();
      render();
      goToResumenIfApp();
    });
  }

  if (el.btnExport) {
    el.btnExport.addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], {
        type: "application/json",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "torneo-dls.json";
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  if (el.importFile) {
    el.importFile.addEventListener("change", () => {
      const file = el.importFile.files && el.importFile.files[0];
      el.importFile.value = "";
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result));
          state = {
            ...defaultState(),
            ...data,
            upcoming: Array.isArray(data.upcoming) ? data.upcoming : [],
            results: Array.isArray(data.results) ? data.results : [],
          };
          save(state);
          render();
          goToResumenIfApp();
        } catch {
          alert("El archivo no es un JSON válido.");
        }
      };
      reader.readAsText(file);
    });
  }

  function initTomorrowDefault() {
    if (!state.tomorrow) {
      const t = new Date();
      t.setDate(t.getDate() + 1);
      const y = t.getFullYear();
      const m = String(t.getMonth() + 1).padStart(2, "0");
      const d = String(t.getDate()).padStart(2, "0");
      state.tomorrow = `${y}-${m}-${d}`;
      save(state);
    }
  }

  document.querySelectorAll(".app-nav-btn[data-panel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = btn.getAttribute("data-panel");
      if (p) showPanel(p);
    });
  });

  async function bootstrap() {
    try {
      await pullMerge();
    } catch (e) {
      console.warn("[DLS] sync inicial:", e);
    }
    initTomorrowDefault();
    updateSyncStatusUI();
    showAppShell();
  }

  bootstrap();
})();
