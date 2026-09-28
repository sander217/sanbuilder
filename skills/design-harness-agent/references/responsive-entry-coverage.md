# Responsive destination and entry coverage

Rule ID: `UI-RESP-001` — a responsive web experience keeps affected destinations and essential actions discoverable and reachable on both desktop and mobile web.

This rule applies when designing, implementing, or reviewing a web page, journey, navigation, or feature that changes how users reach a destination. It concerns the supported viewports of the same web product; it does not silently add a separate native mobile app to scope.

## Design requirements

- Before approving a web direction, inventory the affected destinations, entry points, and essential actions. Show where each is reached on desktop and mobile web, including collapsed navigation, overflow menus, account menus, footers, or other product-native patterns. An entry point that disappears at a breakpoint without an equivalent usable route is incomplete.
- Adapt placement and hierarchy to the device; pixel-for-pixel or identical navigation is not required. Preserve a clear label, understandable path, and appropriate touch/keyboard access. Do not hide a destination merely to make the mobile layout fit.
- An intentional platform-specific omission needs an explicit product-contract reason and human review. A desktop-only mockup, CSS-hidden link, or undocumented assumption is not that decision.
- Keep the affected route and its entry path in the proposal's responsive matrix and acceptance criteria. An informational destination such as About counts when it is part of the affected navigation; it cannot be treated as optional solely because the mobile header has less room.

## Design and product QA

For affected journeys, record a compact desktop/mobile entry map: destination, desktop entry/path, mobile entry/path, and any approved exception. Inspect the proposal at representative supported desktop and mobile widths before approval. In product QA, use the actual running web app at those widths and exercise each path from its starting screen through the destination and back; check collapsed menus, touch and keyboard access, and relevant loading/auth states. A mobile screenshot of the destination alone does not prove its entry point is discoverable. Fail the existing blocking responsive or experience-completeness check when an affected destination or essential action is unreachable on a supported viewport. Scope this check to affected navigation and journeys, not an unrelated whole-site audit on every minor visual edit.

The owner reported a missing mobile-web entry to an About page as one example of this failure mode. That observation does not establish the affected product's identity or prove its production UI has been fixed. The owning product contract must define supported viewports and any reviewed exceptions.
