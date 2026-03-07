# ScribeSnap — Design System Rules (Figma Integration)

## Project Overview
ScribeSnap is a YouTube/multi-platform transcript extractor SPA. The frontend is a single-file React 18 app (`client/src/App.js`, ~4,900 lines) with a hybrid inline-styles + CSS-class approach. There is no external component library (no MUI, Chakra, etc.).

---

## 1. Design Tokens

All design tokens live in **`client/src/App.js`** at the top of the file.

### Color Palette — `const P`
```js
const P = {
  paper:       '#F6F2EA',               // Page/input background (warm off-white)
  surface:     '#FFFFFF',               // Cards, modals, containers
  border:      '#E6E0D6',               // Dividers, input borders
  ink:         '#1D1D1F',               // Primary text
  muted:       '#8B8F97',               // Secondary/placeholder text
  accent:      '#3C8CFF',               // CTA buttons, active states
  accentHover: '#1F6BFF',               // Hover state for accent
  accentLight: 'rgba(123,211,255,0.18)',// Accent overlays/badge backgrounds
  success:     '#0F766E',               // Success messages
  warning:     '#B45309',               // Warnings
  error:       '#B42318',               // Errors / destructive actions
};
```

> **Rule:** Always reference `P.*` for colors. Never hardcode hex values unless creating a one-off brand color from `PLATFORM_BRAND`.

### Platform Brand Colors — `const PLATFORM_BRAND`
```js
const PLATFORM_BRAND = {
  youtube:     { icon: '#FF0000', stat: '#1F6BFF', bg: 'rgba(123,211,255,0.22)', bgSoft: 'rgba(123,211,255,0.18)' },
  vimeo:       { icon: '#1AB7EA', stat: '#3C8CFF', bg: 'rgba(60,140,255,0.16)',  bgSoft: 'rgba(60,140,255,0.14)' },
  tiktok:      { icon: '#010101', stat: '#FF0050', bg: 'rgba(255,0,80,0.10)',    bgSoft: 'rgba(255,0,80,0.08)'  },
  twitter:     { icon: '#000000', stat: '#1D9BF0', bg: 'rgba(29,155,240,0.12)', bgSoft: 'rgba(29,155,240,0.09)' },
  instagram:   { icon: '#E1306C', stat: '#C13584', bg: 'rgba(193,53,132,0.12)', bgSoft: 'rgba(193,53,132,0.09)' },
  dailymotion: { icon: '#00B4F0', stat: '#0065A3', bg: 'rgba(0,101,163,0.12)',  bgSoft: 'rgba(0,101,163,0.09)'  },
  facebook:    { icon: '#1877F2', stat: '#1877F2', bg: 'rgba(24,119,242,0.12)', bgSoft: 'rgba(24,119,242,0.09)' },
  loom:        { icon: '#625DF5', stat: '#625DF5', bg: 'rgba(98,93,245,0.12)',  bgSoft: 'rgba(98,93,245,0.09)'  },
  wistia:      { icon: '#54ABCC', stat: '#54ABCC', bg: 'rgba(84,171,204,0.12)', bgSoft: 'rgba(84,171,204,0.09)' },
};
```

---

## 2. Typography

**Font family:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
Always use `fontFamily: 'inherit'` on inputs/buttons so they pick up the system font.

### Size Scale
| Role | Size | Weight |
|------|------|--------|
| Page title / display | 26px | 800 |
| Section heading | 16–18px | 700 |
| Card / modal title | 15px | 700 |
| Body text / inputs | 14px | 400–500 |
| Secondary / compact body | 13px | 400–500 |
| Captions / metadata | 12px | 500–600 |
| Labels / tags / badges | 10–11px | 600, `textTransform: uppercase`, `letterSpacing: '0.05em'` |
| Stat values (dashboard) | 30px | 700 |

### Letter Spacing
- Display headings: `letterSpacing: '-0.03em'`
- Labels/tags: `letterSpacing: '0.05em'`

---

## 3. Spacing

There is no formal spacing scale — values are chosen contextually. Common values in use:

| Usage | Value |
|-------|-------|
| Micro gap / icon margin | 2–4px |
| Compact gap | 6–8px |
| Standard gap / padding | 10–12px |
| Button padding (lg) | `11px 14px` – `14px 20px` |
| Card padding | 18–22px |
| Section padding | 24–32px |
| Page padding (desktop) | 36–44px |
| Page padding (mobile) | 16–20px |

### Border Radius
| Shape | Value |
|-------|-------|
| Input / small button | 8–10px |
| Card / large button | 12–14px |
| Modal | 16–18px |
| Pill / badge | 999px |

---

## 4. Styling Approach

### Primary: Inline Styles
All component styles are written as inline React style objects:
```jsx
<div style={{
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 14px',
  borderRadius: 10,
  border: `1px solid ${P.border}`,
  background: P.surface,
  color: P.ink,
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
  transition: 'all 0.15s',
}}>
```

### Secondary: Injected CSS Classes
Used for:
- Layout systems (CSS Grid, Flexbox containers)
- Responsive media queries
- Keyframe animations
- Scrollbar styling
- Global resets

CSS classes follow a **BEM-like** naming convention: `.ds-{component}`, `.ds-{component}-{element}`, `.ds-{component}.is-{state}`.

The `<style>` tag is injected in JSX near line 3470 of App.js. Add new global styles there.

### Hover States
Hover effects are implemented with `onMouseEnter` / `onMouseLeave`:
```jsx
onMouseEnter={e => { e.currentTarget.style.background = P.paper; }}
onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
```

> **Note:** Tailwind CSS is installed but **not used**. Do not add Tailwind utility classes.

---

## 5. Component Patterns

### Buttons

**Primary (accent):**
```jsx
<button style={{
  padding: '10px 16px', borderRadius: 10, border: 'none',
  background: P.accent, color: '#fff',
  fontWeight: 600, fontSize: 14, cursor: 'pointer',
  transition: 'background 0.15s',
}}
  onMouseEnter={e => e.currentTarget.style.background = P.accentHover}
  onMouseLeave={e => e.currentTarget.style.background = P.accent}
>
  Label
</button>
```

**Secondary / ghost:**
```jsx
<button style={{
  padding: '8px 14px', borderRadius: 8,
  border: `1px solid ${P.border}`, background: 'transparent',
  color: P.ink, fontWeight: 500, fontSize: 13,
  cursor: 'pointer', transition: 'all 0.15s',
}}>
  Label
</button>
```

### Cards
```jsx
<div style={{
  background: P.surface,
  border: `1px solid ${P.border}`,
  borderRadius: 14,
  padding: 20,
}}>
```

### Inputs
```jsx
<input style={{
  width: '100%', padding: '11px 13px', borderRadius: 10,
  border: `1px solid ${P.border}`, background: P.paper,
  fontSize: 14, color: P.ink, outline: 'none',
  transition: 'border-color 0.15s', fontFamily: 'inherit',
}} />
```

### Badges / Tags
```jsx
<span style={{
  display: 'inline-flex', alignItems: 'center',
  padding: '3px 9px', borderRadius: 999,
  background: P.accentLight, color: P.accent,
  fontSize: 11, fontWeight: 600,
  letterSpacing: '0.04em', textTransform: 'uppercase',
}}>
  Label
</span>
```

---

## 6. Icon System

All icons are **inline SVG functional components** in App.js (lines ~395–493).

```jsx
const DownloadIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    ...
  </svg>
);
```

**Rules:**
- Use `stroke="currentColor"` so icons inherit color from their container.
- Accept a `size` prop (default typically 14–18px).
- Define new icons as components at the top of App.js near the existing icon definitions.
- No external icon library should be added.

**Platform icons:** Use `<PlatformIcon platform="youtube" size={18} />` for platform-specific icons.

---

## 7. Animations

### Available Keyframes (injected in `<style>` tag)
| Animation | Usage |
|-----------|-------|
| `spin` | Loading spinners |
| `fadeUp` | Modal/panel entrance |
| `bounce` | Attention effects |
| `pulse` | Pulsing indicators |
| `shimmer` | Skeleton loading |
| `dot-flicker` | Dot loader |
| `marquee` | Scrolling text banner |
| `logoFlipOut/In` | Logo 3D transition |
| `tabHighlight` | Tab focus ring |

### Transitions
```js
transition: 'all 0.15s'                           // Fast UI feedback
transition: 'all 0.2s'                            // Standard
transition: 'background 0.12s ease'               // Specific property
transition: 'width 0.5s cubic-bezier(0.4,0,0.2,1)' // Progress/motion
```

---

## 8. Responsive Design

### Breakpoints (JavaScript)
```js
const MOBILE_BREAKPOINT = 640;   // px
const TABLET_BREAKPOINT = 1024;  // px

const isMobile  = windowWidth < 640;
const isTablet  = windowWidth >= 640 && windowWidth < 1024;
const isDesktop = windowWidth >= 1024;
```

### Media Query Reference
```css
@media (max-width: 1130px) { /* Large tablet */ }
@media (max-width: 1023px) { /* Tablet */ }
@media (max-width: 900px)  { /* Mobile dashboard switch */ }
@media (max-width: 639px)  { /* Mobile */ }
@media (max-width: 520px)  { /* Small mobile */ }
@media (max-width: 420px)  { /* Very small mobile */ }
```

### Pattern
Use `isMobile`/`isTablet`/`isDesktop` for conditional JSX rendering. Use CSS media queries (in the injected `<style>` tag) for layout shifts, padding reductions, and hiding/showing elements.

---

## 9. Asset References

All assets are in `client/public/` and referenced via root-relative paths:
```html
<img src="/scribesnap_icon_wave.svg" alt="ScribeSnap" />
<img src="/scribesnap_logo_wave.svg" alt="ScribeSnap" />
```

Key assets:
| File | Usage |
|------|-------|
| `/scribesnap_icon_wave.svg` | Favicon, compact logo |
| `/scribesnap_logo_wave.svg` | Full logo with wave |
| `/scribesnap_name_logo__closer.svg` | Wordmark (dark) |
| `/scribesnap_name_logo__gray.svg` | Wordmark (gray/footer) |
| `/scribesnap_wordmark_footer.svg` | Footer wordmark |

---

## 10. Figma → Code Mapping

When implementing Figma designs in this codebase:

1. **Colors:** Map Figma color tokens to `P.*` values. Do not hardcode hex values.
2. **Typography:** Match Figma font sizes/weights to the scale in section 2.
3. **Spacing:** Use the values in section 3; prefer even numbers.
4. **Components:** Implement as inline-style JSX within App.js. Define local style objects (e.g., `const cardStyle = {...}`) for readability.
5. **Icons:** Add as inline SVG components near line 395 in App.js.
6. **Animations:** Add new keyframes to the injected `<style>` tag near line 3470.
7. **Responsive:** Implement responsive behavior using the `isMobile`/`isDesktop` JS variables plus CSS media queries in the `<style>` tag.
8. **No new files:** Keep all UI code in `client/src/App.js` unless creating a completely new route/page.

---

## 11. File Locations

| Concern | File | Location hint |
|---------|------|---------------|
| Design tokens (`P`, `PLATFORM_BRAND`) | `client/src/App.js` | Lines 10–22, 176–186 |
| Icon components | `client/src/App.js` | Lines ~395–493 |
| Global CSS / keyframes | `client/src/App.js` | `<style>` tag ~line 3470 |
| React state | `client/src/App.js` | ~Line 2760 |
| Fetch / AI calls | `client/src/App.js` | ~Line 3370 |
| Insights panel UI | `client/src/App.js` | ~Line 4620 |
| Flashcard modal UI | `client/src/App.js` | ~Line 4843 |
| Backend AI endpoints | `server.js` | Lines 580+ |
| Supabase client | `client/src/supabase.js` | Full file |