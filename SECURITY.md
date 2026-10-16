# Security Policy

## Supported versions

| Version | Supported              |
| ------- | ---------------------- |
| 0.x     | ✅ Current development |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report them privately via GitHub's
[Security Advisories](https://github.com/PrestonCash/Prestron-Media-Encoder/security/advisories/new).

You can expect an acknowledgement within 72 hours and a fix or mitigation plan within 14 days
for high-severity issues.

## Security design notes

- No shell execution: all subprocesses use argument arrays (`execa` without `shell: true`).
- Output paths are validated to prevent path traversal.
- Source files are opened read-only.
- No network requests are made.
- State is stored locally under XDG directories only.
