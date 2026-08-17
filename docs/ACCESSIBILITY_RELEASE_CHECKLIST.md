# CF Mail Accessibility Release Gate

Automated gates cover keyboard focus visibility, reduced-motion support, minimum control size tokens, localization/screenshot identifiers, and source-level regressions. Before each App Store release, perform the following device/browser checks:

- iOS: Dynamic Type at accessibility sizes; VoiceOver on Inbox, Message Detail, Compose, Settings, Pro; Reduce Motion; Differentiate Without Color; landscape iPad keyboard navigation.
- Web: keyboard-only login/mail/admin navigation; visible focus; Escape/dialog behavior; screen-reader labels on form controls; 200% zoom; Polar/Mono/OLED contrast.
- Destructive actions must announce scope (message/account/server/global) and require an explicit confirmation.
- Mono must not use color as the only status channel.

A release candidate is blocked if a core workflow cannot be completed without sight or without a pointer device.
