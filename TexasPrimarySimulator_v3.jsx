import { useState, useEffect, useCallback, useRef } from "react";

// ─── ELECTION NAMESPACE ─────────────────────────────────────────────────────
// EKEY prefixes ALL storage keys — prevents cross-race/cycle data bleed
// Change for every new election cycle or race
const EKEY = "txsen2026_v3";

const ELECTION = {
  title: "U.S. Senate · Texas 2026",
  cycle: "2026 Primary Simulation",
  tagline: "Grassroots Straw Poll · One Voice Per Device Per Phase",
  primaryDate: "March 3, 2026",
  runoffDate: "May 26, 2026",
  generalDate: "November 3, 2026",
};

// ★ 2026 Texas U.S. Senate — official filings ★
// Source: Texas Secretary of State · Verified Ballotpedia Feb 2026
// Principle I enforced: name + party ONLY (no title field — removed per Phase 3 synthesis binding decision)
const CANDIDATES = {
  Republican: [
    { id: "r_cornyn",      name: "John Cornyn",        party: "Republican" },
    { id: "r_paxton",      name: "Ken Paxton",          party: "Republican" },
    { id: "r_hunt",        name: "Wesley Hunt",         party: "Republican" },
    { id: "r_canady",      name: "Sara Canady",         party: "Republican" },
    { id: "r_bierschwale", name: "Virgil Bierschwale",  party: "Republican" },
    { id: "r_khan",        name: "Gulrez Khan",         party: "Republican" },
    { id: "r_bender",      name: "Anna Bender",         party: "Republican" },
    { id: "r_adefope",     name: "John Adefope",        party: "Republican" },
  ],
  Democrat: [
    { id: "d_crockett",    name: "Jasmine Crockett",    party: "Democrat" },
    { id: "d_talarico",    name: "James Talarico",      party: "Democrat" },
    { id: "d_hassan",      name: "Ahmad Hassan",        party: "Democrat" },
  ],
};

// Attorney Review — update status as review progresses
const ATTORNEY_REVIEW = {
  status: "pending", // "pending" | "under_review" | "published"
  attorneyName: "", barNumber: "", firm: "", reviewDate: "", opinion: "",
  contactEmail: "txgrassrootspoll@proton.me",
  repoUrl: "https://github.com/[your-repo-here]",
};

const TIERS = {
  COLLECTING:  { min: 0,    max: 49,  label: "Collecting Data",  show: false },
  EARLY:       { min: 50,   max: 199, label: "Early Signal",     show: true  },
  LIMITED:     { min: 200,  max: 499, label: "Limited Signal",   show: true  },
  ACTIVE:      { min: 500,  max: 999, label: "Active Signal",    show: true  },
  ESTABLISHED: { min: 1000, max: Infinity, label: "Established", show: true  },
};
function getTier(n) {
  for (const [key, t] of Object.entries(TIERS)) {
    if (n >= t.min && n <= t.max) return { key, ...t };
  }
  return { key: "COLLECTING", ...TIERS.COLLECTING };
}

// ─── STORAGE ADAPTER ────────────────────────────────────────────────────────
// Tries window.storage (Claude Artifacts), falls back to localStorage
// For external hosting (Vercel/Netlify): localStorage is primary
const store = {
  async get(key, shared = false) {
    try {
      if (typeof window.storage !== "undefined") {
        const r = await window.storage.get(key, shared);
        return r?.value ?? null;
      }
    } catch {}
    try { return localStorage.getItem(key); } catch {}
    return null;
  },
  async set(key, value, shared = false) {
    let ok = false;
    try {
      if (typeof window.storage !== "undefined") {
        await window.storage.set(key, value, shared);
        ok = true;
      }
    } catch {}
    try { localStorage.setItem(key, String(value)); ok = true; } catch {}
    return ok;
  },
  async del(key, shared = false) {
    try {
      if (typeof window.storage !== "undefined") await window.storage.delete(key, shared);
    } catch {}
    try { localStorage.removeItem(key); } catch {}
  }
};

// ─── CRYPTO UTILITIES ────────────────────────────────────────────────────────
// SHA-256 fingerprint (async) — Phase 3 decision 4
async function computeFingerprint() {
  const saltKey = `${EKEY}:installSalt`;
  let salt = null;
  try { salt = sessionStorage.getItem(saltKey); } catch {}
  if (!salt) {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    salt = [...arr].map(b => b.toString(16).padStart(2, "0")).join("");
    try { sessionStorage.setItem(saltKey, salt); } catch {}
  }
  let canvas = "";
  try {
    const c = document.createElement("canvas");
    c.width = 200; c.height = 50;
    const ctx = c.getContext("2d");
    ctx.font = "14px Arial";
    ctx.fillText("TX26-SIM", 4, 18);
    canvas = c.toDataURL();
  } catch {}
  const parts = [
    navigator.userAgent, screen.width, screen.height, screen.colorDepth,
    new Date().getTimezoneOffset(), navigator.language,
    navigator.hardwareConcurrency || 0, canvas, salt
  ].join("|");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Crypto Fisher-Yates shuffle — session-persistent per phase/party
// Phase 3 decision 2: crypto.getRandomValues + sessionStorage order persistence
function cryptoShuffle(arr, sessionKey) {
  try {
    const cached = sessionStorage.getItem(sessionKey);
    if (cached) {
      const order = JSON.parse(cached);
      if (Array.isArray(order) && order.length === arr.length) {
        return order.map(i => arr[i]);
      }
    }
  } catch {}
  const indices = arr.map((_, i) => i);
  const rands = new Uint32Array(indices.length);
  crypto.getRandomValues(rands);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = rands[i] % (i + 1);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  try { sessionStorage.setItem(sessionKey, JSON.stringify(indices)); } catch {}
  return indices.map(i => arr[i]);
}

// Proof-of-Work — Phase 3 decision 5
// difficulty=14 ≈ 100-400ms on typical mobile
async function solvePoW(prefix, difficulty = 14) {
  const enc = new TextEncoder();
  let nonce = 0;
  while (true) {
    const buf = await crypto.subtle.digest("SHA-256", enc.encode(`${prefix}:${nonce}`));
    const bytes = new Uint8Array(buf);
    let bits = 0;
    for (const b of bytes) {
      if (b === 0) { bits += 8; continue; }
      bits += Math.clz32(b) - 24;
      break;
    }
    if (bits >= difficulty) return nonce;
    nonce++;
    if (nonce % 2000 === 0) await new Promise(r => setTimeout(r, 0));
  }
}

// ─── TEXAS ZIP VALIDATION ────────────────────────────────────────────────────
const TX_SPECIAL = new Set(["73301", "73344"]);
function isTexasZip(z) {
  if (!/^\d{5}$/.test(z)) return false;
  if (TX_SPECIAL.has(z)) return true;
  const n = parseInt(z, 10);
  return (n >= 75000 && n <= 79999) || (n >= 88500 && n <= 88599);
}

// ─── SIMULATION ENGINE ───────────────────────────────────────────────────────
// Phase 3 decision 1: count-based 50%+1 (not pct-based)
function computePrimaryResult(tallies, partyKey) {
  const candidates = CANDIDATES[partyKey] || [];
  const total = candidates.reduce((s, c) => s + (Number(tallies?.[c.id]) || 0), 0);
  if (total === 0) return { status: "no_votes", total, all: [] };
  const all = [...candidates]
    .map(c => { const v = Number(tallies?.[c.id]) || 0; return { ...c, votes: v, pct: (v / total) * 100 }; })
    .sort((a, b) => (b.votes - a.votes) || a.id.localeCompare(b.id));
  // STRICT count-based: must have strictly more than half
  if (all[0].votes >= Math.floor(total / 2) + 1) {
    return { status: "winner", winner: all[0], all, total };
  }
  if (all.length < 2) return { status: "runoff_unavailable", all, total };
  return { status: "runoff", top2: [all[0], all[1]], all, total };
}
function computeRunoffResult(tallies, top2) {
  if (!top2?.length) return { status: "no_votes", total: 0 };
  const total = top2.reduce((s, c) => s + (Number(tallies?.[c.id]) || 0), 0);
  if (total === 0) return { status: "no_votes", total };
  const all = [...top2]
    .map(c => { const v = Number(tallies?.[c.id]) || 0; return { ...c, votes: v, pct: (v / total) * 100 }; })
    .sort((a, b) => (b.votes - a.votes) || a.id.localeCompare(b.id));
  return { status: "winner", winner: all[0], all, total };
}

// ─── EXPORT ──────────────────────────────────────────────────────────────────
function exportData(primaryTallies, runoffTallies, generalTallies, runoffCandidates, generalCandidates, party, anomalies) {
  const ts = new Date().toISOString();
  const totalP = Object.values(primaryTallies).reduce((s, v) => s + v, 0);
  const data = {
    exported: ts,
    election: ELECTION.title,
    electionKey: EKEY,
    party,
    participationTier: getTier(totalP).label,
    totalPrimaryVotes: totalP,
    primary: Object.entries(primaryTallies).map(([id, votes]) => {
      const c = (CANDIDATES[party] || []).find(x => x.id === id);
      return { id, name: c?.name || id, votes, pct: totalP > 0 ? +((votes / totalP) * 100).toFixed(2) : null };
    }),
    runoff: runoffCandidates.length ? Object.entries(runoffTallies).map(([id, votes]) => {
      const c = runoffCandidates.find(x => x.id === id);
      const tot = Object.values(runoffTallies).reduce((s, v) => s + v, 0);
      return { id, name: c?.name || id, votes, pct: tot > 0 ? +((votes / tot) * 100).toFixed(2) : null };
    }) : [],
    general: generalCandidates.length ? Object.entries(generalTallies).map(([id, votes]) => {
      const c = generalCandidates.find(x => x.id === id);
      const tot = Object.values(generalTallies).reduce((s, v) => s + v, 0);
      return { id, name: c?.name || id, votes, pct: tot > 0 ? +((votes / tot) * 100).toFixed(2) : null };
    }) : [],
    anomalyFlags: anomalies,
    methodology: "Opt-in, non-probability, self-selected straw poll. Results are unweighted raw vote counts. Not predictive of election outcomes. Participants self-assert Texas residency via ZIP code entry — residency is not independently verified.",
    aapor: "Non-probability sample. Recruitment: open community link sharing. No margin of error computable. Cite with full n and this methodology statement.",
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${EKEY}-export-${ts.slice(0, 10)}.json`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 500);
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Oswald:wght@300;400;600;700&family=Lora:ital,wght@0,400;0,600;1,400&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0d1117;--bg2:#161b24;--bg3:#1e2433;--panel:#242b3a;
  --border:#2e3a50;--border2:#3d4d68;
  --amber:#d4901a;--amber-dim:#7a5010;--amber-glow:#ffb83040;--amber-lt:#2a1f0a;
  --red:#c0392b;--red-lt:#2a0f0f;--green:#1d7a4a;--green-lt:#0d2018;
  --blue:#1a4a8a;--teal:#1a5c5a;
  /* Phase 3: bumped from #6b7a94 to pass WCAG 4.5:1 on dark bg */
  --text:#dde4f0;--muted:#a0b0c0;--dim:#4a5a70;
  --mono:'Share Tech Mono',monospace;
  --display:'Oswald',sans-serif;
  --serif:'Lora',serif;
}
html,body{min-height:100%;background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased;}
body::before{content:'';position:fixed;inset:0;pointer-events:none;
  background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,.05) 2px,rgba(0,0,0,.05) 4px);}

/* Phase 3: focus-visible ring for all interactive elements */
button:focus-visible,a:focus-visible,.tab:focus-visible,.cand-row:focus-visible,
.party-btn:focus-visible,.zip-inp:focus-visible{
  outline:none;box-shadow:0 0 0 3px rgba(255,255,255,.8);}

.machine{max-width:700px;margin:0 auto;padding:0 14px 80px;display:flex;flex-direction:column;align-items:center;}

/* MASTHEAD */
.mast{width:100%;border-bottom:2px double var(--border2);padding:22px 0 12px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:5px;}
.mast-eye{font-family:var(--mono);font-size:9px;letter-spacing:.28em;text-transform:uppercase;color:var(--amber-dim);}
.mast-seal{width:48px;height:48px;border:2px solid var(--amber);border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--display);font-weight:700;font-size:20px;color:var(--amber);box-shadow:0 0 16px var(--amber-glow);}
.mast-title{font-family:var(--display);font-size:clamp(20px,4vw,32px);font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#fff;}
.mast-sub{font-family:var(--mono);font-size:9px;letter-spacing:.13em;color:var(--muted);text-transform:uppercase;}
.mast-dates{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:4px;}
.mast-date{font-family:var(--mono);font-size:8px;letter-spacing:.1em;color:var(--amber-dim);padding:2px 8px;border:1px solid var(--amber-dim);}

/* PERMANENT STICKY DISCLOSURE — Phase 3: position:sticky so it cannot be scrolled away */
.disclosure{width:100%;position:sticky;top:0;z-index:100;background:var(--amber-lt);border:1px solid var(--amber-dim);border-top:none;padding:7px 14px;font-family:var(--mono);font-size:9px;line-height:1.7;color:#8a6020;letter-spacing:.03em;text-align:center;}
.disclosure strong{color:var(--amber);}

/* STORAGE ERROR BANNER */
.storage-error{width:100%;background:var(--red-lt);border:1px solid var(--red);padding:9px 14px;font-family:var(--mono);font-size:10px;color:#d07060;letter-spacing:.05em;text-align:center;display:flex;align-items:center;justify-content:center;gap:8px;}

/* STEP BAR */
.steps{width:100%;background:var(--bg3);border:1px solid var(--border);border-top:none;padding:6px 14px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.step{font-family:var(--mono);font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);display:flex;align-items:center;gap:4px;}
.step.active{color:var(--amber);}.step.done{color:var(--green);}
.step-dot{width:4px;height:4px;border-radius:50%;background:currentColor;}
.step-arr{color:var(--dim);font-size:8px;}

/* SCREEN */
.screen{width:100%;background:var(--bg2);border:1px solid var(--border);border-top:none;padding:24px 22px 28px;position:relative;animation:fadeIn .25s ease;}
@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.screen::before,.screen::after{content:'';position:absolute;width:16px;height:16px;border-color:var(--amber-dim);border-style:solid;}
.screen::before{top:8px;left:8px;border-width:1px 0 0 1px;}
.screen::after{bottom:8px;right:8px;border-width:0 1px 1px 0;}
.slabel{font-family:var(--mono);font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:var(--amber-dim);margin-bottom:14px;display:flex;align-items:center;gap:8px;}
.slabel::after{content:'';flex:1;height:1px;background:var(--border);}
.heading{font-family:var(--display);font-size:clamp(18px,4vw,26px);font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#fff;margin-bottom:7px;line-height:1.15;}
.sub{font-family:var(--serif);font-size:13px;color:var(--muted);line-height:1.7;font-style:italic;margin-bottom:4px;}
.mono-sm{font-family:var(--mono);font-size:9px;color:var(--muted);letter-spacing:.06em;}

/* PARTY BUTTONS — Phase 3: identical visual treatment */
/* Emojis removed. Colors maintained (traditional, not asymmetric in weight). Neutral badge text. */
.party-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:18px;}
@media(max-width:460px){.party-grid{grid-template-columns:1fr;}}
.party-btn{background:var(--bg3);border:1px solid var(--border);border-top:3px solid var(--border2);padding:18px 14px;cursor:pointer;text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px;transition:all .18s;}
.party-btn:hover{background:var(--panel);border-top-color:var(--amber-dim);}
/* Both parties get identical red/blue — traditional, equal visual weight */
.party-btn.rep{border-top-color:#a03030;}
.party-btn.dem{border-top-color:#2a4a90;}
.party-badge{font-family:var(--mono);font-size:18px;font-weight:700;width:40px;height:40px;border:2px solid;border-radius:4px;display:flex;align-items:center;justify-content:center;transition:all .18s;}
.party-btn.rep .party-badge{color:#a03030;border-color:#a03030;}
.party-btn.dem .party-badge{color:#2a4a90;border-color:#2a4a90;}
.party-btn:hover .party-badge{background:var(--border);}
.party-name{font-family:var(--display);font-size:15px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:#fff;}
.party-count{font-family:var(--mono);font-size:9px;color:var(--muted);letter-spacing:.1em;}

/* INPUTS */
.inp-label{font-family:var(--mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--amber);margin-bottom:6px;display:block;}
.zip-inp{width:100%;background:var(--bg3);border:1px solid var(--border);padding:12px 18px;font-family:var(--mono);font-size:28px;letter-spacing:.22em;color:var(--amber);outline:none;caret-color:var(--amber);transition:border-color .2s;}
.zip-inp:focus{border-color:var(--amber-dim);}
.zip-inp.err{border-color:var(--red)!important;color:var(--red);}
.zip-inp.ok{border-color:var(--green)!important;color:var(--green);}
.err-msg{font-family:var(--mono);font-size:10px;color:var(--red);margin-top:4px;letter-spacing:.06em;}
.ok-msg{font-family:var(--mono);font-size:10px;color:var(--green);margin-top:4px;letter-spacing:.06em;}
.dbox{background:var(--bg3);border:1px solid var(--border);border-left:3px solid var(--amber-dim);padding:11px 14px;margin:14px 0;font-family:var(--mono);font-size:10px;line-height:1.8;color:var(--muted);letter-spacing:.03em;}
.dbox strong{color:var(--text);}
.warn-row{display:flex;gap:8px;padding:8px 12px;background:rgba(192,57,43,.07);border:1px solid rgba(192,57,43,.2);margin-bottom:5px;font-family:var(--mono);font-size:9px;color:#c08070;letter-spacing:.04em;line-height:1.6;}

/* BALLOT */
.ballot-hdr{background:var(--bg3);border:1px solid var(--border);padding:8px 12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;}
.ballot-office{font-family:var(--display);font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#fff;}
.ballot-phase{font-family:var(--mono);font-size:9px;padding:2px 7px;border:1px solid var(--amber-dim);color:var(--amber);letter-spacing:.08em;text-transform:uppercase;}
.cand-list{display:flex;flex-direction:column;gap:7px;}
/* Phase 3: min-height 44px for touch targets */
.cand-row{display:flex;align-items:center;gap:12px;background:var(--bg3);border:1px solid var(--border);padding:12px 16px;min-height:44px;cursor:pointer;transition:all .15s;}
.cand-row:hover{border-color:var(--amber-dim);background:var(--panel);}
.cand-row.sel{border-color:var(--amber);background:var(--panel);box-shadow:inset 0 0 0 1px var(--amber-dim);}
.cand-num{font-family:var(--mono);font-size:9px;color:var(--dim);min-width:18px;}
.cand-bubble{width:24px;height:24px;border:2px solid var(--border);border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .15s;}
.cand-row.sel .cand-bubble{border-color:var(--amber);background:var(--amber);}
.cand-dot{width:8px;height:8px;border-radius:50%;background:var(--bg);}
.cand-name{font-family:var(--display);font-size:15px;font-weight:500;letter-spacing:.05em;text-transform:uppercase;color:#fff;}
.tag-rep{font-family:var(--mono);font-size:8px;letter-spacing:.1em;color:#c06050;border:1px solid #702020;padding:1px 6px;flex-shrink:0;}
.tag-dem{font-family:var(--mono);font-size:8px;letter-spacing:.1em;color:#5080c0;border:1px solid #1a3070;padding:1px 6px;flex-shrink:0;}

/* BUTTONS */
.btn{font-family:var(--display);font-size:13px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;border:none;cursor:pointer;padding:13px 22px;transition:all .18s;display:inline-flex;align-items:center;gap:7px;width:100%;justify-content:center;margin-top:18px;}
.btn-primary{background:var(--amber);color:var(--bg);}
.btn-primary:hover:not(:disabled){background:#e8a020;box-shadow:0 0 16px var(--amber-glow);}
.btn-primary:disabled{background:var(--border);color:var(--dim);cursor:not-allowed;}
.btn-ghost{background:transparent;border:1px solid var(--border);color:var(--muted);margin-top:8px;}
.btn-ghost:hover{border-color:var(--muted);color:var(--text);}
.btn-sm{font-family:var(--mono);font-size:9px;letter-spacing:.08em;padding:7px 14px;background:transparent;border:1px solid var(--border);color:var(--muted);cursor:pointer;transition:all .18s;min-height:36px;}
.btn-sm:hover{border-color:var(--amber-dim);color:var(--amber);}
.spin{display:inline-block;width:12px;height:12px;border:2px solid var(--border);border-top-color:var(--amber);border-radius:50%;animation:spin .6s linear infinite;}
@keyframes spin{to{transform:rotate(360deg)}}

/* POW INDICATOR */
.pow-bar{width:100%;height:4px;background:var(--border);margin-top:8px;overflow:hidden;}
.pow-fill{height:100%;background:var(--amber);animation:powPulse 1.2s ease-in-out infinite;}
@keyframes powPulse{0%,100%{width:20%}50%{width:80%}}
.pow-msg{font-family:var(--mono);font-size:9px;color:var(--amber);letter-spacing:.08em;margin-top:5px;text-align:center;}

/* CONFIRM */
.confirm-box{background:var(--bg3);border:2px solid var(--amber-dim);padding:18px;margin:18px 0;text-align:center;}
.confirm-lbl{font-family:var(--mono);font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:var(--amber-dim);margin-bottom:8px;}
.confirm-name{font-family:var(--display);font-size:clamp(20px,4vw,30px);font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#fff;margin-bottom:3px;}
.confirm-party{font-family:var(--mono);font-size:9px;color:var(--muted);letter-spacing:.12em;text-transform:uppercase;}

/* RESULTS */
.voted-badge{background:var(--green-lt);border:1px solid var(--green);padding:8px 14px;margin-bottom:14px;font-family:var(--mono);font-size:9px;color:#50b080;letter-spacing:.08em;text-transform:uppercase;display:flex;align-items:center;gap:7px;}
.result-phase-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;padding-bottom:5px;border-bottom:1px solid var(--border);}
.result-phase-title{font-family:var(--display);font-size:13px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:#fff;}
.status-winner{font-family:var(--mono);font-size:9px;color:var(--green);letter-spacing:.1em;text-transform:uppercase;}
.status-runoff{font-family:var(--mono);font-size:9px;color:var(--amber);letter-spacing:.1em;text-transform:uppercase;}
.result-row{display:flex;align-items:center;gap:10px;background:var(--bg3);border:1px solid var(--border);padding:8px 12px;margin-bottom:5px;position:relative;}
.result-row.leader-row{border-color:var(--amber);background:var(--panel);}
.r-name{font-family:var(--display);font-size:13px;font-weight:500;letter-spacing:.05em;text-transform:uppercase;color:#fff;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.result-bar-wrap{width:80px;height:4px;background:var(--border);overflow:hidden;flex-shrink:0;}
.result-bar{height:100%;transition:width 1s ease;}
.result-pct{font-family:var(--mono);font-size:11px;color:var(--amber);min-width:38px;text-align:right;flex-shrink:0;}
.result-votes{font-family:var(--mono);font-size:8px;color:var(--muted);min-width:30px;text-align:right;flex-shrink:0;}
.your-pick{font-family:var(--mono);font-size:7px;color:var(--amber);border:1px solid var(--amber-dim);padding:1px 4px;letter-spacing:.08em;flex-shrink:0;margin-left:4px;}
.leader-crown{color:var(--amber);margin-right:3px;flex-shrink:0;}

/* Phase 3: watermark for low-n results */
.lowN-watermark{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;opacity:.12;}
.lowN-watermark-text{font-family:var(--display);font-size:11px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--amber);transform:rotate(-12deg);white-space:nowrap;}

/* COLLECTING STATE */
.collecting-wrap{background:var(--bg3);border:1px solid var(--border);padding:20px;text-align:center;margin-bottom:14px;}
.collecting-title{font-family:var(--display);font-size:14px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--amber);margin-bottom:6px;}
.collecting-sub{font-family:var(--serif);font-size:12px;color:var(--muted);font-style:italic;line-height:1.7;margin-bottom:10px;}
.collecting-prog{height:4px;background:var(--border);margin-top:10px;}
.collecting-fill{height:100%;background:var(--amber);transition:width .8s ease;}

/* TIER BANNERS */
.tier-banner{padding:7px 12px;border:1px solid;font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:12px;display:flex;align-items:center;gap:8px;}

/* PHASE FLOW */
.phase-flow{display:flex;align-items:center;margin:16px 0;}
.phase-node{flex:1;background:var(--bg3);border:1px solid var(--border);padding:8px 6px;text-align:center;}
.phase-node.active-phase{border-color:var(--amber);}
.phase-node.done-phase{border-color:var(--green);}
.phase-node.locked{opacity:.35;}
.phase-node-lbl{font-family:var(--mono);font-size:7px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:3px;}
.phase-node-status{font-family:var(--display);font-size:10px;font-weight:600;letter-spacing:.05em;color:#fff;}
.phase-arrow{font-family:var(--mono);font-size:9px;color:var(--dim);padding:0 3px;flex-shrink:0;}

/* RUNOFF NOTICE */
.runoff-notice{background:rgba(181,131,26,.07);border:1px solid var(--amber-dim);padding:14px;margin:14px 0;text-align:center;}
.runoff-notice-title{font-family:var(--display);font-size:17px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--amber);margin-bottom:4px;}
.runoff-notice-sub{font-family:var(--mono);font-size:9px;color:var(--muted);letter-spacing:.07em;line-height:1.6;}

/* ANOMALY */
.anomaly-item{display:flex;gap:8px;padding:7px 11px;background:var(--red-lt);border-left:3px solid var(--red);margin-bottom:5px;font-family:var(--mono);font-size:9px;color:#b07060;letter-spacing:.04em;line-height:1.6;}

/* DASHBOARD */
.dash-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0;}
@media(max-width:480px){.dash-grid{grid-template-columns:1fr 1fr;}}
.dash-card{background:var(--bg3);border:1px solid var(--border);padding:9px 11px;}
.dash-card-lbl{font-family:var(--mono);font-size:7px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:3px;}
.dash-card-val{font-family:var(--display);font-size:20px;font-weight:600;color:var(--amber);}

/* TABS */
.tabs{display:flex;border-bottom:1px solid var(--border);margin-bottom:14px;}
.tab{font-family:var(--mono);font-size:9px;letter-spacing:.09em;text-transform:uppercase;padding:7px 12px;cursor:pointer;color:var(--muted);border-bottom:2px solid transparent;background:none;border-top:none;border-left:none;border-right:none;transition:all .18s;min-height:36px;}
.tab.active{color:var(--amber);border-bottom-color:var(--amber);}

/* ABOUT */
.about-hdr{font-family:var(--mono);font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--amber);margin-bottom:10px;display:flex;align-items:center;gap:7px;}
.about-hdr::after{content:'';flex:1;height:1px;background:var(--border);}
.about-body{font-family:var(--serif);font-size:13px;color:var(--muted);line-height:1.8;margin-bottom:14px;}
.principle-row{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);}
.principle-num{font-family:var(--display);font-size:13px;font-weight:700;color:var(--amber);min-width:18px;}
.principle-text{font-family:var(--serif);font-size:12px;color:var(--muted);line-height:1.7;}

/* ATTORNEY PANEL */
.attorney-panel{background:var(--bg3);border:1px solid var(--border);margin-top:14px;}
.attorney-hdr{border-bottom:1px solid var(--border);padding:9px 14px;display:flex;justify-content:space-between;align-items:center;}
.attorney-badge{font-family:var(--mono);font-size:8px;letter-spacing:.12em;text-transform:uppercase;padding:2px 7px;border:1px solid;}
.badge-pending{color:#b5831a;border-color:#7a5010;background:rgba(181,131,26,.08);}
.badge-review{color:#1a7a9a;border-color:#1a4a6a;}
.badge-published{color:var(--green);border-color:var(--teal);}
.attorney-body{padding:14px;}
.attorney-invite{font-family:var(--serif);font-size:13px;color:var(--muted);line-height:1.8;margin-bottom:12px;}
.attorney-opinion{font-family:var(--serif);font-size:13px;color:var(--text);line-height:1.9;border-left:3px solid var(--teal);padding-left:14px;margin:10px 0;}
.attorney-sig{font-family:var(--mono);font-size:9px;color:var(--muted);letter-spacing:.07em;margin-top:8px;}
.attorney-cta{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;}

/* SOURCE NOTE */
.source-note{background:var(--bg3);border:1px solid var(--border);border-left:3px solid var(--teal);padding:8px 12px;margin:12px 0;font-family:var(--mono);font-size:8px;color:var(--muted);letter-spacing:.05em;line-height:1.7;}
.source-note strong{color:var(--amber);}
`;

// ─── STEP BAR ─────────────────────────────────────────────────────────────────
function StepBar({ current, hasRunoff }) {
  const steps = ["Verify", "Party", "Primary", ...(hasRunoff ? ["Runoff"] : []), "General", "Results"];
  return (
    <div className="steps">
      {steps.map((s, i) => (
        <span key={s} style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span className={`step ${i < current ? "done" : i === current ? "active" : ""}`}>
            <span className="step-dot" />{s}
          </span>
          {i < steps.length - 1 && <span className="step-arr">▶</span>}
        </span>
      ))}
    </div>
  );
}

// ─── RESULTS BLOCK ────────────────────────────────────────────────────────────
function ResultsBlock({ title, phaseStatus, candidates, tallies, total, myVote }) {
  const tier = getTier(total);
  if (!tier.show) {
    return (
      <div className="collecting-wrap">
        <div className="collecting-title">{title} · Collecting Data</div>
        <div className="collecting-sub">Fewer than 50 votes recorded. Results are suppressed until minimum sample is reached — prevents misleading conclusions from very small numbers.</div>
        <div className="mono-sm">{total} of 50 minimum votes</div>
        <div className="collecting-prog">
          <div className="collecting-fill" style={{ width: `${Math.min(100, (total / 50) * 100)}%` }} />
        </div>
      </div>
    );
  }
  const sorted = [...candidates]
    .map(c => ({ ...c, votes: Number(tallies?.[c.id]) || 0, pct: total > 0 ? ((Number(tallies?.[c.id]) || 0) / total * 100) : 0 }))
    .sort((a, b) => (b.votes - a.votes) || a.id.localeCompare(b.id));
  const isLeader = (i) => phaseStatus === "winner" && i === 0;

  return (
    <div style={{ marginBottom: 18 }}>
      <div className="result-phase-hdr">
        <div className="result-phase-title">{title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Phase 3: "CURRENT LEADER" language, not "NOMINEE" — avoids forecasting language at low n */}
          <span className={phaseStatus === "winner" ? "status-winner" : "status-runoff"}>
            {phaseStatus === "winner"
              ? total < 200 ? "⚠ EARLY LEADER" : "★ CURRENT LEADER"
              : phaseStatus === "runoff" ? "↪ RUNOFF TRIGGERED" : "LIVE"}
          </span>
          <span className="mono-sm">{total}v · {tier.label}</span>
        </div>
      </div>
      {tier.key === "EARLY" && (
        <div className="tier-banner" style={{ borderColor:"var(--red)",color:"#c07060",background:"var(--red-lt)" }}>
          ⚠ EARLY SIGNAL — Very low participation. Results highly volatile. Do not generalize.
        </div>
      )}
      {tier.key === "LIMITED" && (
        <div className="tier-banner" style={{ borderColor:"var(--amber-dim)",color:"var(--amber)",background:"var(--amber-lt)" }}>
          ◐ LIMITED SIGNAL — Results may shift significantly as more votes are recorded.
        </div>
      )}
      {sorted.map((c, i) => {
        const isYours = myVote === c.id;
        const leader = isLeader(i);
        return (
          <div key={c.id} className={`result-row ${leader ? "leader-row" : ""}`}>
            {/* Phase 3: watermark overlay for low-n */}
            {tier.key === "EARLY" && (
              <div className="lowN-watermark">
                <div className="lowN-watermark-text">UNOFFICIAL · LOW SAMPLE · {total}v</div>
              </div>
            )}
            {leader && <span className="leader-crown">★</span>}
            <div className="r-name" title={c.name}>
              {c.name}{isYours && <span className="your-pick">YOUR PICK</span>}
            </div>
            <div className="result-bar-wrap">
              <div className="result-bar" style={{ width:`${c.pct}%`, background:leader?"var(--amber)":"var(--amber-dim)" }} />
            </div>
            <div className="result-pct">{c.pct.toFixed(1)}%</div>
            <div className="result-votes">{c.votes}v</div>
          </div>
        );
      })}
      {phaseStatus === "runoff" && (
        <div className="mono-sm" style={{ marginTop:6,color:"var(--amber)" }}>
          ↪ No candidate cleared 50%+1 threshold · Top two advance · Per Texas primary law
        </div>
      )}
    </div>
  );
}

// ─── ATTORNEY PANEL ───────────────────────────────────────────────────────────
function AttorneyPanel({ review }) {
  const bc = review.status==="published"?"badge-published":review.status==="under_review"?"badge-review":"badge-pending";
  const bl = review.status==="published"?"✓ Opinion Published":review.status==="under_review"?"◐ Under Review":"○ Pending — Open Invitation";
  return (
    <div className="attorney-panel">
      <div className="attorney-hdr">
        {/* Phase 3: header clarified to "not legal advice" per ChatGPT recommendation */}
        <div style={{fontFamily:"var(--display)",fontSize:13,fontWeight:600,letterSpacing:".07em",textTransform:"uppercase",color:"#fff"}}>
          Attorney Review Status <span style={{fontFamily:"var(--mono)",fontSize:8,color:"var(--muted)",fontWeight:400,textTransform:"none"}}>(Not Legal Advice)</span>
        </div>
        <span className={`attorney-badge ${bc}`}>{bl}</span>
      </div>
      <div className="attorney-body">
        {review.status === "pending" && (
          <>
            <div className="attorney-invite">
              This tool has not yet received formal review from a Texas-licensed election law practitioner. We actively invite that scrutiny — not as a formality, but because public accountability is a core design value. Any opinion published here is the independent view of the reviewing attorney and does not constitute official state approval or legal advice to users.
            </div>
            <div className="attorney-invite">
              If you are a Texas-licensed attorney with election law experience and are willing to review this tool's methodology, disclaimers, and source code, we welcome your engagement. Your name, bar number, and written opinion will be published here permanently and unconditionally — whether favorable or critical.
            </div>
            <div className="attorney-cta">
              <a href={`mailto:${review.contactEmail}?subject=Texas Election Law Review — Grassroots Poll Tool`}
                style={{fontFamily:"var(--mono)",fontSize:9,color:"var(--amber)",letterSpacing:".09em",textDecoration:"none",border:"1px solid var(--amber-dim)",padding:"6px 12px",textTransform:"uppercase"}}>
                ✉ Contact to Review
              </a>
              <a href={review.repoUrl} target="_blank" rel="noopener noreferrer"
                style={{fontFamily:"var(--mono)",fontSize:9,color:"var(--muted)",letterSpacing:".09em",textDecoration:"none",border:"1px solid var(--border)",padding:"6px 12px",textTransform:"uppercase"}}>
                ⌂ View Source Code
              </a>
            </div>
          </>
        )}
        {review.status === "under_review" && (
          <div className="attorney-invite">Under review by a Texas-licensed practitioner. Opinion will be published here in full upon completion. Review began: {review.reviewDate}.</div>
        )}
        {review.status === "published" && (
          <>
            <div className="attorney-opinion">"{review.opinion}"</div>
            <div className="attorney-sig">— {review.attorneyName} · State Bar of Texas #{review.barNumber}<br />{review.firm} · {review.reviewDate}</div>
            <p style={{fontFamily:"var(--mono)",fontSize:8,color:"var(--muted)",marginTop:8,letterSpacing:".03em"}}>This opinion is the independent professional view of the named attorney. It does not constitute official state approval or legal advice.</p>
          </>
        )}
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [step, setStep] = useState(0);
  const [zip, setZip] = useState("");
  const [zipState, setZipState] = useState("idle");
  const [zipErr, setZipErr] = useState("");
  const [party, setParty] = useState(null);
  const [shuffledPrimary, setShPrimary] = useState([]);
  const [shuffledRunoff, setShRunoff] = useState([]);
  const [shuffledGeneral, setShGeneral] = useState([]);
  const [selPrimary, setSelPrimary] = useState(null);
  const [selRunoff, setSelRunoff] = useState(null);
  const [selGeneral, setSelGeneral] = useState(null);
  const [powSolving, setPowSolving] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [activeTab, setActiveTab] = useState("results");
  const [primaryTallies, setPrimaryTallies] = useState({});
  const [runoffTallies, setRunoffTallies] = useState({});
  const [generalTallies, setGeneralTallies] = useState({});
  const [primaryResult, setPrimaryResult] = useState(null);
  const [runoffResult, setRunoffResult] = useState(null);
  const [runoffCandidates, setRunoffCandidates] = useState([]);
  const [generalCandidates, setGeneralCandidates] = useState([]);
  const [myPrimaryVote, setMyPrimaryVote] = useState(null);
  const [myRunoffVote, setMyRunoffVote] = useState(null);
  const [myGeneralVote, setMyGeneralVote] = useState(null);
  const [hasVotedPrimary, setHasVotedPrimary] = useState(false);
  const [hasVotedRunoff, setHasVotedRunoff] = useState(false);
  const [hasVotedGeneral, setHasVotedGeneral] = useState(false);
  const [anomalies, setAnomalies] = useState([]);
  const fpRef = useRef("");

  // Compute async SHA-256 fingerprint on mount
  useEffect(() => {
    computeFingerprint().then(fp => { fpRef.current = fp; });
  }, []);

  const loadTallies = useCallback(async (partyKey) => {
    const pTallies = {};
    for (const c of (CANDIDATES[partyKey] || [])) {
      const v = await store.get(`${EKEY}:primary:${c.id}`, true);
      pTallies[c.id] = v !== null ? parseInt(v, 10) : 0;
    }
    setPrimaryTallies(pTallies);
    const pResult = computePrimaryResult(pTallies, partyKey);
    setPrimaryResult(pResult);
    const rCands = pResult.top2 || [];
    setRunoffCandidates(rCands);
    const rTallies = {};
    for (const c of rCands) {
      const v = await store.get(`${EKEY}:runoff:${c.id}`, true);
      rTallies[c.id] = v !== null ? parseInt(v, 10) : 0;
    }
    setRunoffTallies(rTallies);
    if (rCands.length === 2) setRunoffResult(computeRunoffResult(rTallies, rCands));
    const gTallies = {};
    for (const side of ["rep","dem"]) {
      const v = await store.get(`${EKEY}:general:${side}`, true);
      gTallies[side] = v !== null ? parseInt(v, 10) : 0;
    }
    setGeneralTallies(gTallies);
    // Velocity anomaly detection — load timestamps
    const velocityRaw = await store.get(`${EKEY}:velocity:${partyKey}`, true);
    const velocityLog = velocityRaw ? JSON.parse(velocityRaw) : [];
    const total = Object.values(pTallies).reduce((s, v) => s + v, 0);
    const flags = [];
    if (total > 50) {
      const max = Math.max(...Object.values(pTallies));
      if (max / total > 0.95) flags.push(`Extreme concentration: one candidate holds >${Math.round(max/total*100)}% of all votes. May reflect coordinated activity.`);
      // Check velocity: votes per 10-min windows
      if (velocityLog.length > 10) {
        const now = Date.now();
        const last10min = velocityLog.filter(t => now - t < 600000).length;
        const prev10min = velocityLog.filter(t => (now-t)>=600000 && (now-t)<1200000).length;
        if (prev10min > 0 && last10min > prev10min * 5 && last10min > 15) {
          flags.push(`Velocity spike: ${last10min} votes in last 10 minutes vs ${prev10min} in prior 10 minutes.`);
        }
      }
    }
    setAnomalies(flags);
  }, []);

  // Restore session on mount
  useEffect(() => {
    (async () => {
      const rec = await store.get(`${EKEY}:session`);
      if (rec) {
        try {
          const v = JSON.parse(rec);
          setParty(v.party);
          if (v.hasVotedPrimary) { setHasVotedPrimary(true); setMyPrimaryVote(v.primaryVote); }
          if (v.hasVotedRunoff) { setHasVotedRunoff(true); setMyRunoffVote(v.runoffVote); }
          if (v.hasVotedGeneral) { setHasVotedGeneral(true); setMyGeneralVote(v.generalVote); }
          if (v.generalCandidates) setGeneralCandidates(v.generalCandidates);
          await loadTallies(v.party);
          setStep(5);
        } catch {}
      }
    })();
  }, []);

  const hasRunoff = primaryResult?.status === "runoff";
  const totalPrimary = Object.values(primaryTallies).reduce((s, v) => s + v, 0);
  const totalRunoff = Object.values(runoffTallies).reduce((s, v) => s + v, 0);
  const totalGeneral = (generalTallies["rep"] || 0) + (generalTallies["dem"] || 0);

  const verifyZip = () => {
    const z = zip.trim();
    if (!/^\d{5}$/.test(z)) { setZipState("err"); setZipErr("INVALID FORMAT — ENTER 5 DIGITS"); return; }
    if (!isTexasZip(z)) { setZipState("err"); setZipErr("NOT A TEXAS ZIP — THIS POLL IS FOR TEXAS RESIDENTS"); return; }
    setZipState("ok");
    setTimeout(() => setStep(1), 380);
  };

  const selectParty = (p) => {
    setParty(p);
    // Crypto shuffle with session persistence per phase 3 decision 2
    setShPrimary(cryptoShuffle(CANDIDATES[p], `${EKEY}:order:primary:${p}`));
    loadTallies(p);
    setStep(2);
  };

  // PoW + fingerprint lock before each vote submission
  const runPoWAndLock = async (phase, candidateId) => {
    setPowSolving(true);
    try {
      // Check fingerprint lock
      if (fpRef.current) {
        const lockKey = `${EKEY}:lock:${phase}:${fpRef.current.slice(0, 16)}`;
        const locked = await store.get(lockKey);
        if (locked) {
          setStorageError(true);
          return false; // already voted on this device
        }
      }
      // Solve PoW
      const nonce = await solvePoW(`${EKEY}:${phase}:${candidateId}`, 14);
      // Write fingerprint lock (both shared and local for redundancy)
      if (fpRef.current) {
        const lockKey = `${EKEY}:lock:${phase}:${fpRef.current.slice(0, 16)}`;
        await store.set(lockKey, nonce.toString(), true);
        await store.set(lockKey, nonce.toString(), false);
      }
      return nonce;
    } finally {
      setPowSolving(false);
    }
  };

  const recordVelocityTimestamp = async (partyKey) => {
    const key = `${EKEY}:velocity:${partyKey}`;
    const raw = await store.get(key, true);
    const log = raw ? JSON.parse(raw) : [];
    const now = Date.now();
    const trimmed = [...log, now].filter(t => now - t < 7200000); // keep 2hr window
    await store.set(key, JSON.stringify(trimmed), true);
  };

  const submitPrimary = async () => {
    if (!selPrimary) return;
    const nonce = await runPoWAndLock("primary", selPrimary.id);
    if (nonce === false) return;
    const cur = await store.get(`${EKEY}:primary:${selPrimary.id}`, true);
    const n = (cur !== null ? parseInt(cur, 10) : 0) + 1;
    const ok = await store.set(`${EKEY}:primary:${selPrimary.id}`, String(n), true);
    if (!ok) { setStorageError(true); return; }
    await recordVelocityTimestamp(party);
    const newTallies = { ...primaryTallies, [selPrimary.id]: n };
    const newResult = computePrimaryResult(newTallies, party);
    setPrimaryTallies(newTallies);
    setPrimaryResult(newResult);
    setHasVotedPrimary(true);
    setMyPrimaryVote(selPrimary.id);
    if (newResult.status === "runoff") {
      const top2 = newResult.top2;
      setRunoffCandidates(top2);
      setShRunoff(cryptoShuffle(top2, `${EKEY}:order:runoff`));
      await store.set(`${EKEY}:session`, JSON.stringify({ party, hasVotedPrimary:true, primaryVote:selPrimary.id }));
      setStep(3);
    } else {
      const gCands = cryptoShuffle([
        { id:"rep", name:selPrimary.name, party:"Republican" },
        { id:"dem", name:"Democratic Nominee", party:"Democrat" },
      ], `${EKEY}:order:general`);
      setGeneralCandidates(gCands);
      await store.set(`${EKEY}:session`, JSON.stringify({ party, hasVotedPrimary:true, primaryVote:selPrimary.id, generalCandidates:gCands }));
      setStep(4);
    }
  };

  const submitRunoff = async () => {
    if (!selRunoff) return;
    const nonce = await runPoWAndLock("runoff", selRunoff.id);
    if (nonce === false) return;
    const cur = await store.get(`${EKEY}:runoff:${selRunoff.id}`, true);
    const n = (cur !== null ? parseInt(cur, 10) : 0) + 1;
    const ok = await store.set(`${EKEY}:runoff:${selRunoff.id}`, String(n), true);
    if (!ok) { setStorageError(true); return; }
    setHasVotedRunoff(true);
    setMyRunoffVote(selRunoff.id);
    const gCands = cryptoShuffle([
      { id:"rep", name:party==="Republican"?selRunoff.name:"Republican Nominee", party:"Republican" },
      { id:"dem", name:party==="Democrat"?selRunoff.name:"Democratic Nominee", party:"Democrat" },
    ], `${EKEY}:order:general`);
    setGeneralCandidates(gCands);
    await store.set(`${EKEY}:session`, JSON.stringify({ party, hasVotedPrimary:true, primaryVote:myPrimaryVote, hasVotedRunoff:true, runoffVote:selRunoff.id, generalCandidates:gCands }));
    setStep(4);
  };

  const submitGeneral = async () => {
    if (!selGeneral) return;
    const nonce = await runPoWAndLock("general", selGeneral.id);
    if (nonce === false) return;
    const cur = await store.get(`${EKEY}:general:${selGeneral.id}`, true);
    const n = (cur !== null ? parseInt(cur, 10) : 0) + 1;
    const ok = await store.set(`${EKEY}:general:${selGeneral.id}`, String(n), true);
    if (!ok) { setStorageError(true); return; }
    setHasVotedGeneral(true);
    setMyGeneralVote(selGeneral.id);
    await store.set(`${EKEY}:session`, JSON.stringify({ party, hasVotedPrimary:true, primaryVote:myPrimaryVote, hasVotedRunoff, runoffVote:myRunoffVote, hasVotedGeneral:true, generalVote:selGeneral.id, generalCandidates }));
    await loadTallies(party);
    setStep(5);
  };

  const stepIdx = (() => {
    if (step === 0) return 0; if (step === 1) return 1;
    if (step === 2 || step === 2.5) return 2;
    if (!hasRunoff) {
      if (step === 3) return 3; if (step === 4) return 3; if (step === 5) return 4;
    }
    return step;
  })();

  return (
    <>
      <style>{CSS}</style>
      <div className="machine">
        {/* MASTHEAD */}
        <div className="mast">
          <div className="mast-eye">★ Lone Star Civic Technology Project ★</div>
          <div className="mast-seal">TX</div>
          <div className="mast-title">{ELECTION.title}</div>
          <div className="mast-sub">{ELECTION.cycle} · {ELECTION.tagline}</div>
          <div className="mast-dates">
            <span className="mast-date">Primary: {ELECTION.primaryDate}</span>
            <span className="mast-date">Runoff: {ELECTION.runoffDate}</span>
            <span className="mast-date">General: {ELECTION.generalDate}</span>
          </div>
        </div>

        {/* PERMANENT STICKY DISCLOSURE — Principle VI */}
        <div className="disclosure">
          <strong>NON-PARTISAN DISCLOSURE:</strong> Unofficial, non-scientific opt-in straw poll. Not affiliated with any party, campaign, PAC, or government agency. Participants recruited by open community link sharing; eligibility self-asserted via ZIP entry — not independently verified. Results are unweighted and do not represent all Texas voters and do not predict election outcomes. One entry per device per phase.
        </div>

        {/* STORAGE ERROR BANNER */}
        {storageError && (
          <div className="storage-error">
            ⚠ STORAGE ERROR — Your vote may not have been recorded. Please refresh and try again, or your device may have already participated in this phase.
          </div>
        )}

        <StepBar current={stepIdx} hasRunoff={hasRunoff} />

        {/* ═══ ZIP VERIFY ═══ */}
        {step === 0 && (
          <div className="screen">
            <div className="slabel">Step 01 — Texas Residency</div>
            <div className="heading">Verify Texas ZIP Code</div>
            <div className="sub">Open to Texas residents. One entry per device per election phase — mirroring Texas primary law.</div>
            <div className="dbox"><strong>PRIVACY:</strong> Your ZIP is used only to verify Texas residency. It is never stored in any form after entry.</div>
            <div style={{ marginTop:18 }}>
              <label className="inp-label" htmlFor="zipinp">Enter 5-Digit Texas ZIP Code</label>
              <input id="zipinp" className={`zip-inp ${zipState==="err"?"err":zipState==="ok"?"ok":""}`}
                type="text" inputMode="numeric" maxLength={5} placeholder="7 _ _ _ _" value={zip}
                onChange={e=>{ setZip(e.target.value.replace(/\D/g,"").slice(0,5)); setZipState("idle"); setZipErr(""); }}
                onKeyDown={e=>e.key==="Enter"&&verifyZip()} autoFocus aria-describedby="ziperr" />
              {zipErr && <div id="ziperr" className="err-msg" role="alert">▲ {zipErr}</div>}
              {zipState==="ok" && <div className="ok-msg">✓ VALID TEXAS ZIP — PROCEEDING</div>}
            </div>
            <div className="warn-row">⚠ Entering a non-Texas ZIP is automatically detected. Providing false information undermines the integrity of this community tool.</div>
            <button className="btn btn-primary" onClick={verifyZip} disabled={zip.length!==5}>Verify & Continue ▶</button>
          </div>
        )}

        {/* ═══ PARTY SELECT ═══ */}
        {step === 1 && (
          <div className="screen">
            <div className="slabel">Step 02 — Primary Selection</div>
            <div className="heading">Choose Your Primary</div>
            <div className="sub">Texas is an open-primary state. Any registered voter may participate in either party's primary. This selection does not indicate party registration.</div>
            {/* Phase 3: identical buttons, no emojis, neutral text badges (R) and (D) */}
            <div className="party-grid" role="radiogroup" aria-label="Select primary party">
              {([["Republican","R","rep"],["Democrat","D","dem"]]).map(([name,badge,cls])=>(
                <button key={name} className={`party-btn ${cls}`} onClick={()=>selectParty(name)} role="radio" aria-checked="false">
                  <div className="party-badge">{badge}</div>
                  <div className="party-name">{name}</div>
                  <div className="party-count">{CANDIDATES[name].length} candidates on ballot</div>
                </button>
              ))}
            </div>
            <div style={{ marginTop:14 }} className="mono-sm">Texas law permits participation in only one party's primary per election cycle.</div>
            <button className="btn btn-ghost" onClick={()=>setStep(0)}>◀ Back</button>
          </div>
        )}

        {/* ═══ PRIMARY BALLOT ═══ */}
        {step === 2 && (
          <div className="screen">
            <div className="slabel">Step 03 — Primary Ballot</div>
            <div style={{ display:"flex",gap:8,alignItems:"center",marginBottom:12 }}>
              <div className="heading" style={{ marginBottom:0 }}>Primary Ballot</div>
              <span className="ballot-phase">{party}</span>
            </div>
            <div className="source-note">
              <strong>CANDIDATE SOURCE:</strong> All candidates as officially filed with the Texas Secretary of State for the March 3, 2026 U.S. Senate Primary. Names shown exactly as filed. No endorsement implied. <strong>ORDER RANDOMIZED</strong> each session — cryptographic shuffle, session-persistent.
            </div>
            <div className="ballot-hdr">
              <div className="ballot-office">{ELECTION.title} · {party} Primary</div>
              <div className="mono-sm">Select one · 50%+1 threshold</div>
            </div>
            {/* Phase 3: radiogroup role, min-height 44px touch targets */}
            <div className="cand-list" role="radiogroup" aria-label={`${party} Primary Candidates`}>
              {shuffledPrimary.map((c, i) => (
                <div key={c.id} className={`cand-row ${selPrimary?.id===c.id?"sel":""}`}
                  onClick={()=>setSelPrimary(c)} role="radio" aria-checked={selPrimary?.id===c.id}
                  tabIndex={0} onKeyDown={e=>(e.key==="Enter"||e.key===" ")&&setSelPrimary(c)}>
                  <div className="cand-num">{String(i+1).padStart(2,"0")}</div>
                  <div className="cand-bubble">{selPrimary?.id===c.id&&<div className="cand-dot"/>}</div>
                  <div className="cand-name">{c.name}</div>
                  {/* Phase 3: name only — no title rendered per Principle I */}
                  <span className={party==="Republican"?"tag-rep":"tag-dem"}>{party==="Republican"?"REP":"DEM"}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop:10 }} className="mono-sm">Candidate order randomized using crypto.getRandomValues · Fisher-Yates · Session-persistent · {shuffledPrimary.length} candidates</div>
            <button className="btn btn-primary" disabled={!selPrimary} onClick={()=>setStep(2.5)}>Review Selection ▶</button>
            <button className="btn btn-ghost" onClick={()=>setStep(1)}>◀ Back</button>
          </div>
        )}

        {/* ═══ CONFIRM PRIMARY ═══ */}
        {step === 2.5 && selPrimary && (
          <div className="screen">
            <div className="slabel">Step 03b — Confirm</div>
            <div className="heading">Review Before Submitting</div>
            <div className="confirm-box">
              <div className="confirm-lbl">Your Primary Preference</div>
              <div className="confirm-name">{selPrimary.name}</div>
              <div className="confirm-party">{party} Primary · {ELECTION.title}</div>
            </div>
            <div className="warn-row">⚠ This action is final. Your primary preference cannot be changed once submitted.</div>
            {powSolving && (
              <>
                <div className="pow-msg">Generating vote token — security verification in progress…</div>
                <div className="pow-bar"><div className="pow-fill"/></div>
              </>
            )}
            <button className="btn btn-primary" onClick={submitPrimary} disabled={powSolving}>
              {powSolving ? <><span className="spin"/>Verifying…</> : <>Submit Primary Vote ★</>}
            </button>
            <button className="btn btn-ghost" onClick={()=>setStep(2)} disabled={powSolving}>◀ Change Selection</button>
          </div>
        )}

        {/* ═══ RUNOFF ═══ */}
        {step === 3 && (
          <div className="screen">
            <div className="slabel">Step 04 — Runoff</div>
            <div className="runoff-notice">
              <div className="runoff-notice-title">↪ Runoff Triggered</div>
              <div className="runoff-notice-sub">No candidate cleared 50%+1 · Top two advance · Mirrors Texas Election Code · Actual runoff: {ELECTION.runoffDate}</div>
            </div>
            <div className="heading">Runoff Ballot</div>
            <div className="ballot-hdr">
              <div className="ballot-office">{ELECTION.title} · {party} Runoff</div>
              <div className="mono-sm">Head-to-head · Majority wins</div>
            </div>
            <div className="cand-list" role="radiogroup" aria-label="Runoff candidates">
              {(shuffledRunoff.length ? shuffledRunoff : runoffCandidates).map((c, i) => (
                <div key={c.id} className={`cand-row ${selRunoff?.id===c.id?"sel":""}`}
                  onClick={()=>setSelRunoff(c)} role="radio" aria-checked={selRunoff?.id===c.id}
                  tabIndex={0} onKeyDown={e=>(e.key==="Enter"||e.key===" ")&&setSelRunoff(c)}>
                  <div className="cand-num">{String(i+1).padStart(2,"0")}</div>
                  <div className="cand-bubble">{selRunoff?.id===c.id&&<div className="cand-dot"/>}</div>
                  <div className="cand-name">{c.name}</div>
                  <span className={party==="Republican"?"tag-rep":"tag-dem"}>{party==="Republican"?"REP":"DEM"}</span>
                </div>
              ))}
            </div>
            {powSolving && (
              <>
                <div className="pow-msg">Generating vote token…</div>
                <div className="pow-bar"><div className="pow-fill"/></div>
              </>
            )}
            <button className="btn btn-primary" disabled={!selRunoff||powSolving} onClick={submitRunoff}>
              {powSolving?<><span className="spin"/>Verifying…</>:<>Submit Runoff Vote ▶</>}
            </button>
          </div>
        )}

        {/* ═══ GENERAL BALLOT ═══ */}
        {step === 4 && (
          <div className="screen">
            <div className="slabel">Step 05 — General Election</div>
            <div className="heading">General Election Simulation</div>
            <div className="sub">Both nominees have emerged from their primaries. The general election phase is open to all Texas voters regardless of which primary you participated in.</div>
            <div style={{ height:10 }} />
            <div className="ballot-hdr">
              <div className="ballot-office">{ELECTION.title} · General Election</div>
              <div className="mono-sm">Plurality wins · {ELECTION.generalDate}</div>
            </div>
            <div className="cand-list" role="radiogroup" aria-label="General election candidates">
              {generalCandidates.map((c, i) => (
                <div key={c.id} className={`cand-row ${selGeneral?.id===c.id?"sel":""}`}
                  onClick={()=>setSelGeneral(c)} role="radio" aria-checked={selGeneral?.id===c.id}
                  tabIndex={0} onKeyDown={e=>(e.key==="Enter"||e.key===" ")&&setSelGeneral(c)}>
                  <div className="cand-num">{String(i+1).padStart(2,"0")}</div>
                  <div className="cand-bubble">{selGeneral?.id===c.id&&<div className="cand-dot"/>}</div>
                  <div className="cand-name">{c.name}</div>
                  <span className={c.party==="Republican"?"tag-rep":"tag-dem"}>{c.party==="Republican"?"REP":"DEM"}</span>
                </div>
              ))}
            </div>
            <div className="mono-sm" style={{ marginTop:10 }}>Candidate order randomized · Plurality wins · No runoff for U.S. Senate general election</div>
            {powSolving && (
              <>
                <div className="pow-msg">Generating vote token…</div>
                <div className="pow-bar"><div className="pow-fill"/></div>
              </>
            )}
            <button className="btn btn-primary" disabled={!selGeneral||powSolving} onClick={submitGeneral}>
              {powSolving?<><span className="spin"/>Verifying…</>:<>Cast General Election Vote ★</>}
            </button>
          </div>
        )}

        {/* ═══ RESULTS ═══ */}
        {step === 5 && (
          <div className="screen">
            <div className="slabel">Step 06 — Results & Analysis</div>
            {(hasVotedPrimary||hasVotedRunoff||hasVotedGeneral) && (
              <div className="voted-badge">✓ YOUR VOTES RECORDED · THANK YOU FOR PARTICIPATING</div>
            )}
            <div className="phase-flow">
              <div className={`phase-node ${primaryResult?.status?"done-phase":"active-phase"}`}>
                <div className="phase-node-lbl">Primary</div>
                <div className="phase-node-status">{primaryResult?.status==="winner"?"✓ Done":primaryResult?.status==="runoff"?"↪ Runoff":"Live"}</div>
              </div>
              <span className="phase-arrow">▶</span>
              <div className={`phase-node ${hasRunoff?(hasVotedRunoff?"done-phase":"active-phase"):"locked"}`}>
                <div className="phase-node-lbl">Runoff</div>
                <div className="phase-node-status">{hasRunoff?(runoffResult?.status==="winner"?"✓ Done":"Live"):"N/A"}</div>
              </div>
              <span className="phase-arrow">▶</span>
              <div className={`phase-node ${hasVotedGeneral?"done-phase":hasVotedPrimary?"active-phase":"locked"}`}>
                <div className="phase-node-lbl">General</div>
                <div className="phase-node-status">{hasVotedGeneral?"✓ Done":hasVotedPrimary?"Live":"Pending"}</div>
              </div>
            </div>
            <div className="tabs" role="tablist">
              {[["results","Results"],["integrity","Integrity"],["about","About & Legal"]].map(([k,l])=>(
                <button key={k} className={`tab ${activeTab===k?"active":""}`} onClick={()=>setActiveTab(k)}
                  role="tab" aria-selected={activeTab===k}>{l}</button>
              ))}
            </div>

            {activeTab==="results" && (
              <>
                {party && <ResultsBlock title={`${party} Primary`} phaseStatus={primaryResult?.status||"live"} candidates={CANDIDATES[party]||[]} tallies={primaryTallies} total={totalPrimary} myVote={myPrimaryVote} />}
                {hasRunoff && <ResultsBlock title={`${party} Runoff`} phaseStatus={runoffResult?.status||"live"} candidates={runoffCandidates} tallies={runoffTallies} total={totalRunoff} myVote={myRunoffVote} />}
                {generalCandidates.length>0 && <ResultsBlock title="General Election Simulation" phaseStatus="live" candidates={generalCandidates} tallies={generalTallies} total={totalGeneral} myVote={myGeneralVote} />}
                {anomalies.length>0 && (
                  <div style={{ marginTop:14 }}>
                    <div style={{ fontFamily:"var(--mono)",fontSize:9,letterSpacing:".14em",textTransform:"uppercase",color:"var(--red)",marginBottom:7 }}>⚠ Anomaly Flags</div>
                    {anomalies.map((a,i)=><div key={i} className="anomaly-item">⚠ {a}</div>)}
                  </div>
                )}
                <div className="dbox" style={{ marginTop:14 }}>
                  <strong>AAPOR DISCLOSURE:</strong> Non-probability, self-selected, opt-in sample. Recruitment: open community link sharing. Participants self-assert Texas residency via ZIP code — not independently verified. Results are unweighted raw vote counts. Not adjusted for demographics or turnout. Cannot be generalized to the Texas electorate. No margin of error is computable. Do not cite without full n, tier label, and this statement.
                </div>
                <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginTop:10 }}>
                  <button className="btn-sm" onClick={()=>party&&loadTallies(party)}>↻ Refresh Results</button>
                  {/* Phase 3: working export button */}
                  <button className="btn-sm" onClick={()=>exportData(primaryTallies,runoffTallies,generalTallies,runoffCandidates,generalCandidates,party,anomalies)}>
                    ⬇ Export Raw Data (JSON)
                  </button>
                </div>
              </>
            )}

            {activeTab==="integrity" && (
              <>
                <div style={{ fontFamily:"var(--serif)",fontSize:12,color:"var(--muted)",fontStyle:"italic",marginBottom:14,lineHeight:1.8 }}>
                  All metrics are publicly visible. Any journalist or researcher may download the raw data and independently verify these numbers.
                </div>
                <div className="dash-grid">
                  {[
                    ["Primary Votes",totalPrimary,getTier(totalPrimary).label],
                    ["Runoff Votes",totalRunoff,hasRunoff?"Active":"Not triggered"],
                    ["General Votes",totalGeneral,"Head-to-head"],
                    ["Threshold","50%+1","Count-based · Texas law"],
                    ["Anomaly Flags",anomalies.length,anomalies.length>0?"Review flagged":"None active"],
                    ["Ballot Order","Crypto","Fisher-Yates · Session-seeded"],
                    ["PoW","Active","14-bit difficulty"],
                    ["Version",EKEY,"Election namespace"],
                    ["Storage","Redundant","window.storage + localStorage"],
                  ].map(([l,v,s])=>(
                    <div key={l} className="dash-card">
                      <div className="dash-card-lbl">{l}</div>
                      <div className="dash-card-val" style={{ fontSize: String(v).length > 6 ? 12 : 20 }}>{v}</div>
                      <div className="mono-sm">{s}</div>
                    </div>
                  ))}
                </div>
                {anomalies.length>0&&anomalies.map((a,i)=><div key={i} className="anomaly-item">⚠ {a}</div>)}
              </>
            )}

            {activeTab==="about" && (
              <>
                <div className="about-hdr">Methodology</div>
                <div className="about-body">
                  This tool simulates the full Texas U.S. Senate 2026 election pipeline — primary, runoff (if triggered), and general election — using real candidate names as officially filed with the Texas Secretary of State. It is designed by a non-partisan Texas resident as an open-source civic technology project. The methodology was validated by five independent AI reasoning systems before any code was written. All source code is permanently and unconditionally public.
                </div>
                <div className="about-body">
                  <strong style={{ color:"var(--text)" }}>For journalists and researchers:</strong> A JSON export of all aggregate vote tallies, anomaly flags, and participation tier data is available via the Results tab. The GitHub repository contains the full source code, changelog, and AI synthesis reports. Contact: {ATTORNEY_REVIEW.contactEmail}
                </div>
                <div className="about-hdr">Neutrality Constitution</div>
                {[
                  ["I","No photos, bios, or endorsements — legal name and party designation only. No official titles rendered on ballots."],
                  ["II","Candidate order randomized using cryptographic RNG (crypto.getRandomValues) with session-persistent Fisher-Yates shuffle. Order is stable within a session, unique across sessions."],
                  ["III","Identical visual treatment for all candidates and parties. No color, size, or weight advantage to any candidate or party."],
                  ["IV","No forecasting language. Results labeled as 'current standing' or 'current leader,' not 'projected winner' or 'nominee.' Early-signal results carry explicit volatility warnings."],
                  ["V","Complete source code permanently and unconditionally public at the project GitHub repository."],
                  ["VI","Non-partisan disclosure present on every screen, position:sticky — cannot be scrolled away."],
                  ["VII","All rule changes to this tool are documented in the public changelog before deployment. No silent modifications."],
                ].map(([n,t])=>(
                  <div key={n} className="principle-row">
                    <div className="principle-num">{n}</div>
                    <div className="principle-text">{t}</div>
                  </div>
                ))}
                <div style={{ height:16 }} />
                <div className="about-hdr">Version & Security</div>
                <div className="about-body">
                  This is version {EKEY}. Votes are scoped to this election namespace — data cannot bleed across races or cycles. Vote submission includes a client-side proof-of-work challenge (~100-400ms) and SHA-256 fingerprint locking to deter automated submission. These are deterrence measures, not identity verification. Determined actors can bypass client-side controls; this tool does not claim otherwise.
                </div>
                <AttorneyPanel review={ATTORNEY_REVIEW} />
              </>
            )}
          </div>
        )}

        <div style={{ width:"100%",maxWidth:700,borderTop:"1px solid var(--border)",background:"var(--bg2)",padding:"9px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:4,marginTop:8 }}>
          <span style={{ fontFamily:"var(--mono)",fontSize:7,color:"var(--dim)",letterSpacing:".07em" }}>{EKEY} · {ELECTION.primaryDate} · NON-PARTISAN · OPEN SOURCE</span>
          <span style={{ fontFamily:"var(--mono)",fontSize:7,color:"var(--dim)",letterSpacing:".07em" }}>Cross-AI Validated · Phase 3 · v3.0</span>
        </div>
      </div>
    </>
  );
}
