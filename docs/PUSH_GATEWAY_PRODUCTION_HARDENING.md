# CF Mail Push Gateway Production Hardening

## Trust boundary

The self-hosted CloudMail server never receives Apple APNs provider credentials or raw APNs device tokens. It stores only the scoped `subscriptionId + pushSecret` returned by the Gateway registration flow.

## App Attest registration path

Production-capable flow:

```text
iOS installation
  → POST /v1/app-attest/challenge
  → DCAppAttestService.generateKey / attestKey
  → POST /v1/app-attest/attest
  → locally verified attestation key
  → assertion-bound POST /v1/subscriptions
```

The server verifies certificate chain/nonce/application identity/counter semantics and rejects replayed assertions. Unsupported App Attest devices can be distinguished by policy instead of silently pretending they were attested.

## Recommended production policy

Set the Gateway App Attest policy to the strictest level after real-device rollout has demonstrated acceptable support. During staged rollout, use monitor mode and track:

- challenge issued / consumed;
- attestation accepted / rejected;
- assertion accepted / replay rejected;
- unsupported/fallback registrations;
- subscription creation rate by coarse abuse dimensions.

## Cloudflare edge controls — external configuration gate

The repository cannot create account-specific WAF rules without the operator's Cloudflare account context. Before public scale, configure Cloudflare Rate Limiting/WAF in front of at least:

```text
POST /v1/app-attest/challenge
POST /v1/app-attest/attest
POST /v1/subscriptions
```

Use IP/UA/path and, where appropriate, verified-bot/bot-score signals. Rate limiting is a first edge layer; App Attest remains the application-instance authenticity layer.

## Secrets

Never expose:

```text
APNS_PRIVATE_KEY
APNS_KEY_ID
APNS_TEAM_ID
Cloudflare API Token
raw APNs device token
pushSecret
```
