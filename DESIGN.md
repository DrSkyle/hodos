---
name: Hodos
description: Global autonomous road hazard mapping and pavement intelligence
colors:
  primary: "#F5B800"
  primary-hover: "#E0A700"
  neutral-bg: "#F4F3EE"
  neutral-surface: "#FAF9F6"
  neutral-card: "#FFFFFF"
  dark-asphalt: "#111417"
  dark-stone: "#1B1F24"
  dark-border: "#2D343D"
  ink: "#111316"
  ink-secondary: "#424953"
  ink-muted: "#636B76"
  defect-pothole: "#D9381E"
  defect-rough: "#D97706"
  defect-hump: "#1D4ED8"
  defect-fixed: "#15803D"
  border-stone: "#D5D1C6"
  border-strong: "#A8A396"
typography:
  display:
    fontFamily: "Barlow Semi Condensed, -apple-system, sans-serif"
    fontSize: "3.5rem"
    fontWeight: 900
    lineHeight: 1.02
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Barlow Semi Condensed, -apple-system, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 900
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Barlow Semi Condensed, -apple-system, sans-serif"
    fontSize: "1.45rem"
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: "0.02em"
  body:
    fontFamily: "Barlow, system-ui, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "0em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0.04em"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  pillar: "24px 24px 8px 8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  xxl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "14px 26px"
  button-stone:
    backgroundColor: "{colors.neutral-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "14px 24px"
  card-monolith:
    backgroundColor: "{colors.neutral-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "24px"
---

# Design System: Highway Milestone & Survey Monolith

<!-- impeccable:design-schema 1 -->

## Overview

The Hodos visual world draws its authority from national highway milestone pillars, geodetic survey monuments, and mechanical chassis diagnostic benches. Road conditions are an unyielding physical reality, not abstract cloud software. This system replaces generic SaaS gradients and rounded floating cards with heavy stone silhouettes, highway caution chrome yellow, deep asphalt black, and chiseled tabular typography.

## Colors

- **Highway Caution Yellow (`#F5B800`):** Primary action color. Authoritative road signage yellow used for primary callouts, milestone caps, active filters, and text selection. Hover shifts to `#E0A700`.
- **Weathered Concrete Ground (`#F4F3EE`):** Matte stone ground establishing high readability without optical glare.
- **Deep Asphalt Black (`#111417`):** Roadbed black used for telemetry consoles, section headers, and high-contrast stone borders.
- **Pitch Ink (`#111316`):** Deepest body text color ensuring WCAG AA / AAA contrast (>12:1 against light stone grounds).
- **Hazard Defect Signals:**
  - Pothole / Severe Shock: `#D9381E` (Survey Marker Red)
  - Rough Road Pavement: `#D97706` (Caution Amber)
  - Speed Hump / Control Point: `#1D4ED8` (Survey Cobalt)
  - Repaired Road: `#15803D` (Fixed Green)

## Typography

- **Display & Headings:** `Barlow Semi Condensed` (weights 700 to 900). Chiseled, industrial, and bold with uppercase tracking. Conveys highway signage permanence.
- **Body & Prose:** `Barlow` (weights 400 to 600). Modeled after California highway lettering and public transit signage. Clean, legible, and highly functional.
- **Telemetry & Coordinates:** `JetBrains Mono` with `font-variant-numeric: tabular-nums`. Used for GPS coordinates, jerk G/s thresholds, timestamps, and route manifests.

## Layout

- **Width Constraint:** `width: min(1200px, calc(100% - 48px)); margin-inline: auto;`.
- **Split Hero Grid:** Asymmetric `1.15fr 0.85fr` layout anchoring primary action copy beside the physical milestone monolith pillar card.
- **Traverse Strip:** Full-width dark asphalt transit strip with dashed progress rules representing continuous highway kilometers.
- **Defect Ledger Drawer:** Floating technical slide-out drawer (`380px` wide) on the interactive map with coordinate search and instant fly-to navigation.

## Elevation & Depth

- **Tactile Stone Offsets:** No zero-offset decorative blur halos. Cards and buttons carry directional stone bevel shadows (`box-shadow: 0 3px 0 var(--milestone-black)` or `box-shadow: 0 4px 0 var(--stone-border-strong)`).
- **2px Chiseled Borders:** High-contrast 2px solid borders (`var(--ink)`) define the silhouette of milestone caps and primary cards.

## Shapes

- **Milestone Pillar Container:** Arched upper corners with flat lower stone base (`border-radius: 24px 24px 8px 8px`).
- **Highway Route Badges:** Compact rectangular pills (`border-radius: 4px`) carrying route manifests and GPS coordinates.
- **Buttons:** Crisp, beveled rectangular forms (`border-radius: 6px`).

## Components

- **Milestone Masthead:** Sticky header featuring the authentic v1.1.20 master mark, industrial uppercase title, and live global status indicator.
- **Pillar Monolith Card:** Signature physical card featuring a yellow highway cap (`GLOBAL REGISTRY`), central large-number hazard metric (`438`), and a 3-column defect breakdown box.
- **Interactive Telemetry Deck:** Diagnostic oscilloscope monitor rendering real-time accelerometer jerk traces against calibrated MAD noise floor dashed thresholds.
- **Dual-Licensing Tablet:** Two high-contrast monolith cards contrasting open-source software (MIT) against community-protected crowdsourced road telemetry (CC BY-NC-SA 4.0).
- **Interactive Web Map:** Carto Positron raster basemap with high-contrast milestone defect markers (potholes, rough road, humps) and structured maintenance dispatch popups.

## Do's and Don'ts

### Do
- Do maintain WCAG AA contrast (minimum 4.5:1 for body copy and 3:1 for display).
- Do use tabular numerals for all GPS coordinates and defect counters.
- Do use authentic SVG icon vectors with 2.5px consistent stroke weight.
- Do keep phone interactions 100% silent (no vibration, no intrusive haptics).

### Don't
- Never use green/yellow/red circle emojis (`🟢`, `🟡`, `🔴`) or decorative emojis in code, maps, or UI.
- Never use kickers or eyebrows above headings. Headings carry their own weight.
- Never use gradient text or soft decorative glassmorphism blur.
- Never display mock or simulated hazard corridors on public maps; show only verified ground-truth data.
