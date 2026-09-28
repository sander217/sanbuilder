# Pill controls and indicators

Rule ID: `UI-PILL-001` — pills do not contain dot markers.

Applies whenever a product renders a status, filter, version, option, tag, chip, or segmented-control item as a pill/capsule. It applies in every interaction state, including default, hover, selected, active, focus, focus-visible, disabled, loading, and error.

## Design requirements

- Never place a standalone circular dot, bullet, status light, or decorative round marker inside a pill. Do not add one through an icon, pseudo-element, background layer, or state animation.
- Focus and focus-visible states use the product's accessible outer focus ring or outline. A dot inside the pill is not a focus treatment.
- Selected and active states use the approved combination of fill, border, text emphasis, label, or a meaningful non-dot icon. Preserve a non-color cue and the correct programmatic state such as `aria-pressed`, `aria-selected`, or the native control state.
- Status pills communicate through explicit text and, when useful, a meaningful non-dot icon or count. Do not rely on a colored dot or color alone.
- A content-specific icon, avatar, spinner, or logo is not a dot marker, but it must carry real meaning and must not collapse into a generic circular selection/status decoration. When a notification indicator is required, keep it outside the pill and document the relationship.
- Keep the pill's content alignment and spacing stable across states. Removing the dot must not leave a phantom gap or cause the label to jump.

## Design and product QA

For work that creates or changes pills, inspect all rendered states at supported viewports and text scales. Check the DOM and CSS pseudo-elements as well as screenshots. Pass only when no pill gains a dot marker on focus, blur, selection, deselection, loading, or status changes; focus remains visible and selection/status remains understandable without color alone.

Record product-specific pill variants or exceptions in the owning Contract Pack. Do not infer a dot exception from existing production drift; propose it for explicit human review.
