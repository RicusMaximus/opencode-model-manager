import React from "react";

// Application settings (stored in agent-manager-settings.json, separate from any
// OpenCode config). `settings` is the current values; `onChange(key, value)`
// persists immediately and applies the effect (e.g. starts/stops the wrapper).
export default function SettingsPanel({ settings, onChange, busy }) {
  const runOnStartup = !!settings?.runClaudeSubOnStartup;

  const toggle = () => {
    if (busy) return;
    onChange("runClaudeSubOnStartup", !runOnStartup);
  };

  return (
    <div className="settings-panel">
      <div className="panel-header">
        <div className="panel-header-text">
          <h1 className="panel-title">Settings</h1>
          <p className="panel-subtitle">
            Application preferences for the OpenCode Agent Manager.
          </p>
        </div>
      </div>

      <div className="settings-list">
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-label">
              Run Claude subscription model service on startup
            </span>
            <span className="settings-row-desc">
              Automatically start the managed Claude (subscription) wrapper when the
              app launches. Applies on the next app start — it doesn’t stop or start
              the running service (use the Models screen for that).
            </span>
          </div>
          <div
            className={`as-toggle${runOnStartup ? " is-on" : ""}`}
            role="switch"
            aria-checked={runOnStartup}
            aria-label="Run Claude subscription model service on startup"
            tabIndex={0}
            onClick={toggle}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggle();
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
