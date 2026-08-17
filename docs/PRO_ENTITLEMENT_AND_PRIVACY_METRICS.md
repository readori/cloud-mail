# CF Mail Pro Entitlement and Privacy-Safe Metrics Policy

## Product principle

Core mail remains a useful free product. Existing free limits (including standard-mail account limits) must not be abruptly reduced merely to force conversion. Pro should increasingly be anchored on power-user automation, identity, advanced search/offline policy, notification policy, customization, and advanced diagnostics rather than only “unlimited account count”.

## Candidate power-feature domains

- Automation: advanced scheduled-send policy, rules, snooze presets, bulk actions.
- Identity: multiple signatures/identities and account/domain rules.
- Search / offline: extended indexes, cross-account advanced search, configurable offline policy.
- Notifications: VIP/rule profiles, quiet-hour profiles, account-level badge policy.
- Customization: complete theme packs, density/layout/account visual grouping.
- Admin / Power: advanced diagnostics exports, reusable CloudMail rule/power settings.

These are product-roadmap anchors. A feature must not be advertised as Pro until its actual gate and behavior exist in the shipping build.

## Current plan presentation

Annual remains the default highlighted plan; Monthly is the lower-commitment entry; Lifetime is the ownership option. Weekly remains available until real funnel data justifies removal or a different emphasis. Do not manufacture funnel conclusions in code.

## Privacy-safe funnel events

The product can evaluate plan presentation without an advertising tracker by combining App Store Analytics, StoreKit subscription events, and explicitly opt-in anonymous product events.

Allowed examples:

```text
paywall_view
plan_selected(product_id)
purchase_result(product_id,result_category)
restore_result
account_add_success(provider_type)
first_sync_success(provider_type)
first_send_success(provider_type)
```

Forbidden payloads:

```text
subject
body
recipient/sender address
message id that can be joined to content
attachment name/content
password/token
```

## External acceptance gate

Whether Weekly should stay and how Annual/Lifetime should be emphasized requires actual App Store/StoreKit funnel data. The repository can define the privacy-safe measurement contract, but it must not claim that an experiment has been validated until production data exists.
