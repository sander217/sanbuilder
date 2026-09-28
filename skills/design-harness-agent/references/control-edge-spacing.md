# Control and menu edge spacing

Rule ID: `UI-EDGE-001` — interactive controls and their opened menus keep a usable distance from edges.

Applies to dropdown/select triggers, chip dropdowns, filter chips that open menus, icon/text buttons, and similar tappable controls on Web, Mobile, Console, and application-style game screens. Check the trigger and the opened menu separately. An edge may be the viewport/safe area or the containing card, panel, dialog, sheet, or toolbar.

## Design requirements

- Place control bounds inside the content gutter of their containing surface; the control border, hit area, and focus indication must not touch or be clipped by that edge. A full-width control fills the inset content area, not the entire screen or panel. Apply the same rule to a pill/chip that opens a dropdown; its shape does not exempt it.
- Use one named spacing token per layout context instead of a per-control margin patch. As a starting point, Google's Material guidance uses 16dp horizontal screen margins on phones and 24dp on tablets, and 16dp/24dp for simple menu surfaces. Adopt product-native tokens for Web/Desktop and nested containers; do not silently treat those Material values as universal pixels or apply the menu-surface measurement to every trigger.
- An opened menu/popover stays fully visible inside the viewport safe area with a deliberate outer gutter. Near an edge, flip, shift, constrain its width/height, or use a suitable sheet/dialog pattern; do not let items, shadows, focus outlines, or dismissal access clip off-screen. Keep its visual relationship to the trigger clear.
- Respect safe-area/system insets, browser zoom, text enlargement, localization, right-to-left layout, and narrow windows. Reserve room for the focus ring outside the control; internal padding alone does not create the required external gutter.
- Edge-to-edge backgrounds or full-bleed media may remain full-bleed, but actionable controls on top of them still use a safe inset unless an explicitly reviewed product pattern defines an equivalent protected action area.

## Design and product QA

For an affected control, identify the containing edge and adopted gutter token. At supported narrow/wide viewports, zoom/text scales, and RTL where applicable, measure the rendered trigger/hit area and focus outline against that edge, then open the menu near every relevant viewport/container edge. Record bounds and screenshots for closed, focused, and expanded states. Fail the affected responsive/visual check if the control or menu touches/clips the edge, if the menu becomes unreachable, or if a chip dropdown bypasses the same gutter. A cropped reference image alone cannot establish the original page's exact offset; inspect the real layout before judging implementation.

## Source and authority

Google Material's [metrics and keylines](https://m1.material.io/layout/metrics-keylines.html) give 16dp mobile and 24dp tablet screen-margin examples; its [menu guidance](https://m1.material.io/components/menus.html) specifies 16dp/24dp side margins for simple menus and repositioning near edges. These are precedents for the safety principle, not the Harness's universal Web spacing tokens. The owning Contract Pack defines product tokens, any reviewed exception, and the QA mapping.
