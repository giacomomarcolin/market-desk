# Security policy

## Supported versions

Security fixes are applied to the latest version on the default branch.

## Reporting a vulnerability

Do not disclose a suspected vulnerability in a public issue. Use GitHub's private vulnerability-reporting feature for the repository once it is published. Include the affected route or component, reproduction steps, impact, and any suggested mitigation.

Do not include real API keys, Dropbox tokens, job records, application files, or other personal data in a report. Use synthetic examples.

## Deployment requirements

- Keep the site owner-only/private. The current data model is not multi-user.
- Store `OPENAI_KEY_ENCRYPTION_KEY` and `DROPBOX_TOKEN_KEY` as secret runtime values.
- Use separate, randomly generated values for those two secrets.
- Never commit `.env` files, `.dev.vars`, database files, R2 exports, Wrangler state, or a live Sites project ID.
- Rotate a credential immediately if it is exposed in chat, logs, screenshots, issues, commits, or build artifacts.
- Review third-party source terms before enabling automated collection.

## Security-sensitive design

- OpenAI API keys and Dropbox refresh tokens are encrypted at rest.
- Secrets are not returned through status endpoints.
- File downloads use private, no-store responses.
- Link imports accept only public HTTPS destinations and reject local, private, credential-bearing, and nonstandard-port URLs.
- Redirects are revalidated before fetching.

These controls reduce risk but do not replace an owner-only deployment policy.
