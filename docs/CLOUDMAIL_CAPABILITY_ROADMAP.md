# CloudMail Server Capability Roadmap

CF Mail treats unmodified Cloud-Mail 3.0.0 as the compatibility floor. `/api/capabilities` is optional; a 404 remains a valid 3.0.0 server and must never make login fail.

## Schema v2

The enhanced Worker advertises explicit booleans instead of forcing the client to infer support:

| Capability | Current enhanced Worker | Roadmap contract |
|---|---:|---|
| Message detail | yes | stable |
| Extended CC/BCC recipients | yes | stable |
| Remote push registration | conditional | stable when Gateway is configured |
| Raw message source | yes | stable |
| Folders | no | vNext candidate |
| Trash/Spam folders | no | follows folder model |
| Server search | no | vNext candidate |
| Server drafts | no | later candidate |
| Server scheduled send | no | later candidate; must not be marketed as exact server scheduling before this is true |

## Versioning rules

1. Missing fields always mean unsupported.
2. New fields are additive; old iOS clients ignore them.
3. The client persists the discovered schema version per server but falls back to the conservative 3.0.0 baseline on first contact.
4. Runtime 404/405 on an advertised optional endpoint downgrades that capability instead of breaking the account.
5. Folder/Search/Draft/Scheduled Send UI must be gated by `AccountCapabilities`, not provider name.

The roadmap priority is Folders + Server Search first, followed by Server Drafts and true Server Scheduled Send. This closes the product ambiguity while preserving Cloud-Mail 3.0.0 compatibility.
