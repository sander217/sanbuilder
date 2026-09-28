# Icon and label visual balance

Rule ID: `UI-ICON-001` — an icon paired with text has matching visual weight and one aligned center.

Applies to icon-and-label links, buttons, navigation items, chips, menu items, and header actions on supported Web, Mobile, Console, and application-style game surfaces. This includes arrows paired with a text label. It does not require an icon-only control or an unrelated illustration to imitate text strokes.

## Design requirements

- Choose or adjust the icon so its **apparent stroke weight** matches the adjacent label at the rendered size and font weight. A hairline arrow beside a medium or bold label, or a heavy icon beside light text, is not acceptable. Compare the actual pixels; a CSS `font-weight` number and an SVG `stroke-width` number are not directly equivalent.
- Vertically center the icon and label against one another, then center the pair within its interactive row or hit area. Check the **optical** center as well as the element boxes: an asymmetric arrow can look low even with `align-items: center`. Use a consistent component-level size, line-height, gap, and optical offset where needed, rather than page-specific margin patches.
- Preserve the intended horizontal placement of the control in its layout. Centering the icon and label as a pair does not mean moving a back link or navigation item to the middle of the page.
- Keep the match through default, hover, focus, active, disabled, loading, responsive, and enlarged-text states. Do not change icon size or position in a way that makes the label jump. Maintain accessible names and visible focus.

## Design and product QA

Inspect the icon-label pair at its real rendered size in the proposal and running product. Compare apparent stroke weight, icon center against the text's visual center, pair center within the hit area, and spacing in affected states and supported viewports. Include text enlargement and localization when they change line height or label length. Record a close crop and a normal-context screenshot; fail the affected visual/design-system check when an icon looks conspicuously thinner or heavier than its label, sits above/below it, or leaves the pair off-center. A screenshot is evidence of the reported mismatch, not a measured universal pixel offset; the owning product defines its component geometry.
