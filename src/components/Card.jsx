import React from "react";

/**
 * App-wide card.
 *   - elevation: 1 | 2 | 3 — controls background colour + box-shadow size/spread.
 *   - size: "sm" | "md" | "lg" — controls border radius + padding.
 * See _card.scss.
 */
export default function Card({
  elevation = 1,
  size = "md",
  className = "",
  children,
  ...rest
}) {
  return (
    <div
      className={`card card--e${elevation} card--${size}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * Consistent card header layout: | optional icon | title | badge bar | button |.
 * Any slot may be omitted; the action (button) is pushed to the far right.
 */
export function CardHeader({ icon, title, badges, action, className = "" }) {
  return (
    <div className={`card-header${className ? ` ${className}` : ""}`}>
      {icon != null && <span className="card-header-icon">{icon}</span>}
      {title != null && <span className="card-header-title">{title}</span>}
      {badges != null && <div className="card-header-badges">{badges}</div>}
      {action != null && <div className="card-header-action">{action}</div>}
    </div>
  );
}
