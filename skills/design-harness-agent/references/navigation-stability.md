# Page headers and navigation stability

Rule ID: `UI-NAV-001` — page titles stay aligned when navigating.

Applies to Web, Mobile, and Console page headers, and to game menus, settings, and other application-style screens. Compare pages in the same navigation family at the same viewport, safe-area inset, text scale, locale, and scroll/header state. Products may use different approved header variants; this rule does not prescribe one pixel height for every platform.

## Design requirements

- Use a shared page-header component and geometry tokens within each navigation family: safe-area/top inset, header row height, title start position and baseline, title typography/line height, and back/action slot sizes and alignment.
- Navigating forward or back must preserve those anchors. Changing a title, adding/removing a back button or action, or changing the body content must not shift the title up/down or sideways. Reserve the needed control slots; do not use per-page margin fixes.
- Keep descriptions, profile summaries, cards, and other page-specific content below the header. Their presence and asynchronous loading must not change the header's position or reserved region. Reserve font/icon space before loading completes.
- Inspect both settled pages and the transition itself. An intentional route animation may move the header smoothly, but the initial layout, destination layout, and return must not snap or reflow. Reduced-motion navigation must land on the same anchors without an animation-dependent correction.
- Specify long-title, localization, and enlarged-text behavior as part of the shared component. Allow accessible wrapping or a documented responsive variant where needed; never clip text, shrink it per page, or disable text scaling to force a fixed height. Keep the first-line anchor consistent and account for the extra space intentionally.
- A large-title, collapsed, fullscreen, or other different header variant needs an explicit product-contract reason and defined transition. A different page name alone is not a reason for a different header geometry. Compare collapsed/expanded variants at matching scroll states.

## Design and product QA

For work affecting navigation or a header, identify the actual source/destination routes and reverse path from product code. In design QA, compare the header geometry across the proposed screens and states. In product QA:

1. Open each related page at matching viewport, safe area, text scale, locale, and scroll position. Record header bounds, title start/baseline, and back/action alignment relative to the shared app shell, not to differently cropped screenshots.
2. Exercise forward navigation and back, including browser/native back where supported. Capture before/after comparisons and a recording or frame sequence across the transition; two static screenshots alone cannot prove the absence of a jump.
3. Repeat through loading-to-ready, empty, error/retry, and delayed fonts/icons where applicable. Test representative narrow/wide viewports, long localized titles, enlarged text, and reduced motion.
4. Pass only when equivalent header variants have matching anchors and reserved heights, with no unintended jump during navigation or settling. Subpixel rasterization alone is not a layout defect; different CSS geometry is. An intentional variant must follow the documented transition and remain accessible.

Record route pairs, conditions, measured positions, and evidence in the existing design/product QA artifacts. Map the result to the pinned pack's `navigation-stability` gate when present, otherwise to its relevant blocking responsive or experience gate. Missing runtime evidence is not a product pass; propose an explicit pack QA gate if no applicable gate exists. Scope the test to affected navigation, and do not use this rule to expand unrelated product work.

## Maintenance

This is the shared pipeline baseline. Each private Contract Pack owns its brand-specific adoption, exceptions, and QA policy. Introduce or change those through its reviewed contract PR. Onboarding products inherit the requirement when their contracts are completed; a baseline rule alone does not enable delivery.
