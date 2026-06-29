import React from "react";

/**
 * App-wide badge component.
 *
 * Props:
 *   - size: "sm" | "md"   (default "md") — md is the default/header size, sm for
 *     denser, in-content lists (e.g. the agent description summary).
 *   - tone: colour variant — "blue" | "green" | "gold" | "violet" | "red" | "neutral".
 *   - dot:  optional leading status dot — "green" | "yellow" | "red" | "gray".
 *   - title, children.
 *
 * Monospace, 12px (md) / 11px (sm), no glow — see _badge.scss.
 */
export default function Badge({ size = "md", tone = "neutral", dot, title, children }) {
  return (
    <span className={`badge badge--${size} badge--${tone}`} title={title}>
      {dot && <span className={`badge-dot badge-dot--${dot}`} />}
      {children}
    </span>
  );
}
