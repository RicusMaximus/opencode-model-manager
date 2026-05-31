# SCSS Refactor Plan — opencode-model-gui

> Architecture document for the Builder. Every decision here is final; the
> Builder should not need to invent structure, naming, or token values.

---

## 0. Context Snapshot

- **Build tool:** Vite 5.4.x (`vite.config.js`). Vite has built-in SCSS support
  as soon as `sass` (Dart Sass) is present in `devDependencies`.
- **Framework:** React 18.3.x in an Electron 33 desktop shell (renderer is a
  Vite-served SPA loaded by `electron/main.js`; in dev served from
  `http://localhost:5173`).
- **CSS entry mechanism today:** Three plain CSS files imported as side-effect
  modules in `src/main.jsx`:
  ```js
  import './styles/variables.css'
  import './styles/global.css'
  import './styles/app.css'
  ```
  No CSS Modules, no styled-components, no Tailwind. Plain global stylesheets,
  BEM-ish class names (e.g. `.model-dropdown-btn.is-open`).
- **Runtime token usage from JS:** Several `*.jsx` files (RightSidebar,
  AgentSettingsPanel) reference CSS custom properties through inline styles,
  e.g. `style={{ color: 'var(--text-dim)' }}`. **This means the `:root` CSS
  custom-property surface must be preserved verbatim** after the refactor —
  removing them would break runtime style references. SCSS variables/maps
  must mirror, not replace, the custom-property layer.
- **Fonts:** `Inter` and `JetBrains Mono` loaded from Google Fonts in
  `index.html` (no font assets bundled).

---

## 1. Inventory

| Current file | One-line summary |
|---|---|
| `src/styles/variables.css` | Single `:root` block. Defines colour palette (backgrounds, borders, text, accents, status), font-family stacks, large catalogue of pre-baked `box-shadow` tokens, and layout sizing (header/footer height, sidebar widths). |
| `src/styles/global.css` | Reset (`*`, margins/box-sizing), html/body/#root full-bleed sizing, body typography/colour, generic resets for `button`/`input`, and webkit scrollbar theming. |
| `src/styles/app.css` | ~1640 lines of component-scoped global classes. Covers app shell, titlebar/window controls, left sidebar, agent grid + agent cards (with container queries), model dropdown, Ollama panel/toolbar/search, model cards + perf meter (with `@keyframes perf-shimmer`), right sidebar metrics, status bar, system view, and the AgentSettingsPanel (`.as-*` namespace). |

Confirmed build-tool / framework / import mechanism in §0.

---

## 2. Target Folder Structure (`src/styles/`)

```
src/styles/
├── main.scss                    # Root entry. ONLY @use statements.
├── abstracts/
│   ├── _variables.scss          # $-prefixed SCSS scalars (mirrors of :root vars)
│   ├── _maps.scss               # Sass maps: $colors, $spacing, $font-sizes, $z-layers, $breakpoints, $radii, $shadows
│   ├── _functions.scss          # color(), spacing(), rem(), z()
│   ├── _mixins.scss             # breakpoint(), flex(), grid(), focus-ring, truncate, visually-hidden, transition(), typography(), button-reset
│   ├── _placeholders.scss       # %card-surface, %scrollable, %dragless, %muted-text, etc.
│   └── _index.scss              # @forward each of the above (one line per file)
├── base/
│   ├── _reset.scss              # *, *::before, *::after box-sizing/margins; webkit scrollbar
│   ├── _root.scss               # :root { --bg-…; --text-…; --shadow-…; … } — UNCHANGED custom properties
│   ├── _typography.scss         # body font-family, font-smoothing, base font-size, headings reset
│   ├── _base.scss               # html/body/#root sizing, body bg/colour/user-select, button/input resets
│   └── _index.scss              # @forward order: reset → root → typography → base
├── components/
│   ├── _titlebar.scss           # .titlebar, .titlebar-*, .window-controls, .win-btn
│   ├── _nav-item.scss           # .nav-item, .nav-icon (incl. &.active)
│   ├── _workspace-widget.scss   # .workspace-widget, .workspace-label, .workspace-dir
│   ├── _ollama-status-card.scss # .ollama-status-card, .status-dot, .ollama-addr
│   ├── _agent-card.scss         # .agent-card + .agent-card-*, .agent-badge, .agent-tool-chip, .agent-card-settings-btn
│   ├── _model-dropdown.scss     # .model-dropdown-*, .model-option-*
│   ├── _model-card.scss         # .model-card, .model-stats-grid, .model-stat-*, .model-perf-* (+ @keyframes perf-shimmer)
│   ├── _search.scss             # .search-wrap, .search-input, .search-icon
│   ├── _buttons.scss            # .deploy-btn, .pull-model-btn, .filter-btn, .save-btn (+ states)
│   ├── _metric.scss             # .metric-row, .metric-bar-*, .bar-blue|green|yellow
│   ├── _turbo-card.scss         # .turbo-card, .turbo-card-*
│   ├── _hw-card.scss            # .hw-card, .hw-row-*
│   ├── _log-box.scss            # .log-box, .log-line (+ info/debug)
│   ├── _perf-placeholder.scss   # .perf-placeholder, .perf-placeholder-text
│   ├── _toggle.scss             # .as-toggle (extracted; reusable)
│   ├── _slider.scss             # .as-slider, .as-slider-thumb (extracted; reusable)
│   ├── _agent-settings.scss     # remaining .as-* (panel/header/grid/card/perm/label/input/instructions)
│   └── _index.scss              # @forward every component partial (alphabetical)
├── layout/
│   ├── _app-shell.scss          # .app-root, .app-body, .app-main
│   ├── _sidebar-left.scss      # .sidebar-left, .sidebar-logo*, .sidebar-nav, .sidebar-bottom
│   ├── _sidebar-right.scss      # .sidebar-right (+ &.agents, &.models), .rs-section, .rs-section-label, .rs-section-heading
│   ├── _status-bar.scss         # .status-bar, .status-bar-left/right, .ollama-indicator, .ollama-version, .last-saved-text, .status-sep-dot
│   ├── _panel.scss              # .panel-header, .panel-title, .panel-subtitle (generic page header)
│   ├── _agent-grid.scss         # .agent-grid-shell, .agent-grid + @container agent-grid rules
│   └── _index.scss              # @forward all layout partials
├── pages/
│   ├── _agent-panel.scss        # .agent-panel
│   ├── _ollama-panel.scss       # .ollama-panel, .ollama-toolbar, .model-grid, .models-empty
│   ├── _system.scss             # .system-placeholder, .system-full-view
│   └── _index.scss              # @forward all page partials
├── themes/
│   ├── _default.scss            # Theme-keyed map (default = current dark palette). Hook for future :root[data-theme="…"].
│   └── _index.scss              # @forward "default"
├── vendors/
│   └── _index.scss              # Currently empty placeholder. (Google Fonts is loaded via <link> in index.html — no @import needed.)
└── utilities/
    ├── _spacing.scss            # .m-*, .p-* (+ direction variants) via @each
    ├── _colors.scss             # .text-*, .bg-* via @each over $colors
    ├── _flex.scss               # .flex, .flex-row, .flex-col, .flex-wrap, .justify-*, .items-*, .gap-*
    ├── _grid.scss               # .grid, .grid-cols-{1..12}, .col-span-{1..12}, .grid-rows-{1..6}, .gap-*
    ├── _display.scss            # .block, .inline-block, .inline, .hidden (note: .flex / .grid live with their family)
    ├── _position.scss           # .relative, .absolute, .fixed, .sticky
    ├── _sizing.scss              # .w-full, .w-screen, .w-auto, .h-full, .h-screen
    ├── _typography.scss         # .text-{left|center|right}, .font-*, .text-{xs..2xl}
    ├── _radius.scss             # .rounded, .rounded-{sm|md|lg|full}
    ├── _shadow.scss             # .shadow, .shadow-{sm|md|lg}
    ├── _overflow.scss           # .overflow-{hidden|auto|scroll}
    ├── _cursor.scss             # .cursor-{pointer|default|not-allowed}
    └── _index.scss              # @forward every utility partial
```

### `main.scss` — exact `@use` order

```scss
// 1. Vendors (third-party — currently empty, kept for ordering)
@use "vendors";

// 2. Abstracts — variables/maps/functions/mixins/placeholders (no CSS output)
@use "abstracts";

// 3. Base — reset, :root custom-property declarations, typography, base
@use "base";

// 4. Themes — additional theme overrides on top of base :root
@use "themes";

// 5. Layout — app shell + grid/sidebar/header/footer
@use "layout";

// 6. Components — individual UI components
@use "components";

// 7. Pages — page-scope only
@use "pages";

// 8. Utilities — single-purpose helpers, LAST so they win the cascade
@use "utilities";
```

The order is deliberate:
- abstracts produce no CSS, so they're safe early;
- base / themes establish the global `:root` surface;
- layout sets structural rules;
- components style their own scope;
- pages adjust component placement on specific routes;
- utilities are last so a class like `.hidden` always overrides component CSS.

---

## 3. Token Catalog

All concrete values are pulled from `variables.css` (real usage) plus values
derived from `app.css` (real spacing/radius/font-size usage). Where the source
files lack a token (breakpoints, full spacing scale, z-index layers), reasonable
defaults are proposed — the Builder must adopt them as written.

### 3.1 Color map (`$colors` in `abstracts/_maps.scss`)

Every key here also gets a matching `--name: value` in `base/_root.scss`
(unchanged from the existing file). The SCSS map is what utility loops iterate.

| Key | Value | Source `--var` |
|---|---|---|
| `bg-deep` | `#0a0d14` | `--bg-deep` |
| `bg-base` | `#0f1419` | `--bg-base` |
| `bg-sidebar` | `#171c21` | `--bg-sidebar` |
| `bg-card` | `#1c2126` | `--bg-card` |
| `bg-workspace` | `#262930` | `--bg-workspace` |
| `bg-elevated` | `#30353d` | `--bg-elevated` |
| `border` | `#404752` | `--border` |
| `text-muted` | `#6b7280` | `--text-muted` |
| `text-dim` | `#8c919e` | `--text-dim` |
| `text-secondary` | `#bfc7d4` | `--text-secondary` |
| `text-primary` | `#dde3eb` | `--text-primary` |
| `accent-blue` | `#a3c9ff` | `--accent-blue` |
| `accent-green` | `#66de70` | `--accent-green` |
| `accent-yellow` | `#fabf45` | `--accent-yellow` |
| `accent-gold` | `#d19921` | `--accent-gold` |
| `blue-bright` | `#59a6ff` | `--blue-bright` |
| `green-save` | `#26a540` | `--green-save` |
| `green-save-text` | `#00330a` | `--green-save-text` |
| `blue-btn-text` | `#00305c` | `--blue-btn-text` |
| `red-validator` | `#940009` | `--red-validator` |
| `red-danger` | `#c0392b` | derived (used inline for close-button hover and disconnected status) |

**Total palette size: 21 colours.**

### 3.2 Spacing scale (`$spacing` in `abstracts/_maps.scss`)

Derived from concrete `padding`/`gap`/`margin`/`top`/`left` values found
across the existing CSS: `0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64`px.
Collapsed to a Tailwind-style numeric scale (4-px base) plus the off-grid
2/6/10/14/18/28 that the design genuinely uses:

| Key | px | rem |
|---|---|---|
| `0` | 0 | 0 |
| `0-5` | 2 | 0.125rem |
| `1` | 4 | 0.25rem |
| `1-5` | 6 | 0.375rem |
| `2` | 8 | 0.5rem |
| `2-5` | 10 | 0.625rem |
| `3` | 12 | 0.75rem |
| `3-5` | 14 | 0.875rem |
| `4` | 16 | 1rem |
| `4-5` | 18 | 1.125rem |
| `5` | 20 | 1.25rem |
| `6` | 24 | 1.5rem |
| `7` | 28 | 1.75rem |
| `8` | 32 | 2rem |
| `10` | 40 | 2.5rem |
| `12` | 48 | 3rem |
| `16` | 64 | 4rem |

The Sass map key uses `-5` for the half-step because dots are not valid in CSS
class names; utility output is `.m-1-5`, `.p-3-5`, etc.

### 3.3 Typography scale

**Font families** (mirrors `variables.css`):
- `$font-sans: 'Inter', system-ui, sans-serif;`
- `$font-mono: 'JetBrains Mono', 'Fira Code', monospace;`

**Font sizes** (`$font-sizes`, derived from real usage in `app.css`):

| Key | Value |
|---|---|
| `xs` | `10px` |
| `sm` | `11px` |
| `base` | `12px` |
| `md` | `13px` |
| `lg` | `14px` |
| `xl` | `16px` |
| `2xl` | `18px` |
| `3xl` | `22px` |
| `4xl` | `24px` |
| `5xl` | `32px` |

**Font weights** (`$font-weights`):

| Key | Value |
|---|---|
| `normal` | 400 |
| `medium` | 500 |
| `semibold` | 600 |
| `bold` | 700 |
| `black` | 900 |

**Line heights** (`$line-heights`, observed `1.2`, `1.5`, `1.55`, `1.6`):

| Key | Value |
|---|---|
| `tight` | 1.2 |
| `normal` | 1.5 |
| `relaxed` | 1.6 |

**Letter spacings** (observed: `0.04em`, `0.05em`, `0.06em`, `0.08em`):

| Key | Value |
|---|---|
| `tight` | 0 |
| `wide` | 0.04em |
| `wider` | 0.06em |
| `widest` | 0.08em |

### 3.4 Breakpoints (`$breakpoints`)

The existing CSS uses **container queries** (`@container agent-grid`) and a
single media query (`max-width: 1100px`). The Electron renderer is a desktop
window so mobile breakpoints are not strictly needed, but the standard set is
codified for forward use:

| Key | Min width |
|---|---|
| `sm` | 640px |
| `md` | 768px |
| `lg` | 1024px |
| `xl` | 1280px |
| `2xl` | 1536px |

Plus a single named container-query breakpoint set for the agent grid:

| Key | Min width | Use |
|---|---|---|
| `agent-2col` | 560px | container query on `.agent-grid-shell` |
| `agent-3col` | 960px | container query on `.agent-grid-shell` |

### 3.5 Radii (`$radii`)

Observed values: `2px`, `3px`, `4px`, `6px`, `8px`, `12px`, `50%`, `999px`.

| Key | Value |
|---|---|
| `none` | 0 |
| `sm` | 2px |
| `md` | 4px |
| `lg` | 6px |
| `xl` | 8px |
| `2xl` | 12px |
| `full` | 9999px |

### 3.6 Shadows (`$shadows`)

Preserve every prebaked shadow from `variables.css` verbatim — `app.css`
references them as `var(--shadow-…)`. Both the SCSS map and the `:root`
custom properties remain.

| Key | Source `--var` |
|---|---|
| `card` | `--shadow-card` |
| `card-hover` | `--shadow-card-hover` |
| `sidebar` | `--shadow-sidebar` |
| `sidebar-r` | `--shadow-sidebar-r` |
| `header` | `--shadow-header` |
| `footer` | `--shadow-footer` |
| `dropdown` | `--shadow-dropdown` |
| `input` | `--shadow-input` |
| `bar` | `--shadow-bar` |

Utility-friendly aliases (`shadow-sm` / `shadow-md` / `shadow-lg`) map to
existing shadows:

| Alias | Resolves to |
|---|---|
| `sm` | `card` |
| `md` | `card-hover` |
| `lg` | `dropdown` |

### 3.7 Z-index layers (`$z-layers`)

Observed: `z-index: 1000` on `.titlebar`, `100` on `.model-dropdown-menu`,
`5` on sidebars and status bar, `1` on agent-card cog button.

| Key | Value |
|---|---|
| `base` | 0 |
| `raised` | 1 |
| `sticky` | 5 |
| `dropdown` | 100 |
| `overlay` | 500 |
| `modal` | 1000 |
| `toast` | 2000 |

### 3.8 Layout sizing (mirrors `variables.css`, kept as both `$` and `:root`)

| Key | Value |
|---|---|
| `header-height` | 48px |
| `footer-height` | 32px |
| `sidebar-left` | 256px |
| `sidebar-right-agents` | 288px |
| `sidebar-right-models` | 320px |

---

## 4. Mixin & Function Catalog

All live in `abstracts/_functions.scss` / `abstracts/_mixins.scss` and are
re-exported by `abstracts/_index.scss`. Consumers `@use "../abstracts" as a;`
and call `a.spacing(4)`, `a.color(accent-blue)`, etc.

### Functions

| Signature | Purpose |
|---|---|
| `spacing($key)` | Look up a value in `$spacing`. `spacing(4) → 1rem`. Errors loudly if `$key` not in map. |
| `color($name, $shade: null)` | Look up `$colors` (the `$shade` arg is reserved for a future tints/shades extension; currently must be `null` and is ignored). |
| `rem($px)` | Convert a `px` literal to `rem` using a 16-px root. `rem(24) → 1.5rem`. |
| `z($layer)` | Look up `$z-layers`. `z(modal) → 1000`. |
| `shadow($key)` | Look up `$shadows`. Returns a `var(--shadow-…)` reference so runtime theme changes still work. |
| `radius($key)` | Look up `$radii`. |
| `breakpoint-value($key)` | Internal helper used by the `breakpoint` mixin. |

### Mixins

| Signature | Purpose |
|---|---|
| `breakpoint($name)` | `@media (min-width: <value>) { @content }` from `$breakpoints`. Errors if name is unknown. |
| `flex($direction: row, $justify: flex-start, $align: stretch, $gap: 0)` | One-liner flex container with all four axes settable. |
| `grid($cols, $gap: 0)` | One-liner CSS grid: `grid-template-columns: repeat($cols, 1fr); gap: <gap>;`. |
| `focus-ring($color: color(accent-blue))` | Standard 2-px outer focus ring used by `.agent-card-settings-btn:focus-visible` and inputs. |
| `truncate` | `overflow:hidden; text-overflow:ellipsis; white-space:nowrap;`. |
| `visually-hidden` | a11y screen-reader-only helper. |
| `transition($props...)` | Variadic `transition: $p 150ms ease, …;` shortcut. Default property list = `(background, color, border-color)`. |
| `typography($preset)` | Applies a preset (`'title'`, `'body'`, `'mono-sm'`, `'label-uppercase'`, …) — font-family + size + weight + letter-spacing in one call. Presets live in `$typography-presets`. |
| `button-reset` | Strips browser button defaults (used by `.titlebar-browse-btn`, `.as-icon-btn`, etc.). |
| `card-surface` | `background:var(--bg-card); border:1px solid var(--border); border-radius: radius(xl); box-shadow: shadow(card);` — extracts the repeated card pattern. |
| `scrollbar-dark` | Webkit scrollbar styling (lifted from `global.css`). |

### Placeholders (`abstracts/_placeholders.scss`)

For cases where extending is preferable to mixin output duplication:

| Selector | Purpose |
|---|---|
| `%card-surface` | Same as `card-surface` mixin but for `@extend`. |
| `%scrollable` | `overflow-y:auto; overflow-x:hidden;` |
| `%dragless` | `-webkit-app-region: no-drag;` for Electron drag exclusions |
| `%uppercase-label` | The repeated 10–11 px uppercase label (`workspace-label`, `rs-section-label`, `metric-label` uppercase variant, `as-label`). |

---

## 5. Utility Class Catalog

All utilities are generated by `@each` loops over the maps in
`abstracts/_maps.scss`. Naming convention is **Tailwind-style** so the syntax
is already familiar.

### 5.1 Spacing — `utilities/_spacing.scss`

Loops over `$spacing` (17 keys: `0, 0-5, 1, 1-5, 2, 2-5, 3, 3-5, 4, 4-5, 5, 6, 7, 8, 10, 12, 16`).

| Pattern | Property |
|---|---|
| `.m-{key}` | margin |
| `.mt-{key}` | margin-top |
| `.mr-{key}` | margin-right |
| `.mb-{key}` | margin-bottom |
| `.ml-{key}` | margin-left |
| `.mx-{key}` | margin-left + margin-right |
| `.my-{key}` | margin-top + margin-bottom |
| `.p-{key}` | padding |
| `.pt-/pr-/pb-/pl-/px-/py-{key}` | padding sides |

**Count:** 17 keys × 13 properties = **221 spacing classes**.

### 5.2 Colors — `utilities/_colors.scss`

Loops over `$colors` (21 keys).

- `.text-{name}` — sets `color`
- `.bg-{name}` — sets `background-color`
- `.border-{name}` — sets `border-color` (bonus, useful for the existing
  `border: 1px solid var(--border)` pattern)

**Count:** 21 × 3 = **63 colour classes**.

### 5.3 Flex — `utilities/_flex.scss`

Static:
- `.flex`, `.inline-flex`
- `.flex-row`, `.flex-col`, `.flex-row-reverse`, `.flex-col-reverse`
- `.flex-wrap`, `.flex-nowrap`, `.flex-wrap-reverse`
- `.flex-1`, `.flex-auto`, `.flex-none`
- `.justify-start | -end | -center | -between | -around | -evenly` (6)
- `.items-start | -end | -center | -stretch | -baseline` (5)
- `.self-start | -end | -center | -stretch` (4)

Looped over `$spacing`:
- `.gap-{key}` (17)
- `.gap-x-{key}` (17)
- `.gap-y-{key}` (17)

**Count:** ~14 static + 33 wrap/dir/flex-N + 51 gaps = **~76 flex classes**.

### 5.4 Grid — `utilities/_grid.scss`

- `.grid`
- `.grid-cols-{1..12}` (12)
- `.col-span-{1..12}` (12)
- `.grid-rows-{1..6}` (6)
- `.row-span-{1..6}` (6)
- gap utilities are shared with flex (defined once in `_flex.scss`)

**Count:** **37 grid classes**.

### 5.5 Display — `utilities/_display.scss`

`.block`, `.inline-block`, `.inline`, `.hidden`. (`.flex` and `.grid` live with
their families to avoid duplicate selectors.)

**Count:** 4.

### 5.6 Position — `utilities/_position.scss`

`.relative`, `.absolute`, `.fixed`, `.sticky`, `.static`. Plus `.inset-0`,
`.top-0`, `.right-0`, `.bottom-0`, `.left-0` as fixed helpers (no scale, just
`0`).

**Count:** 10.

### 5.7 Sizing — `utilities/_sizing.scss`

`.w-full`, `.w-screen`, `.w-auto`, `.w-fit`, `.h-full`, `.h-screen`,
`.h-auto`, `.h-fit`, `.min-h-0`, `.min-w-0`, `.max-w-full`.

**Count:** 11.

### 5.8 Typography — `utilities/_typography.scss`

- `.text-left`, `.text-center`, `.text-right`, `.text-justify` (4)
- `.text-{xs|sm|base|md|lg|xl|2xl|3xl|4xl|5xl}` over `$font-sizes` (10)
- `.font-{normal|medium|semibold|bold|black}` over `$font-weights` (5)
- `.font-sans`, `.font-mono` (2)
- `.uppercase`, `.lowercase`, `.capitalize`, `.normal-case` (4)
- `.tracking-{tight|wide|wider|widest}` over `$letter-spacings` (4)
- `.leading-{tight|normal|relaxed}` over `$line-heights` (3)
- `.truncate` (1, calls the mixin)
- `.whitespace-nowrap` (1)

**Count:** ~34.

### 5.9 Radius — `utilities/_radius.scss`

`.rounded-{none|sm|md|lg|xl|2xl|full}` over `$radii`, plus the unsuffixed
`.rounded` = `radius(md)` (4px) for parity with current 4-px default usage.

**Count:** 8.

### 5.10 Shadow — `utilities/_shadow.scss`

`.shadow`, `.shadow-{sm|md|lg}`, plus token-specific helpers
`.shadow-card`, `.shadow-card-hover`, `.shadow-dropdown`, `.shadow-input`,
`.shadow-bar`, `.shadow-header`, `.shadow-footer`, `.shadow-sidebar`,
`.shadow-sidebar-r`, `.shadow-none`.

**Count:** 14.

### 5.11 Overflow — `utilities/_overflow.scss`

`.overflow-{hidden|auto|scroll|visible}`,
`.overflow-x-{hidden|auto|scroll}`,
`.overflow-y-{hidden|auto|scroll}`.

**Count:** 10.

### 5.12 Cursor — `utilities/_cursor.scss`

`.cursor-{pointer|default|not-allowed|text|wait|move|help}`.

**Count:** 7.

### Utility totals

| Group | Approx. count |
|---|---|
| Spacing | 221 |
| Colors | 63 |
| Flex | 76 |
| Grid | 37 |
| Display | 4 |
| Position | 10 |
| Sizing | 11 |
| Typography | 34 |
| Radius | 8 |
| Shadow | 14 |
| Overflow | 10 |
| Cursor | 7 |
| **Total** | **≈ 495 utility classes** |

---

## 6. Build Integration Plan (Vite)

### 6.1 Dependencies

Add Dart Sass as the only new dev dependency:

```bash
npm install --save-dev sass
```

(No PostCSS, no `vite-plugin-sass-dts`, no Stylelint — those are scope creep.)

### 6.2 `vite.config.js`

**No change is strictly required.** Vite auto-detects `.scss` files and uses
Dart Sass when present. Do NOT add `additionalData` (e.g. auto-injecting
`@use "abstracts" as *;` into every component). Reasons:

1. The codebase has no `.module.scss` files and no per-component SCSS — all
   styles live under `src/styles/main.scss`. There is no component-level
   import surface that would benefit from auto-injection.
2. `additionalData` causes hard-to-debug "selector compiled but variable not
   found" errors and slows incremental rebuilds.
3. Explicit `@use` inside each partial keeps the dependency graph readable
   and is required by modern Sass (`@import` is deprecated).

The Builder should leave `vite.config.js` exactly as it is today.

### 6.3 Files to edit (exhaustive list)

| File | Change |
|---|---|
| `package.json` | `npm install --save-dev sass` will add the entry; no manual edit. |
| `src/main.jsx` | Replace the three CSS imports (lines 4–6) with a single `import './styles/main.scss'`. |
| `src/styles/variables.css` | Delete after migration (content moved to `base/_root.scss` and `abstracts/_variables.scss` + `_maps.scss`). |
| `src/styles/global.css` | Delete after migration (content split into `base/_reset.scss`, `base/_base.scss`, `base/_typography.scss`). |
| `src/styles/app.css` | Delete after migration (content split per §7). |
| `src/styles/main.scss` | New file (see §2). |
| All new partials | New files under `src/styles/{abstracts,base,components,layout,pages,themes,vendors,utilities}/`. |

**No JSX/JS code changes are required.** All existing class names and all
`var(--…)` references in inline styles continue to work because the `:root`
custom-property declaration block is preserved verbatim in `base/_root.scss`.

### 6.4 Verification steps for the Builder

1. `npm run dev` — page must render identically; visual diff vs. main branch
   should be zero pixels.
2. `npm run build` — must succeed with no Sass deprecation warnings (use
   `@use`, not `@import`, throughout).
3. `npm run electron:dev` — Electron renderer must still load styles. Vite
   serves them the same way (a single `<link>` injected into the dev HTML),
   so this should work without further changes.

---

## 7. Migration Mapping

### 7.1 `variables.css` →

- The entire `:root { … }` block is copied verbatim into
  `base/_root.scss`. **Nothing is removed or renamed.** This is the runtime
  theming surface that JSX inline styles depend on.
- The same values are mirrored in `abstracts/_variables.scss` as Sass scalars
  (`$bg-deep: #0a0d14;` etc.) and grouped into the maps defined in §3 inside
  `abstracts/_maps.scss`. Maps drive the utility loops; scalars are referenced
  by mixins where a raw value is needed (e.g. `rgba()` math).
- Where a SCSS-side rule produces a colour-derived value (e.g. focus-ring
  alpha), it should reference the SCSS scalar so the build can compute it;
  for runtime overridable styles, keep the `var(--…)` reference.

### 7.2 `global.css` →

| Source lines | Target partial | Selectors moved |
|---|---|---|
| 1–6 | `base/_reset.scss` | `*, *::before, *::after` box-sizing reset |
| 8–12 | `base/_base.scss` | `html, body, #root` sizing |
| 14–21 | `base/_typography.scss` + `base/_base.scss` | `body` font-family/colour → typography; `user-select`/smoothing → base |
| 23–37 | `base/_base.scss` | `button`, `input` resets (already global enough to belong in base) |
| 39–55 | `base/_reset.scss` | Webkit scrollbar pseudo-elements (logically a reset of OS defaults) |

### 7.3 `app.css` →

Every section in `app.css` is already comment-delimited; the mapping follows
those comments.

| Section (comment header) | Target |
|---|---|
| `App Shell` (`.app-root`, `.app-body`, `.app-main`) | `layout/_app-shell.scss` |
| `TitleBar` (`.titlebar*`, `.window-controls`, `.win-btn*`) | `components/_titlebar.scss` |
| `Left Sidebar` (`.sidebar-left`, `.sidebar-logo*`, `.sidebar-nav`, `.sidebar-bottom`) | `layout/_sidebar-left.scss` |
| `.nav-item`, `.nav-icon` (within Left Sidebar) | `components/_nav-item.scss` |
| `.workspace-widget`, `.workspace-label`, `.workspace-dir` | `components/_workspace-widget.scss` |
| `.ollama-status-card`, `.ollama-status-row`, `.ollama-status-label`, `.status-dot`, `.ollama-addr` | `components/_ollama-status-card.scss` |
| `Agent Panel` (`.agent-panel`, `.panel-header*`, `.panel-title`, `.panel-subtitle`) | `pages/_agent-panel.scss` (panel) + `layout/_panel.scss` (generic header) |
| `.deploy-btn` | `components/_buttons.scss` |
| `.agent-grid-shell`, `.agent-grid`, `@container` rules | `layout/_agent-grid.scss` |
| `Agent Card` (`.agent-card*`, `.agent-color-sq`, `.agent-model-badge`, `.agent-name`, `.agent-description`, `.agent-badge*`, `.agent-identity`, `.agent-name-row`, `.agent-version`, `.agent-section-label`, `.agent-tools`, `.agent-tool-chip*`, `.agent-model-row`, `.agent-card-settings-btn*`) | `components/_agent-card.scss` |
| `Model Dropdown` (`.model-dropdown-*`, `.model-option-*`) | `components/_model-dropdown.scss` |
| `Ollama Panel` (`.ollama-panel`, `.ollama-toolbar`) | `pages/_ollama-panel.scss` |
| `.search-wrap`, `.search-icon`, `.search-input` | `components/_search.scss` |
| `.filter-btn`, `.pull-model-btn` | `components/_buttons.scss` |
| `.model-grid`, `.models-empty` | `pages/_ollama-panel.scss` |
| `Model Card` (`.model-card*`, `.model-version-tag`, `.model-stats-grid`, `.model-stat-*`, `.model-card-separator`, `.model-perf-*`, `@keyframes perf-shimmer`) | `components/_model-card.scss` |
| `Right Sidebar` (`.sidebar-right*`, `.rs-section*`) | `layout/_sidebar-right.scss` |
| `.metric-row*`, `.metric-label`, `.metric-value*`, `.metric-bar-*`, `.bar-blue|green|yellow` | `components/_metric.scss` |
| `.perf-placeholder*` | `components/_perf-placeholder.scss` |
| `.turbo-card*` | `components/_turbo-card.scss` |
| `.hw-card`, `.hw-row*` | `components/_hw-card.scss` |
| `.log-box`, `.log-line*` | `components/_log-box.scss` |
| `Status Bar` (`.status-bar*`, `.ollama-indicator*`, `.status-sep-dot`, `.ollama-version*`, `.last-saved-text`) | `layout/_status-bar.scss` |
| `.save-btn` | `components/_buttons.scss` |
| `System placeholder`, `System Full View` | `pages/_system.scss` |
| `Agent Settings Page` (all `.as-*` selectors plus the inner `@media (max-width: 1100px)`) | `components/_agent-settings.scss`, with `.as-toggle` extracted to `components/_toggle.scss` and `.as-slider*` to `components/_slider.scss` |

### 7.4 Conversion rules during migration

1. **Do not rename selectors.** Every existing class continues to exist with
   the same name so JSX never has to change.
2. **Keep `var(--…)` references intact** inside rule bodies. Only top-level
   token catalogs become `$…` scalars; component CSS continues to reference
   custom properties so runtime theming and JSX inline styles stay
   consistent.
3. **Promote BEM/state classes to `&`-nested form.** E.g.:
   - `.nav-item.active` → `.nav-item { &.active { … } }`
   - `.win-btn.close:hover` → `.win-btn { &.close:hover { … } }`
   - `.model-dropdown-btn.is-open` → `.model-dropdown-btn { &.is-open { … } }`
4. **Promote `:hover` / `:focus` / `:active` / `:disabled` to `&:` nesting.**
5. **Each container query stays at the top level of its partial** (not nested
   inside a selector) to keep nesting depth ≤ 3.
6. **Replace inline `color-mix(in srgb, …)` calls verbatim** — they already
   work in modern Chromium (Electron 33 ships Chromium ≥ 130). No tinting
   function is needed.
7. **`@keyframes perf-shimmer`** is moved alongside the rule that uses it in
   `components/_model-card.scss`. No global `_animations.scss` partial is
   created — there's only one animation today.

---

## 8. Nesting & `&` Style Guide

These are hard rules. The Builder must enforce them in every partial.

### Rules

1. **Maximum nesting depth = 3.** Counting the outermost selector as level 1.
   ```scss
   // OK (depth 3)
   .agent-card {
     &__title { color: red; }                 // depth 2
     &:hover  { .agent-card__icon { … } }     // depth 3
   }
   ```
2. **Use `&` for:**
   - State pseudo-classes: `&:hover`, `&:focus`, `&:focus-visible`,
     `&:active`, `&:disabled`, `&:first-child`, `&:last-child`,
     `&::placeholder`, `&::after`, `&::before`.
   - State modifier classes: `&.is-open`, `&.is-active`, `&.selected`,
     `&.primary`, `&.green`, `&.red`, `&.tall`, etc.
   - BEM modifiers: `&--primary`, `&--small`.
   - BEM elements: `&__icon`, `&__title` (only where the existing class names
     already follow this pattern — do NOT retro-fit BEM where the code uses
     dash-separated names like `.agent-card-top`).
3. **Do NOT nest descendant selectors more than two levels deep.** If you
   need a third level, write a flat selector instead:
   ```scss
   // Bad
   .sidebar-left { .sidebar-nav { .nav-item { .nav-icon { … } } } }
   // Good
   .sidebar-left .sidebar-nav { … }
   .nav-item .nav-icon { … }
   ```
4. **Do NOT nest `@media` / `@container` inside selectors more than once.**
   Prefer top-of-partial breakpoint blocks when a partial has several:
   ```scss
   .agent-card { … }
   @media (min-width: 1024px) { .agent-card { … } }
   ```
5. **`@include breakpoint(lg) { … }` is allowed once per selector** (counts
   as one nesting level).
6. **Never nest unrelated selectors.** Each partial styles one component or
   one layout region; cross-cutting concerns live in mixins/placeholders.
7. **Order inside a rule block:**
   1. Local SCSS vars (`$_local`),
   2. `@include` mixin calls,
   3. Declarations,
   4. `&` nested rules,
   5. Descendant rules (rare),
   6. `@media` / `@container` queries.

---

## 9. Risks & Open Questions

### Top risks

1. **Electron renderer style loading.** Vite ships a single CSS bundle that
   Electron loads via `<link>` in the dev server HTML and via the built
   `dist/assets/*.css` in production. SCSS compiles to CSS at build time, so
   the renderer never sees `.scss` — there is **no Electron-specific risk**
   provided `sass` is installed before `npm run dev` is invoked. The Builder
   should still smoke-test `npm run electron:dev` and `npm run electron:build`.

2. **`:root` custom properties are consumed by JSX inline styles.** Files
   `RightSidebar.jsx` and `AgentSettingsPanel.jsx` reference `var(--text-dim)`,
   `var(--accent-green)`, `var(--text-primary)`, `var(--font-mono)`,
   `var(--bg-card)`, `var(--text-secondary)` inline. **Removing the `:root`
   declarations would silently break these styles** with no compile error.
   Mitigation: `base/_root.scss` is a verbatim copy of the existing
   `variables.css` `:root` block; SCSS variables are a parallel surface.

3. **`color-mix()` is used heavily.** `app.css` already calls
   `color-mix(in srgb, …)` on ~12 selectors. This requires Chromium ≥ 111
   (Electron 33 = Chromium 130, so fine). If the team ever lowers the
   Electron version below 24, these calls and any new ones from this refactor
   will silently fall back to the default value. Mitigation: do not lower
   Electron below 33 without a CSS audit.

### Open questions

- **Dark mode / theming need.** The current palette is dark-only. The
  `themes/_default.scss` partial is a hook for a future `:root[data-theme]`
  override but should ship with only the default theme. **Confirm with the
  designer whether a light theme is on the roadmap** before the Builder
  spends effort on theme-parameterising the colour map.
- **Container-query strategy elsewhere.** Only `.agent-grid` uses container
  queries today. Should `.model-grid` (`pages/_ollama-panel.scss`) also use
  container queries instead of its fixed `repeat(3, 1fr)`? Out of scope for
  this refactor; flag for follow-up.
- **`.system-full-view .sidebar-right` override** — this cross-cuts a layout
  partial from a page partial. Acceptable as documented in §7 (lives in
  `pages/_system.scss`), but the Builder should add a `// crossing-layer
  override:` comment so future readers don't move it.
- **`figma-nodes.json`** is present in the repo root. Out of scope for this
  refactor but worth confirming it isn't used to auto-generate any tokens
  before we finalise the catalog by hand.

---

## File path of this plan

`C:\Projects\opencode-model-gui\docs\scss-refactor-plan.md`
