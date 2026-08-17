# App Attest signing model

CloudMail intentionally does **not** place `com.apple.developer.devicecheck.appattest-environment` in either iOS entitlements file.

- Development builds without the environment entitlement use the App Attest sandbox service.
- TestFlight and App Store distributions use the production App Attest service regardless of the environment value in the entitlement.
- `aps-environment` remains explicit because APNs signing is authorized by the provisioning profile.
- The App Attest runtime implementation remains active: `DCAppAttestService` key generation, attestation, assertions, Gateway challenge binding, AAGUID verification, replay counters, and monitor/enforce policy are unchanged.

CI therefore validates `aps-environment=production` in the App Store provisioning profile, but does not require an App Attest environment entry in that profile.
