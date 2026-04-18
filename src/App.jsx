import { useState, useEffect, useCallback } from "react";

// ══════════════════════════════════════════════════════════════════════════
// SUPABASE CONFIG — replace these two values with your project credentials
// ══════════════════════════════════════════════════════════════════════════
const SUPABASE_URL  = "https://pyfqstrtoyjdoetkriuu.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5ZnFzdHJ0b3lqZG9ldGtyaXV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NDM3OTAsImV4cCI6MjA5MjExOTc5MH0.kOrzjorO_JQVts7d3AiAw6Ns9FTrVmkLuRnBSVTBP6M";

// ── ONE-TIME SQL SETUP (run in your Supabase SQL editor) ──────────────────
//
// create table if not exists swgth_picks (
//   id uuid primary key default gen_random_uuid(),
//   player_name text not null unique,
//   picks jsonb not null default '{}',
//   updated_at timestamptz default now()
// );
//
// create table if not exists swgth_actuals (
//   id text primary key,
//   winner text,
//   games int,
//   updated_at timestamptz default now()
// );
//
// alter table swgth_picks   enable row level security;
// alter table swgth_actuals enable row level security;
//
// create policy "public read"   on swgth_picks   for select using (true);
// create policy "public insert" on swgth_picks   for insert with check (true);
// create policy "public update" on swgth_picks   for update using (true);
// create policy "public read"   on swgth_actuals for select using (true);
// create policy "public insert" on swgth_actuals for insert with check (true);
// create policy "public update" on swgth_actuals for update using (true);
//
// ─────────────────────────────────────────────────────────────────────────

// ── ESPN name overrides (short name → our bracket name) ──────────────────
const ESPN_NAME_MAP = { "Blazers": "Trail Blazers", "Wolves": "Timberwolves" };
const espnName = n => ESPN_NAME_MAP[n] || n;

async function fetchESPNCompletedSeries() {
  const start = new Date("2026-04-18");
  const today = new Date();
  const dates = [];
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1))
    dates.push(d.toISOString().slice(0, 10).replace(/-/g, ""));

  const fetchDay = async (dateStr) => {
    try {
      const r = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?seasontype=3&season=2026&dates=${dateStr}`
      );
      return r.ok ? (await r.json()).events || [] : [];
    } catch { return []; }
  };

  const allEvents = (await Promise.all(dates.map(fetchDay))).flat();
  const seriesMap = new Map();

  for (const event of allEvents) {
    const comp = event.competitions?.[0];
    if (!comp) continue;
    const raw = comp.series;
    const ps = Array.isArray(raw) ? raw.find(s => s.type === "playoff") : raw?.type === "playoff" ? raw : null;
    if (!ps) continue;

    const [c1, c2] = comp.competitors;
    const t1 = espnName(c1?.team?.name);
    const t2 = espnName(c2?.team?.name);
    if (!t1 || !t2) continue;

    const key = [t1, t2].sort().join("|");
    if (ps.completed || !seriesMap.has(key)) {
      const sc1 = ps.competitors.find(c => c.id === c1.id);
      const sc2 = ps.competitors.find(c => c.id === c2.id);
      if (!sc1 || !sc2) continue;
      seriesMap.set(key, {
        team1: t1, team2: t2, completed: ps.completed,
        winner: ps.completed ? (sc1.wins > sc2.wins ? t1 : t2) : null,
        games: ps.completed ? sc1.wins + sc2.wins : null,
      });
    }
  }
  return [...seriesMap.values()].filter(s => s.completed);
}

async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      "apikey": SUPABASE_ANON,
      "Authorization": `Bearer ${SUPABASE_ANON}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

const DB = {
  getAllPicks: () =>
    sbFetch("swgth_picks?select=player_name,picks&order=updated_at.desc"),

  savePicks: (playerName, picks) =>
    sbFetch("swgth_picks", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ player_name: playerName, picks, updated_at: new Date().toISOString() }),
    }),

  getAllActuals: () =>
    sbFetch("swgth_actuals?select=id,winner,games"),

  saveActual: (id, winner, games) =>
    sbFetch("swgth_actuals", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id, winner, games, updated_at: new Date().toISOString() }),
    }),
};

// ── 2026 NBA Playoffs Bracket ─────────────────────────────────────────────
const INITIAL_BRACKET = {
  east: [
    { id: "e1", seed1: 1, team1: "Pistons",      seed2: 8, team2: "Magic",         conf: "East", round: 1 },
    { id: "e2", seed1: 2, team1: "Celtics",      seed2: 7, team2: "76ers",         conf: "East", round: 1 },
    { id: "e3", seed1: 3, team1: "Knicks",       seed2: 6, team2: "Hawks",         conf: "East", round: 1 },
    { id: "e4", seed1: 4, team1: "Cavaliers",    seed2: 5, team2: "Raptors",       conf: "East", round: 1 },
  ],
  west: [
    { id: "w1", seed1: 1, team1: "Thunder",      seed2: 8, team2: "Suns",          conf: "West", round: 1 },
    { id: "w2", seed1: 2, team1: "Spurs",        seed2: 7, team2: "Trail Blazers", conf: "West", round: 1 },
    { id: "w3", seed1: 3, team1: "Nuggets",      seed2: 6, team2: "Timberwolves",  conf: "West", round: 1 },
    { id: "w4", seed1: 4, team1: "Lakers",       seed2: 5, team2: "Rockets",       conf: "West", round: 1 },
  ],
};

const ROUND_NAMES  = ["First Round", "Conf. Semifinals", "Conf. Finals", "NBA Finals"];
const GAME_OPTIONS = [4, 5, 6, 7];

const TEAM_COLORS = {
  Pistons: "#C8102E", Magic: "#0077C0", Celtics: "#007A33", "76ers": "#006BB6",
  Knicks: "#F58426", Hawks: "#E03A3E", Cavaliers: "#860038", Raptors: "#CE1141",
  Thunder: "#007AC1", Suns: "#E56020", Spurs: "#c0c7d0", "Trail Blazers": "#E03A3E",
  Nuggets: "#FEC524", Timberwolves: "#236192", Lakers: "#FDB927", Rockets: "#CE1141",
};

function calcScore(pick, actual) {
  if (!pick || !actual) return 0;
  if (pick.winner !== actual.winner) return 0;
  return Math.max(0, 4 - Math.abs(pick.games - actual.games));
}

// ══════════════════════════════════════════════════════════════════════════
// APP
// ══════════════════════════════════════════════════════════════════════════
export default function App() {
  const [screen, setScreen]             = useState("home");
  const [playerName, setPlayerName]     = useState("");
  const [nameInput, setNameInput]       = useState("");
  const [picks, setPicks]               = useState({});
  const [allPlayers, setAllPlayers]     = useState([]);
  const [actuals, setActuals]           = useState({});
  const [adminPass, setAdminPass]       = useState("");
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [saveState, setSaveState]       = useState("idle"); // idle | saving | saved | error
  const [loading, setLoading]           = useState(false);
  const [syncing, setSyncing]           = useState(false);
  const [syncMsg, setSyncMsg]           = useState("");

  const isConfigured = SUPABASE_URL !== "YOUR_SUPABASE_URL";

  // ── Build bracket from actuals ─────────────────────────────────────
  const bracket = buildBracket(INITIAL_BRACKET, actuals);

  function buildBracket(init, results) {
    const east = [...init.east];
    const west = [...init.west];
    for (let r = 2; r <= 4; r++) {
      const ep = east.filter(s => s.round === r - 1);
      const wp = west.filter(s => s.round === r - 1);
      if (r <= 3) {
        pairWinners(ep, results).forEach((p, i) =>
          east.push({ ...p, id: `e${r}${i}`, conf: "East", round: r }));
        pairWinners(wp, results).forEach((p, i) =>
          west.push({ ...p, id: `w${r}${i}`, conf: "West", round: r }));
      } else {
        const ew = getWinner(east.find(s => s.round === 3), results);
        const ww = getWinner(west.find(s => s.round === 3), results);
        if (ew && ww)
          east.push({ id: "finals", seed1: null, team1: ew, seed2: null, team2: ww, conf: "Finals", round: 4 });
      }
    }
    return { east, west };
  }

  function getWinner(series, results) {
    return results[series?.id]?.winner || null;
  }

  function pairWinners(prev, results) {
    const ws = prev.map(s => getWinner(s, results)).filter(Boolean);
    const pairs = [];
    for (let i = 0; i < ws.length; i += 2)
      if (ws[i] && ws[i + 1])
        pairs.push({ seed1: null, team1: ws[i], seed2: null, team2: ws[i + 1] });
    return pairs;
  }

  function getAllSeries() {
    const all = [];
    for (let r = 1; r <= 4; r++)
      all.push(...bracket.east.filter(s => s.round === r), ...bracket.west.filter(s => s.round === r));
    return all;
  }

  // ── Supabase fetch ─────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    if (!isConfigured) return;
    setLoading(true);
    try {
      const [pRaw, aRaw] = await Promise.all([DB.getAllPicks(), DB.getAllActuals()]);
      setAllPlayers(pRaw.map(r => ({ name: r.player_name, picks: r.picks || {} })));
      const am = {};
      aRaw.forEach(r => { am[r.id] = { winner: r.winner, games: r.games }; });
      setActuals(am);
    } catch (e) { console.error("DB fetch error:", e); }
    setLoading(false);
  }, [isConfigured]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Pre-fill picks for returning player
  useEffect(() => {
    if (!playerName) return;
    const existing = allPlayers.find(p => p.name.toLowerCase() === playerName.toLowerCase());
    if (existing) setPicks(existing.picks || {});
  }, [playerName]);

  // ── Save picks ─────────────────────────────────────────────────────
  async function submitPicks() {
    setSaveState("saving");
    const locked = [...(picks._lockedRounds || [])];
    if (!locked.includes(currentRound)) locked.push(currentRound);
    const lockedPicks = { ...picks, _lockedRounds: locked };
    try {
      if (isConfigured) {
        await DB.savePicks(playerName, lockedPicks);
        await fetchAll();
      } else {
        setAllPlayers(prev => {
          const i = prev.findIndex(p => p.name.toLowerCase() === playerName.toLowerCase());
          const e = { name: playerName, picks: lockedPicks };
          return i >= 0 ? prev.map((p, j) => (j === i ? e : p)) : [...prev, e];
        });
      }
      setPicks(lockedPicks);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2500);
    } catch (err) {
      console.error(err);
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 3000);
    }
  }

  // ── Save actual result ─────────────────────────────────────────────
  async function saveActual(id, winner, games) {
    setActuals(prev => ({ ...prev, [id]: { winner, games } }));
    if (isConfigured) {
      try { await DB.saveActual(id, winner, games); } catch (e) { console.error(e); }
    }
  }

  // ── ESPN auto-sync ─────────────────────────────────────────────────
  async function syncESPN() {
    setSyncing(true);
    setSyncMsg("");
    try {
      const espnSeries = await fetchESPNCompletedSeries();
      let current = { ...actuals };

      // 4 passes so later-round matchups resolve after earlier actuals are applied
      for (let pass = 0; pass < 4; pass++) {
        const b = buildBracket(INITIAL_BRACKET, current);
        const all = [...b.east, ...b.west];
        for (const es of espnSeries) {
          const match = all.find(s =>
            (s.team1 === es.team1 && s.team2 === es.team2) ||
            (s.team1 === es.team2 && s.team2 === es.team1)
          );
          if (match && !current[match.id])
            current[match.id] = { winner: es.winner, games: es.games };
        }
      }

      const updates = Object.entries(current).filter(([id, v]) =>
        !actuals[id] || actuals[id].winner !== v.winner || actuals[id].games !== v.games
      );
      for (const [id, { winner, games }] of updates)
        await saveActual(id, winner, games);

      setSyncMsg(updates.length ? `✓ ${updates.length} series updated` : "✓ Already up to date");
    } catch (e) {
      console.error("ESPN sync error:", e);
      setSyncMsg("⚠ Sync failed — check console");
    }
    setSyncing(false);
    setTimeout(() => setSyncMsg(""), 4000);
  }

  // ── Active round (derived from results) ───────────────────────────
  function getActiveRound() {
    const all = getAllSeries();
    for (let r = 1; r <= 4; r++) {
      const rs = all.filter(s => s.round === r);
      if (rs.length === 0) continue;
      if (!rs.every(s => actuals[s.id]?.winner)) return r;
    }
    return 4;
  }
  const currentRound = getActiveRound();
  const lockedRounds = new Set(picks._lockedRounds || []);
  const isRoundLocked = lockedRounds.has(currentRound);

  // ── Leaderboard ────────────────────────────────────────────────────
  function scorePlayer(p) {
    return getAllSeries().reduce((sum, s) => sum + calcScore(p[s.id], actuals[s.id]), 0);
  }
  const leaderboard = [...allPlayers]
    .map(p => ({ name: p.name, score: scorePlayer(p.picks) }))
    .sort((a, b) => b.score - a.score);

  const visibleSeries = getAllSeries().filter(s => s.round === currentRound);
  const pickedCount = visibleSeries.filter(s => picks[s.id]).length;
  const totalSeries = visibleSeries.length;

  // ══════════════════════════════════════════════════════════════════
  return (
    <div style={S.root}>
      <style>{CSS}</style>

      {/* ── HEADER ──────────────────────────────────────────────── */}
      <header style={S.header}>
        <div style={S.headerInner}>
          <div style={S.logo} onClick={() => setScreen("home")}>
            <div style={S.logoChip}>SWG</div>
            <div>
              <div style={S.logoLine1} className="logo-line1">SHORT WHITE GUYS TALKING HOOPS</div>
              <div style={S.logoLine2}>2026 NBA PLAYOFFS PICK'EM</div>
            </div>
          </div>
          <nav style={S.nav}>
            {playerName && (
              <button style={screen === "pick" ? S.navOn : S.navOff} onClick={() => setScreen("pick")}>Picks</button>
            )}
            <button style={screen === "leaderboard" ? S.navOn : S.navOff} onClick={() => setScreen("leaderboard")}>Board</button>
            <button style={screen === "admin" ? S.navOn : S.navOff} onClick={() => setScreen("admin")}>Results</button>
          </nav>
        </div>
      </header>

      {/* ── SUPABASE SETUP NOTICE ────────────────────────────────── */}
      {!isConfigured && (
        <div style={S.notice}>
          ⚡ <strong>Demo mode</strong> — picks only save on this device.
          Add your Supabase URL + anon key at the top of the source to enable shared picks.
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          HOME
      ════════════════════════════════════════════════════════════ */}
      {screen === "home" && (
        <div style={S.homeWrap}>
          <div style={S.homeGrid} className="home-grid">

            {/* Left — branding panel */}
            <div style={S.brandPanel} className="brand-panel">
              <div style={S.brandBall}>🏀</div>
              <div style={S.brandName}>
                <span style={S.brandShort}>SHORT</span>
                <span style={S.brandWhite}>WHITE</span>
                <span style={S.brandGuys}>GUYS</span>
              </div>
              <div style={S.brandSub}>TALKING HOOPS</div>
              <div style={S.brandRule} />
              <div style={S.brandYear}>2026 PLAYOFFS</div>
            </div>

            {/* Right — entry */}
            <div style={S.entryPanel} className="entry-panel">
              <div style={S.entryTag}>PICK'EM CHALLENGE</div>
              <h1 style={S.entryTitle}>Who you<br/>got?</h1>
              <p style={S.entrySub}>
                Pick every series winner + game length.<br/>
                <span style={{ color: C.gold }}>+4 pts</span> right winner &nbsp;·&nbsp; <span style={{ color: "#f87171" }}>−1 pt</span> per game off.
              </p>
              <input
                style={S.input}
                placeholder="Your name"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && nameInput.trim()) {
                    setPlayerName(nameInput.trim()); setScreen("pick");
                  }
                }}
              />
              <button
                style={{ ...S.cta, opacity: nameInput.trim() ? 1 : 0.4 }}
                disabled={!nameInput.trim()}
                onClick={() => { setPlayerName(nameInput.trim()); setScreen("pick"); }}
              >
                LOCK IN →
              </button>
              <button style={S.ghost} onClick={() => setScreen("leaderboard")}>View Leaderboard</button>
              {loading && <p style={S.loadNote}>Loading group picks…</p>}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          PICKS
      ════════════════════════════════════════════════════════════ */}
      {screen === "pick" && (
        <div style={S.pickWrap} className="pick-wrap">
          <div style={S.pickTopBar}>
            <div>
              <span style={S.pickGreet}>Making picks as </span>
              <span style={S.pickName}>{playerName}</span>
            </div>
            <button style={S.backBtn} onClick={() => setScreen("home")}>← Back</button>
          </div>

          {/* Round header */}
          <div style={S.roundHeader}>
            <div>
              <div style={S.roundHeaderLabel}>{ROUND_NAMES[currentRound - 1]}</div>
              <div style={S.roundHeaderSub}>Round {currentRound} of 4</div>
            </div>
            {isRoundLocked && (
              <div style={S.lockedChip}>PICKS LOCKED</div>
            )}
          </div>

          {/* Series cards */}
          <div style={S.cardList}>
            {visibleSeries.length === 0 && (
              <div style={S.empty}>No matchups yet — check back soon.</div>
            )}
            {visibleSeries.map(s => (
              <SeriesCard key={s.id} series={s}
                pick={picks[s.id]} actual={actuals[s.id]}
                locked={isRoundLocked}
                onChange={p => !isRoundLocked && setPicks(prev => ({ ...prev, [s.id]: p }))}
              />
            ))}
          </div>

          {/* Sticky save bar */}
          <div style={S.saveBar} className="save-bar">
            <div>
              <div style={S.saveBarName}>{playerName}</div>
              <div style={S.saveBarSub}>
                {isRoundLocked
                  ? "Picks locked for this round"
                  : `${pickedCount} of ${totalSeries} picks made`}
              </div>
            </div>
            <button
              disabled={saveState === "saving" || isRoundLocked}
              style={{
                ...S.saveBtn,
                ...(isRoundLocked ? { background: C.muted, cursor: "not-allowed" } : {}),
                ...(saveState === "saved"  ? { background: "#16a34a" } : {}),
                ...(saveState === "error"  ? { background: "#dc2626" } : {}),
                ...(saveState === "saving" ? { background: C.muted, cursor: "not-allowed" } : {}),
              }}
              onClick={submitPicks}
            >
              {isRoundLocked   ? "Locked"
               : saveState === "saving" ? "Saving…"
               : saveState === "saved"  ? "✓ Saved!"
               : saveState === "error"  ? "Error — retry"
               : "Save Picks"}
            </button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          LEADERBOARD
      ════════════════════════════════════════════════════════════ */}
      {screen === "leaderboard" && (
        <div style={S.page}>
          <div style={S.pageTop}>
            <div>
              <h2 style={S.pageTitle}>Leaderboard</h2>
              <div style={S.pageSub}>Short White Guys Talking Hoops · 2026 Playoffs</div>
            </div>
            <button style={S.refreshBtn} onClick={fetchAll} title="Refresh">
              {loading ? "…" : "↻ Refresh"}
            </button>
          </div>

          {allPlayers.length === 0 ? (
            <div style={S.empty}>No picks in yet — be the first.</div>
          ) : (
            <div style={S.lbList}>
              {leaderboard.map((p, i) => (
                <div key={p.name} className="lb-row" style={{
                  ...S.lbRow,
                  ...(i === 0 ? { borderColor: `${C.gold}66`, background: `${C.gold}0a` } : {}),
                  ...(p.name === playerName ? { outline: `2px solid ${C.gold}44`, outlineOffset: 2 } : {}),
                }}>
                  <div style={S.lbRank}>
                    {i === 0 ? "🏆" : i === 1 ? "🥈" : i === 2 ? "🥉" : <span style={{ color: C.muted }}>{i + 1}</span>}
                  </div>
                  <div style={S.lbName}>
                    {p.name}
                    {p.name === playerName && <span style={S.meChip}>YOU</span>}
                  </div>
                  <div style={S.lbScore} className="lb-score">
                    {p.score}<span style={S.lbPts}> pts</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={S.scoringCard}>
            <div style={S.scoringHead}>HOW SCORING WORKS</div>
            <div style={S.scoringLines}>
              <div style={S.scoreLine}><span>Correct winner</span><span style={{ color: C.gold }}>+4 pts</span></div>
              <div style={S.scoreLine}><span>Each game off</span><span style={{ color: "#f87171" }}>−1 pt</span></div>
              <div style={S.scoreLine}><span>Wrong winner</span><span style={{ color: C.muted }}>0 pts</span></div>
            </div>
            <div style={S.scoreEx}>Example: pick winner in 5, goes 7 → +2 pts</div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          ADMIN / RESULTS
      ════════════════════════════════════════════════════════════ */}
      {screen === "admin" && (
        <div style={S.page}>
          <h2 style={S.pageTitle}>Enter Results</h2>
          {!adminUnlocked ? (
            <div style={S.lockBox}>
              <div style={S.lockIcon}>🔒</div>
              <p style={S.lockNote}>Commissioner only. Enter the password to enter results.</p>
              <input
                style={S.input}
                type="password"
                placeholder="Password"
                value={adminPass}
                onChange={e => setAdminPass(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && (adminPass === "swgth2026" || adminPass === ""))
                    setAdminUnlocked(true);
                }}
              />
              <button style={S.cta}
                onClick={() => { if (adminPass === "swgth2026" || adminPass === "") setAdminUnlocked(true); }}>
                Unlock
              </button>
              <p style={S.lockHint}>Default password: <code style={{ color: C.gold }}>swgth2026</code></p>
            </div>
          ) : (
            <>
              <div style={S.syncRow}>
                <button style={S.syncBtn} onClick={syncESPN} disabled={syncing}>
                  {syncing ? "Syncing…" : "⚡ Sync from ESPN"}
                </button>
                {syncMsg && <span style={S.syncMsg}>{syncMsg}</span>}
              </div>
              <p style={{ ...S.lockNote, textAlign: "left", marginBottom: 20 }}>
                Or enter results manually below — overrides ESPN data.
              </p>
              {[1, 2, 3, 4].map(round => {
                const rs = getAllSeries().filter(s => s.round === round);
                if (!rs.length) return null;
                return (
                  <div key={round}>
                    <div style={S.roundLabel}>{ROUND_NAMES[round - 1]}</div>
                    {rs.map(s => (
                      <AdminRow key={s.id} series={s} actual={actuals[s.id]}
                        onChange={(w, g) => saveActual(s.id, w, g)} />
                    ))}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Series Card ───────────────────────────────────────────────────────────
function SeriesCard({ series, pick, actual, locked, onChange }) {
  const { team1, team2, seed1, seed2 } = series;
  const winner = pick?.winner;
  const games  = pick?.games;
  const c1 = TEAM_COLORS[team1] || "#888";
  const c2 = TEAM_COLORS[team2] || "#888";
  const scored  = actual && pick ? calcScore(pick, actual) : null;
  const correct = actual && pick && pick.winner === actual.winner;

  return (
    <div style={{ ...S.card, ...(winner ? S.cardActive : {}), ...(locked ? { opacity: 0.75 } : {}) }}>

      {/* Result banner */}
      {actual?.winner && (
        <div style={{
          ...S.resultBanner,
          background: correct ? "#16a34a15" : "#dc262615",
          color:      correct ? "#4ade80"   : "#f87171",
          borderColor:correct ? "#16a34a44" : "#dc262644",
        }}>
          {actual.winner} in {actual.games}
          {scored !== null && <strong style={{ marginLeft: 8 }}>
            {scored > 0 ? `+${scored}` : scored} pts
          </strong>}
        </div>
      )}

      <div style={S.matchup}>
        {/* Team 1 */}
        <button
          disabled={locked}
          className="team-btn"
          style={{
            ...S.teamBtn,
            ...(winner === team1 ? {
              background: `${c1}1a`, borderColor: c1,
              boxShadow: `0 0 16px ${c1}2a`,
            } : {}),
            ...(locked ? { cursor: "default" } : {}),
          }}
          onClick={() => onChange({ winner: team1, games: games || 6 })}
        >
          {seed1 != null && <span style={S.seed}>#{seed1}</span>}
          <span className="team-name" style={{ ...S.teamName, ...(winner === team1 ? { color: "#fff" } : {}) }}>{team1}</span>
          {winner === team1 && <div style={{ ...S.selDot, background: c1 }} />}
        </button>

        {/* Middle column */}
        <div style={S.midCol}>
          <span style={S.vs}>VS</span>
        </div>

        {/* Team 2 */}
        <button
          disabled={locked}
          className="team-btn"
          style={{
            ...S.teamBtn,
            ...(winner === team2 ? {
              background: `${c2}1a`, borderColor: c2,
              boxShadow: `0 0 16px ${c2}2a`,
            } : {}),
            ...(locked ? { cursor: "default" } : {}),
          }}
          onClick={() => onChange({ winner: team2, games: games || 6 })}
        >
          {seed2 != null && <span style={S.seed}>#{seed2}</span>}
          <span className="team-name" style={{ ...S.teamName, ...(winner === team2 ? { color: "#fff" } : {}) }}>{team2}</span>
          {winner === team2 && <div style={{ ...S.selDot, background: c2 }} />}
        </button>
      </div>

      {/* Game count row — full width, appears after picking a winner */}
      {winner && (
        <div style={S.gameRow}>
          <span style={S.gameRowLabel}>IN HOW MANY?</span>
          <div style={S.gameRowBtns}>
            {GAME_OPTIONS.map(g => (
              <button key={g}
                disabled={locked}
                style={{
                  ...S.gameRowBtn,
                  ...(games === g ? {
                    background: winner === team1 ? c1 : c2,
                    borderColor: winner === team1 ? c1 : c2,
                    color: "#fff", fontWeight: 900,
                  } : {}),
                  ...(locked ? { cursor: "default" } : {}),
                }}
                onClick={() => onChange({ winner, games: g })}
              >
                <span style={S.gameRowNum}>{g}</span>
                <span style={S.gameRowGames}>games</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Admin Row ─────────────────────────────────────────────────────────────
function AdminRow({ series, actual, onChange }) {
  const { team1, team2 } = series;
  return (
    <div style={S.adminRow}>
      <span style={S.adminLabel}>{team1} vs {team2}</span>
      <div style={S.adminCtrls}>
        <select style={S.sel} value={actual?.winner || ""}
          onChange={e => onChange(e.target.value, actual?.games || 6)}>
          <option value="">Winner</option>
          <option value={team1}>{team1}</option>
          <option value={team2}>{team2}</option>
        </select>
        <select style={S.sel} value={actual?.games || ""}
          onChange={e => onChange(actual?.winner || team1, parseInt(e.target.value))}>
          <option value="">Games</option>
          {GAME_OPTIONS.map(n => <option key={n} value={n}>in {n}</option>)}
        </select>
      </div>
    </div>
  );
}

// ── Design tokens ─────────────────────────────────────────────────────────
const C = {
  bg:      "#07090c",
  surface: "#0d1117",
  card:    "#111720",
  border:  "#1a2132",
  text:    "#d8dfed",
  muted:   "#4e5a6e",
  gold:    "#f5a623",
  green:   "#22c55e",
  red:     "#ef4444",
};

const S = {
  root: {
    minHeight: "100vh", background: C.bg, color: C.text,
    fontFamily: "'Barlow Condensed', 'Impact', sans-serif",
  },

  // Header
  header: {
    borderBottom: `1px solid ${C.border}`, padding: "0 16px",
    position: "sticky", top: 0,
    background: `${C.bg}f2`, backdropFilter: "blur(12px)", zIndex: 50,
  },
  headerInner: {
    maxWidth: 960, margin: "0 auto",
    display: "flex", alignItems: "center", justifyContent: "space-between", height: 56,
  },
  logo: { display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" },
  logoChip: {
    width: 36, height: 36, borderRadius: 7,
    background: C.gold, color: C.bg,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 12, fontWeight: 900, letterSpacing: "0.04em", flexShrink: 0,
  },
  logoLine1: { fontSize: 13, fontWeight: 800, letterSpacing: "0.08em", color: C.text },
  logoLine2: { fontSize: 9, color: C.muted, letterSpacing: "0.12em", marginTop: 1 },
  nav: { display: "flex", gap: 4 },
  navOff: { background: "none", border: "none", color: C.muted, padding: "6px 10px", cursor: "pointer", fontSize: 12, letterSpacing: "0.07em", borderRadius: 4, fontFamily: "inherit", fontWeight: 600 },
  navOn: {
    background: `${C.gold}18`, border: `1px solid ${C.gold}55`,
    color: C.gold, padding: "5px 10px", cursor: "pointer",
    fontSize: 12, letterSpacing: "0.07em", borderRadius: 4,
    fontFamily: "inherit", fontWeight: 700,
  },

  notice: {
    background: "#451a0322", borderBottom: `1px solid #78350f44`,
    color: "#fde68a", fontSize: 12, padding: "9px 20px",
    textAlign: "center", letterSpacing: "0.02em",
  },

  // Home
  homeWrap: {
    display: "flex", alignItems: "center", justifyContent: "center",
    minHeight: "calc(100vh - 56px)", padding: "24px 16px",
  },
  homeGrid: {
    maxWidth: 800, width: "100%",
    display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0,
    border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden",
  },

  // Brand panel (left)
  brandPanel: {
    background: `linear-gradient(145deg, #0c1220 0%, #07090c 100%)`,
    borderRight: `1px solid ${C.border}`,
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    padding: "48px 32px", gap: 0,
    position: "relative",
  },
  brandBall: { fontSize: 56, marginBottom: 20, filter: "drop-shadow(0 0 24px #f5a62340)" },
  brandName: { display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 0.9, marginBottom: 10 },
  brandShort: { fontSize: 42, fontWeight: 900, color: C.gold, letterSpacing: "0.06em" },
  brandWhite: { fontSize: 42, fontWeight: 900, color: C.text, letterSpacing: "0.06em" },
  brandGuys:  { fontSize: 42, fontWeight: 900, color: C.text, letterSpacing: "0.06em" },
  brandSub: { fontSize: 32, fontWeight: 900, color: C.text, letterSpacing: "0.18em", marginBottom: 24 },
  brandRule: { width: 40, height: 2, background: C.gold, marginBottom: 16 },
  brandYear: { fontSize: 11, color: C.muted, letterSpacing: "0.2em" },

  // Entry panel (right)
  entryPanel: {
    background: C.surface,
    padding: "48px 32px",
    display: "flex", flexDirection: "column", justifyContent: "center",
  },
  entryTag: {
    fontSize: 9, color: C.gold, letterSpacing: "0.2em",
    background: `${C.gold}18`, border: `1px solid ${C.gold}33`,
    padding: "4px 10px", borderRadius: 2,
    display: "inline-block", marginBottom: 20, width: "fit-content",
  },
  entryTitle: {
    fontSize: "clamp(40px, 8vw, 64px)", fontWeight: 900,
    lineHeight: 0.9, letterSpacing: "-0.01em",
    margin: "0 0 16px", textTransform: "uppercase", color: C.text,
  },
  entrySub: {
    color: C.muted, fontSize: 13, lineHeight: 1.8, marginBottom: 28,
    fontFamily: "'Barlow', sans-serif", fontWeight: 400,
  },
  input: {
    width: "100%", background: C.card, border: `1px solid ${C.border}`,
    borderRadius: 6, padding: "12px 14px", color: C.text, fontSize: 14,
    outline: "none", boxSizing: "border-box", marginBottom: 10,
    fontFamily: "inherit", transition: "border-color 0.15s",
  },
  cta: {
    width: "100%", background: C.gold, border: "none", borderRadius: 6,
    padding: "13px", color: C.bg, fontSize: 15, fontWeight: 900,
    letterSpacing: "0.1em", cursor: "pointer", fontFamily: "inherit",
    textTransform: "uppercase", transition: "background 0.15s", marginBottom: 8,
  },
  ghost: {
    width: "100%", background: "none", border: `1px solid ${C.border}`,
    borderRadius: 6, padding: "11px", color: C.muted, fontSize: 13,
    cursor: "pointer", fontFamily: "inherit",
  },
  loadNote: { fontSize: 11, color: C.muted, marginTop: 10, letterSpacing: "0.05em" },

  // Picks
  pickWrap: { maxWidth: 960, margin: "0 auto", padding: "20px 16px 100px" },
  pickTopBar: {
    display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20,
  },
  pickGreet: { fontSize: 13, color: C.muted, fontFamily: "'Barlow', sans-serif" },
  pickName: { fontSize: 15, fontWeight: 900, color: C.gold, letterSpacing: "0.06em", textTransform: "uppercase" },
  backBtn: { background: "none", border: "none", color: C.muted, fontSize: 12, cursor: "pointer", letterSpacing: "0.05em", fontFamily: "inherit" },

  roundHeader: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    marginBottom: 20, paddingBottom: 16, borderBottom: `1px solid ${C.border}`,
  },
  roundHeaderLabel: { fontSize: 22, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase" },
  roundHeaderSub: { fontSize: 10, color: C.muted, letterSpacing: "0.14em", marginTop: 3 },
  lockedChip: {
    fontSize: 9, fontWeight: 800, letterSpacing: "0.14em",
    background: `${C.border}`, border: `1px solid ${C.muted}44`,
    color: C.muted, padding: "5px 10px", borderRadius: 3,
  },

  cardList: { display: "flex", flexDirection: "column", gap: 10 },
  card: {
    background: C.card, border: `1px solid ${C.border}`,
    borderRadius: 12, padding: "16px 14px", transition: "border-color 0.2s",
  },
  cardActive: { borderColor: "#1e2d45" },
  resultBanner: {
    fontSize: 12, padding: "6px 12px", borderRadius: 5,
    border: "1px solid", marginBottom: 12,
    letterSpacing: "0.04em", fontFamily: "'Barlow', sans-serif",
  },
  matchup: { display: "flex", alignItems: "flex-start", gap: 8, justifyContent: "space-between" },
  teamBtn: {
    flex: 1, background: C.bg, border: `1px solid ${C.border}`,
    borderRadius: 8, padding: "14px 8px", cursor: "pointer",
    textAlign: "center", display: "flex", flexDirection: "column",
    alignItems: "center", gap: 5, transition: "all 0.15s", fontFamily: "inherit",
  },
  seed: { fontSize: 10, color: "#6b7a8f", letterSpacing: "0.06em" },
  teamName: { fontSize: 14, fontWeight: 900, color: C.text, letterSpacing: "0.04em", textTransform: "uppercase" },
  selDot: { width: 6, height: 6, borderRadius: "50%" },
  midCol: {
    display: "flex", flexDirection: "column",
    alignItems: "center", paddingTop: 16, flexShrink: 0, width: 40,
  },
  vs: { fontSize: 10, color: C.muted, letterSpacing: "0.14em" },

  gameRow: {
    marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}`,
    display: "flex", alignItems: "center", gap: 12,
  },
  gameRowLabel: { fontSize: 9, color: "#6b7a8f", letterSpacing: "0.14em", flexShrink: 0 },
  gameRowBtns: { display: "flex", gap: 8, flex: 1 },
  gameRowBtn: {
    flex: 1, background: C.bg, border: `1px solid ${C.border}`,
    borderRadius: 8, padding: "10px 4px", cursor: "pointer",
    fontFamily: "inherit", transition: "all 0.15s",
    display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
  },
  gameRowNum: { fontSize: 18, fontWeight: 900, color: C.text, lineHeight: 1 },
  gameRowGames: { fontSize: 8, color: "#6b7a8f", letterSpacing: "0.08em" },

  saveBar: {
    position: "fixed", bottom: 0, left: 0, right: 0,
    background: `${C.surface}f5`, borderTop: `1px solid ${C.border}`,
    padding: "12px 20px",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    backdropFilter: "blur(10px)", zIndex: 40,
  },
  saveBarName: { fontSize: 14, fontWeight: 900, color: C.gold, letterSpacing: "0.08em", textTransform: "uppercase" },
  saveBarSub: { fontSize: 10, color: C.muted, letterSpacing: "0.04em", marginTop: 2 },
  saveBtn: {
    background: C.gold, border: "none", borderRadius: 6,
    padding: "10px 28px", color: C.bg, fontSize: 13, fontWeight: 900,
    cursor: "pointer", letterSpacing: "0.1em", fontFamily: "inherit",
    textTransform: "uppercase", transition: "background 0.2s",
  },

  // Shared page layout
  page: { maxWidth: 680, margin: "0 auto", padding: "32px 16px 64px" },
  pageTop: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 },
  pageTitle: { fontSize: 28, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase", lineHeight: 1 },
  pageSub: { fontSize: 10, color: C.muted, letterSpacing: "0.14em", marginTop: 4 },
  refreshBtn: {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5,
    color: C.muted, padding: "6px 12px", cursor: "pointer",
    fontSize: 11, fontFamily: "inherit", letterSpacing: "0.06em",
  },
  empty: { color: C.muted, fontSize: 13, padding: "48px 0", textAlign: "center", fontFamily: "'Barlow', sans-serif" },

  lbList: { display: "flex", flexDirection: "column", gap: 6 },
  lbRow: {
    display: "flex", alignItems: "center",
    background: C.card, border: `1px solid ${C.border}`,
    borderRadius: 8, padding: "14px 18px", gap: 14,
  },
  lbRank: { width: 28, textAlign: "center", fontSize: 15, fontWeight: 900, flexShrink: 0 },
  lbName: { flex: 1, fontSize: 17, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase" },
  meChip: {
    fontSize: 8, background: `${C.gold}33`, color: C.gold,
    border: `1px solid ${C.gold}44`, borderRadius: 2,
    padding: "1px 5px", letterSpacing: "0.1em",
    marginLeft: 8, verticalAlign: "middle",
  },
  lbScore: { fontSize: 26, fontWeight: 900, color: C.gold, lineHeight: 1 },
  lbPts: { fontSize: 10, color: C.muted, fontWeight: 400 },

  scoringCard: {
    marginTop: 32, background: C.card, border: `1px solid ${C.border}`,
    borderRadius: 8, padding: "18px 20px",
    fontFamily: "'Barlow', sans-serif",
  },
  scoringHead: { fontSize: 9, color: C.muted, letterSpacing: "0.18em", marginBottom: 14, fontFamily: "inherit" },
  scoringLines: { display: "flex", flexDirection: "column", gap: 8 },
  scoreLine: { display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600 },
  scoreEx: { fontSize: 11, color: C.muted, marginTop: 12, fontStyle: "italic" },

  // Admin
  roundLabel: { fontSize: 9, color: C.muted, letterSpacing: "0.16em", textTransform: "uppercase", margin: "20px 0 8px" },
  adminRow: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
    padding: "12px 16px", marginBottom: 6, flexWrap: "wrap", gap: 10,
  },
  adminLabel: { fontSize: 14, fontWeight: 700, flex: 1 },
  adminCtrls: { display: "flex", gap: 8 },
  sel: {
    background: C.bg, border: `1px solid ${C.border}`, borderRadius: 5,
    padding: "7px 10px", color: C.text, fontSize: 12,
    fontFamily: "inherit", cursor: "pointer",
  },

  syncRow: { display: "flex", alignItems: "center", gap: 14, marginBottom: 20 },
  syncBtn: {
    background: `${C.gold}18`, border: `1px solid ${C.gold}55`, borderRadius: 6,
    color: C.gold, padding: "10px 18px", fontSize: 13, fontWeight: 700,
    cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.06em",
  },
  syncMsg: { fontSize: 12, color: C.muted, fontFamily: "'Barlow', sans-serif" },

  lockBox: { textAlign: "center", maxWidth: 340, margin: "0 auto", paddingTop: 20 },
  lockIcon: { fontSize: 32, marginBottom: 16 },
  lockNote: { color: C.muted, fontSize: 13, marginBottom: 20, lineHeight: 1.7, fontFamily: "'Barlow', sans-serif" },
  lockHint: { fontSize: 11, color: C.muted, marginTop: 14, fontFamily: "'Barlow', sans-serif" },
};

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800;900&family=Barlow:wght@400;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #07090c; -webkit-font-smoothing: antialiased; }
  button:not(:disabled):hover { opacity: 0.85; }
  input:focus, select:focus { outline: none; border-color: #f5a623 !important; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb { background: #1a2132; border-radius: 2px; }

  @media (max-width: 640px) {
    /* Home: stack panels, hide brand panel */
    .home-grid { grid-template-columns: 1fr !important; }
    .brand-panel { display: none !important; }
    .entry-panel { padding: 32px 24px !important; }

    /* Header: shrink logo text */
    .logo-line1 { font-size: 11px !important; }

    /* Picks: more breathing room on cards */
    .pick-wrap { padding: 16px 12px 100px !important; }
    .team-btn { padding: 12px 4px !important; }
    .team-name { font-size: 12px !important; }

    /* Save bar */
    .save-bar { padding: 10px 14px !important; }

    /* Leaderboard */
    .lb-row { padding: 12px 14px !important; }
    .lb-score { font-size: 20px !important; }
  }
`;
