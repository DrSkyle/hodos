---
name: Hodos
description: Global autonomous road hazard mapping and telemetry cartography
colors:
  primary: "#DE3618"
  primary-hover: "#C52D12"
  primary-bright: "#FF6647"
  bg-canvas: "#0B0E14"
  bg-surface: "#111622"
  bg-surface-elevated: "#182030"
  bg-card: "#141B29"
  bg-terminal: "#07090D"
  border-subtle: "#1E293B"
  border-prominent: "#334155"
  text-bright: "#F8FAFC"
  text-primary: "#E2E8F0"
  text-secondary: "#94A3B8"
  text-muted: "#94A3B8"
  hazard-pothole: "#FF6647"
  hazard-rough: "#F59E0B"
  hazard-hump: "#38BDF8"
  hazard-fixed: "#10B981"
  badge-bg: "rgba(255, 102, 71, 0.12)"
  white: "#FFFFFF"
typography:
  display:
    fontFamily: "Outfit, system-ui, sans-serif"
    fontSize: "3.75rem"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Outfit, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Outfit, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "0em"
  body-sm:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "0em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.02em"
---

# Design System: Obsidian Asphalt & Electric Telemetry

## Visual World

Hodos is an autonomous, global road surface intelligence network. It turns ambient vehicle movement into high-precision, verified cartography without human intervention. The visual world—**Obsidian Asphalt & Electric Telemetry**—captures the nocturnal precision of high-speed transit and laboratory-grade road vibration telemetry.

We abandon rustic highway stone and construction markers in favor of clean, contemporary dark cartography. The interface evokes the cockpit instruments of modern electric vehicles and high-density geospatial mapping platforms: deep obsidian roadbed grounds, luminous signal-coral and amber hazard vectors, and crisp monospace telemetry.

## Color Strategy

- **Canvas Ground (`#0B0E14`):** Deep, pure asphalt-black ground that minimizes glare, creates boundless contrast, and allows hazard points to radiate.
- **Card Surfaces (`#111622`, `#141B29`):** Sculpted dark slate containers with subtle 1px hairlines (`#1E293B`) separating information layers with razor-sharp clarity.
- **Electric Signal Coral (`#FF6647` for text/vectors, `#DE3618` for buttons):** High-visibility, modern, urgent without being aggressive. Meets 6.2:1 contrast against dark surfaces and 4.52:1 against white text in buttons.
- **Telemetry Amber (`#F59E0B`):** Represents rough pavement sections and caution noise-floor envelopes.
- **Pulse Cyan (`#38BDF8`):** Indicates speed humps, GPS fix status, and satellite telemetry lock.
- **Corroborated Emerald (`#10B981`):** Represents verified repairs and active background sensor sampling.
- **Text Hierarchy:** High-contrast off-white (`#F8FAFC`) for titles, neutral silver (`#E2E8F0`) for body, and muted slate (`#94A3B8`) for telemetry metadata. All combinations achieve minimum 5.5:1 contrast against their containers.

## Typography

- **Display & Headlines:** `Outfit` (`wght@700;800`). Modern, geometric, sculpted grotesque with circular curves and open counters. Confident and technical without archaic styling.
- **Body & Controls:** `DM Sans` (`wght@400;500;600`). Crisp geometric sans designed for extreme legibility across screens of all sizes.
- **Telemetry & Data:** `JetBrains Mono` (`wght@500;700`). Monospaced tabular numerals for coordinates (lat/lng), G-force thresholds, timestamps, and pass counts.

## Shapes & Geometry

- **Containers:** Crisp rounded rectangles (`border-radius: 12px` on cards, `8px` on control pills, `6px` on data badges).
- **Hairline Borders:** Exact 1px structural strokes (`#1E293B`) creating crystalline component delineation.
- **Interactive Buttons:** Solid coral pill for the primary action; translucent slate with hairline border for secondary actions.

## Components

- **Telemetry Masthead:** Sticky header featuring the authentic v1.1.20 master mark, live global catalog pill, clear navigation, and direct CTA to the live map.
- **Hero Telemetry Terminal:** Dual-panel command deck pairing direct, human developer copy on the left with an active interactive sensor oscilloscope canvas on the right.
- **Sensor Waveform Oscilloscope:** Real-time 60fps canvas tracing the vehicle's dynamic Median Absolute Deviation (MAD) noise floor against transient pothole jerk violations.
- **Proving Metric Matrix:** Ground-truth metrics highlighting the 438 verified hazards, 100% autonomous operation, 0 distractions, and 250m privacy perimeter.
- **Dual Licensing Matrix:** High-contrast split tablet contrasting the MIT software code against the community-safeguarded CC BY-NC-SA 4.0 hazard dataset.
- **Interactive Technical FAQ:** Crisp accessible `<details>` elements with smooth CSS reveal.

## Browser Surfaces

- **Selection:** Glowing coral background (`#DE3618`) with bright white text (`#FFFFFF`).
- **Focus Rings:** Distinct 2px electric coral outline with 2px offset (`#FF6647`).
- **Scrollbars:** Sleek 6px obsidian track with subtle slate thumb (`#334155`).

## Durable Commitments

- Zero emojis anywhere in UI code, maps, or badges.
- 100% silent phone operation (no haptics or vibration).
- Real verified data only; zero artificial demo corridors.
- Global positioning: built for road travelers everywhere in the world.
