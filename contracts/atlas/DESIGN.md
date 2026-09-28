# Atlas Brand Design Contract

Atlas is fictional starter data. Replace this contract before a real delivery run.

## Principles

- Make the user's content the visual anchor.
- Use one clear primary action per decision point.
- Prefer calm, information-rich layouts over decorative surfaces.
- Make automation state, consequence, cancellation, and recovery visible.

## Tokens

- Color: neutral canvas, high-contrast text, one product accent, semantic status colors.
- Type: one interface family with distinct body, label, and display roles.
- Space: use a consistent four-point base scale.
- Motion: explain state change; respect reduced motion preferences.

## Accessibility

All production experiences target WCAG 2.2 AA, full keyboard operation, visible focus, useful names, and non-color status cues.

## Page headers and navigation

Apply [UI-NAV-001](../../skills/design-harness-agent/references/navigation-stability.md) to related pages. Use shared header geometry, typography, and reserved back/action slots so title position and row height remain consistent through forward/back navigation and loading. Compare like viewport, safe area, text scale, locale, and scroll states. Define accessible long-title and intentional header-variant behavior explicitly. Navigation QA includes a transition recording or frame sequence as well as settled-page comparisons.

## Pills and chips

Apply [UI-PILL-001](../../skills/design-harness-agent/references/pill-controls.md) to pill-shaped statuses, filters, tags, chips, and options. Never place a standalone dot marker inside a pill, whether focused or unfocused, selected or unselected. Use an outer focus ring for keyboard focus and accessible fill, border, text, label, or meaningful non-dot icon treatments for selection and status. Keep content alignment stable across states.

## Control and menu edge spacing

Apply [UI-EDGE-001](../../skills/design-harness-agent/references/control-edge-spacing.md) to dropdowns, chip dropdowns, buttons, and opened menus. Keep the trigger, hit area, and focus outline inside the relevant viewport or container gutter; a full-width control still uses the inset content width. Reposition or constrain opened menus before they clip a safe-area or container edge. Define product-specific gutter tokens before delivery and check both closed and expanded states at narrow/wide viewports.

## Responsive destinations and entries

Apply [UI-RESP-001](../../skills/design-harness-agent/references/responsive-entry-coverage.md) when web work changes a destination or navigation path. Map each affected destination and essential action to a discoverable desktop and mobile-web entry. The placement may adapt, but an entry cannot silently vanish in a collapsed mobile layout. Review both viewport proposals and exercise both paths in product QA; document any intentional platform-specific omission for human approval.

## Icon and label balance

Apply [UI-ICON-001](../../skills/design-harness-agent/references/icon-label-alignment.md) to icons paired with text in links, buttons, navigation, chips, menus, and header actions. Match the icon's apparent stroke weight to its label; vertically align their optical centers and center the pair within its interactive row. Inspect the rendered result at supported sizes and states, not only the CSS box alignment.
