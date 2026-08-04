# Contributing to Market Desk

Thank you for helping make job-market infrastructure more accessible.

## Ground rules

- Never commit real applicant data, job notes, application documents, credentials, tokens, encryption secrets, local databases, hosted project IDs, or deployment output.
- Use fictional institutions and roles in fixtures, screenshots, and documentation.
- Keep automatic collection limited to official feeds, permitted endpoints, authorized APIs, and respectful user-initiated imports.
- Preserve the single-user privacy warning unless a complete, reviewed multi-user authorization model replaces it.
- Do not silently change the configured OpenAI model to a more expensive model.

## Development setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Use placeholder or development-only credentials. Do not use a personal production database for tests.

## Before opening a pull request

```bash
npm run lint
npm test
```

Also review the diff manually. The automated privacy check is intentionally conservative but cannot recognize every kind of personal information.

## Pull requests

- Keep changes focused.
- Explain the user-facing behavior and privacy implications.
- Add regression coverage for bug fixes and new extraction paths.
- Document any new runtime binding, environment value, external service, or migration.
- Do not include generated `dist`, `.wrangler`, `.next`, `.vinext`, local database, or uploaded-file artifacts.

## Source adapters

When adding a source-specific importer, document why a generic page read is insufficient, use only a public or authorized endpoint, enforce response-size limits, validate redirects, and provide a clear fallback when the source blocks access.
