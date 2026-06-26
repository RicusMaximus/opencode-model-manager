// ── Gate: MTF rule-based checklist ──────────────────────────────────────────
//
// Pure renderer module. NO IPC, NO Node. Operates on a single string (the
// concatenated/first artifact content) and returns an array of orientation
// results for the reviewer. The checklist *informs*; it never decides.
//
// Each rule returns:
//   { id, name, level: 'pass' | 'warn' | 'fail' | 'info', detail }
//
// Rule set is the approved design (OQ5). See docs/specs/gated-review-queue.md §7.6.

/**
 * @typedef {Object} ChecklistResult
 * @property {string} id
 * @property {string} name
 * @property {'pass'|'warn'|'fail'|'info'} level
 * @property {string} detail
 */

/**
 * Run the MTF checklist over a design artifact's text.
 * @param {string} text
 * @returns {ChecklistResult[]}
 */
export function runMtfChecklist(text) {
  const src = typeof text === "string" ? text : "";
  const lines = src.split(/\r?\n/);
  const lower = src.toLowerCase();

  return [
    mtf001(src),
    mtf002(src),
    mtf003(src),
    mtf004(lines),
    mtf005(lines),
    mtf006(src),
    mtf007(lower),
    mtf008(lower),
    mtf009(lines),
    mtf010(lines)
  ];
}

// MTF-001 — Gate call present
function mtf001(src) {
  const present = src.includes("submit_for_review");
  return {
    id: "MTF-001",
    name: "Gate call present",
    level: present ? "pass" : "warn",
    detail: present
      ? "Found a submit_for_review reference."
      : "No submit_for_review call found — the design may not bind to the gate."
  };
}

// MTF-002 — Stage responsibilities defined
function mtf002(src) {
  const present = /##\s*responsibilities|##\s*workflow/i.test(src);
  return {
    id: "MTF-002",
    name: "Stage responsibilities defined",
    level: present ? "pass" : "warn",
    detail: present
      ? "Found a Responsibilities or Workflow section."
      : "No ## Responsibilities or ## Workflow heading found."
  };
}

// MTF-003 — File-level specificity
function mtf003(src) {
  const matches = src.match(/\b[\w-]+\.\w{2,5}\b/g) || [];
  const distinct = new Set(matches);
  const count = distinct.size;
  const ok = count >= 3;
  return {
    id: "MTF-003",
    name: "File-level specificity",
    level: ok ? "pass" : "warn",
    detail: ok
      ? `Found ${count} distinct file references.`
      : `Only ${count} distinct file reference${count === 1 ? "" : "s"} found (need at least 3).`
  };
}

// MTF-004 — Atomic write referenced
function mtf004(lines) {
  const writeLineIdxs = [];
  lines.forEach((line, idx) => {
    if (line.includes("writeFile") || line.includes("write(")) {
      writeLineIdxs.push(idx);
    }
  });

  if (writeLineIdxs.length === 0) {
    return {
      id: "MTF-004",
      name: "Atomic write referenced",
      level: "pass",
      detail: "No file-write reference — not applicable."
    };
  }

  const safetyRe = /atomic|rename|temp/i;
  const safeIdxs = [];
  for (const idx of writeLineIdxs) {
    const start = Math.max(0, idx - 5);
    const end = Math.min(lines.length - 1, idx + 5);
    const window = lines.slice(start, end + 1).join("\n");
    if (safetyRe.test(window)) safeIdxs.push(idx + 1);
  }

  const allSafe = safeIdxs.length === writeLineIdxs.length;
  return {
    id: "MTF-004",
    name: "Atomic write referenced",
    level: allSafe ? "pass" : "warn",
    detail: allSafe
      ? `Write reference is paired with atomic/rename/temp near line${safeIdxs.length === 1 ? "" : "s"} ${safeIdxs.join(", ")}.`
      : `Write referenced without nearby atomic/rename/temp safety (lines ${writeLineIdxs.map((i) => i + 1).join(", ")}).`
  };
}

// MTF-005 — No unresolved markers
function mtf005(lines) {
  const markerRe = /\b(TODO|TBD|FIXME)\b|\?\?\?/;
  const hits = [];
  lines.forEach((line, idx) => {
    if (markerRe.test(line)) hits.push(idx + 1);
  });
  const clean = hits.length === 0;
  return {
    id: "MTF-005",
    name: "No unresolved markers",
    level: clean ? "pass" : "warn",
    detail: clean
      ? "No TODO/TBD/FIXME/??? markers."
      : `Unresolved markers at line${hits.length === 1 ? "" : "s"} ${hits.join(", ")}.`
  };
}

// MTF-006 — Handoff block present
function mtf006(src) {
  const mentionsUiGen = src.includes("ui_generator");
  if (!mentionsUiGen) {
    return {
      id: "MTF-006",
      name: "Handoff block present",
      level: "pass",
      detail: "No ui_generator reference — handoff block not required."
    };
  }
  const hasHandoff = src.includes("HANDOFF");
  return {
    id: "MTF-006",
    name: "Handoff block present",
    level: hasHandoff ? "pass" : "fail",
    detail: hasHandoff
      ? "ui_generator paired with a HANDOFF block."
      : "ui_generator referenced but no HANDOFF block found."
  };
}

// MTF-007 — Error path addressed
function mtf007(lower) {
  const present = /error|fail|reject|timeout/.test(lower);
  return {
    id: "MTF-007",
    name: "Error path addressed",
    level: present ? "pass" : "warn",
    detail: present
      ? "Found error/failure/reject/timeout language."
      : "No error/failure/reject/timeout handling mentioned."
  };
}

// MTF-008 — Build-stage sequencing
function mtf008(lower) {
  const buildIdxs = ["builder", "validator", "scribe"]
    .map((k) => lower.indexOf(k))
    .filter((i) => i !== -1);
  const gateIdxs = ["gate", "design"]
    .map((k) => lower.indexOf(k))
    .filter((i) => i !== -1);

  if (buildIdxs.length === 0) {
    return {
      id: "MTF-008",
      name: "Build-stage sequencing",
      level: "pass",
      detail: "No build-stage agents referenced — sequencing not applicable."
    };
  }

  const firstBuild = Math.min(...buildIdxs);
  // No gate/design anchor → can't show build-before-gate inversion → pass.
  if (gateIdxs.length === 0) {
    return {
      id: "MTF-008",
      name: "Build-stage sequencing",
      level: "pass",
      detail: "Build-stage agents present; no gate/design anchor to compare against."
    };
  }

  const firstGate = Math.min(...gateIdxs);
  const inverted = firstBuild < firstGate;
  return {
    id: "MTF-008",
    name: "Build-stage sequencing",
    level: inverted ? "warn" : "pass",
    detail: inverted
      ? "A build-stage agent is referenced before the gate/design stage (possible sequencing inversion)."
      : "Build-stage agents follow the gate/design stage."
  };
}

// MTF-009 — Document length
function mtf009(lines) {
  const count = lines.length;
  const ok = count >= 50 && count <= 2000;
  return {
    id: "MTF-009",
    name: "Document length",
    level: ok ? "pass" : "info",
    detail: ok
      ? `Document is ${count} lines (within 50–2000).`
      : `Document is ${count} lines (outside the typical 50–2000 range).`
  };
}

// MTF-010 — No inline secrets
function mtf010(lines) {
  const tokenRe = /[A-Za-z0-9_\-]{32,}/;
  const labelRe = /key|token|secret|password/i;
  const hits = [];
  lines.forEach((line, idx) => {
    if (tokenRe.test(line) && labelRe.test(line)) hits.push(idx + 1);
  });
  const clean = hits.length === 0;
  return {
    id: "MTF-010",
    name: "No inline secrets",
    level: clean ? "pass" : "fail",
    detail: clean
      ? "No token-shaped secrets detected."
      : `Possible inline secret at line${hits.length === 1 ? "" : "s"} ${hits.join(", ")}.`
  };
}

export default runMtfChecklist;
