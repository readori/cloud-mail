# CF Mail iOS Architecture Decomposition Policy

## Audit closure

The former multi-domain files were split without changing user-facing behavior:

- `AppSettingsHubView.swift` is now a navigation shell; account, mail, appearance/privacy, and advanced/about settings are separate source files.
- `AdminConsoleView.swift` is now a navigation shell; analytics/users, all-mail, roles, and invite-code features are separate source files.
- `RichTextEditor.swift` now owns editor state/commands; the UIKit representable and SwiftUI toolbar are separate source files.
- `DMCard.swift` now owns the card primitive; brand, empty-state, and settings components are separate source files.
- `MailCore2SMTPEngine` is separated from the IMAP engine; IMAP mapping/codec/flag support is now isolated in `MailCore2IMAPSupport.swift`, leaving the primary engine below the architecture-review threshold.
- `PushNotificationManager` is split into lifecycle/authorization, local notifications, CloudMail registration/preferences, navigation, and `UNUserNotificationCenterDelegate` modules; gateway HTTP/App-Attest behavior remains isolated in `CFMailPushGatewayClient` and `AppAttestCoordinator`.
- Unreachable legacy Compose/Inbox/Detail views and view models were removed.

## No-growth architecture gate

Existing single-feature files above 500 lines are explicitly grandfathered in `mail-ios/scripts/swift_large_file_baseline.txt` at their audited line count. CI fails if:

1. a new production Swift file exceeds 500 lines;
2. a grandfathered file grows beyond its audited cap; or
3. a refactored file drops below 500 lines but its exception is not removed.

The 500-line threshold is a review/governance trigger, not a claim that line count alone defines architecture quality. New responsibilities must be placed in independently testable services/views rather than appended to the remaining large files.
