# Market Desk

Market Desk is a privacy-first, self-hosted application tracker for the economics job market. It combines job discovery, AI-assisted posting extraction, application requirements, document management, Dropbox backups, deadline sorting, and pipeline tracking in one private workspace.

This repository contains the application framework only. It contains no user jobs, application documents, API keys, Dropbox tokens, or deployed database.

## Interface preview

![Market Desk dashboard running in a clean GitHub Codespace](docs/market-desk-dashboard.png)

*Captured from a fresh GitHub Codespace using the public repository, with no saved jobs, credentials, or private application data.*

## What it does

- Imports individual public job-posting links and extracts their full description, employer, location, salary, deadline, and required materials.
- Supports JOE, EconJobMarket, AcademicJobsOnline, Interfolio, public X posts, and other readable public HTTPS job pages.
- Tracks active, maybe, skipped, preparing, submitted, interview, flyout, offer, and closed states.
- Sorts upcoming deadlines as real calendar dates and keeps rolling or missing deadlines at the bottom.
- Stores a checklist, private memo, and tailored application files with each job.
- Optionally copies application files to a personal Dropbox App folder.
- Uses the lowest-cost fixed OpenAI extraction model configured by the project.
- Keeps structured records in D1 and uploaded documents in R2.

## Privacy model

Market Desk is currently designed as a **single-user private deployment**. It does not partition records between multiple users.

Do not expose a deployed instance publicly. Configure the hosting access policy so that only the owner can open it. A public GitHub repository is safe because the repository contains code—not the separately provisioned D1 database, R2 files, hosted secrets, or encrypted connection records.

See [PRIVACY.md](PRIVACY.md) for the complete data boundary and [SECURITY.md](SECURITY.md) before deploying.

## Requirements

- Node.js 22.13 or newer
- npm
- A deployment environment compatible with the included vinext and Cloudflare Worker build
- D1 bound as `DB`
- R2 bound as `FILES`
- Two independent encryption secrets
- Optional: an OpenAI API key for link extraction
- Optional: a Dropbox API app for file backup

## Local setup

1. Clone the repository and install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template:

   ```bash
   cp .env.example .env.local
   ```

3. Generate two different random secrets and replace the placeholders in `.env.local`:

   ```bash
   openssl rand -base64 32
   openssl rand -base64 32
   ```

4. Start the local development server:

   ```bash
   npm run dev
   ```

The local database and object-storage state are ignored by Git. Never commit `.env.local`, `.dev.vars`, `.wrangler`, database files, or uploaded materials.

## Deploying with Sites

The repository includes a projectless `.openai/hosting.json` declaring only the logical `DB` and `FILES` bindings. When creating a new Sites deployment, the platform should create a new project and provision fresh storage instead of connecting to another user's deployment.

Before using the deployed app:

1. Add `OPENAI_KEY_ENCRYPTION_KEY` and `DROPBOX_TOKEN_KEY` as secret runtime values.
2. Confirm the D1 binding is `DB` and the R2 binding is `FILES`.
3. Set access to owner-only/private.
4. Open AI extraction settings and add your own OpenAI API key if desired.
5. Create and authorize your own Dropbox App if desired.

Never copy another deployment's `project_id`, database, bucket, encryption secrets, or credentials into your version.

## Data storage

| Data | Storage | Included in Git? |
| --- | --- | --- |
| Jobs, statuses, notes, and checklists | D1 | No |
| Uploaded application files | R2 | No |
| Encrypted OpenAI and Dropbox connection records | D1 | No |
| Encryption secrets | Hosted secrets or ignored local environment | No |
| Application source and migrations | Git | Yes |
| Fictional social-preview content | `public/og.png` | Yes |

## AI extraction

AI extraction is optional. The user supplies their own OpenAI API key through the app. The key is encrypted before storage, never returned to the browser, and used only for user-initiated posting extraction. OpenAI response storage is disabled in extraction requests.

No generative API call should be assumed free. Review the configured model and current OpenAI pricing before use.

## Dropbox backup

Dropbox support is optional. Market Desk requests access only to its Dropbox App folder. The user supplies a Dropbox App key, authorizes their own account, and can disconnect without deleting files that were already copied to Dropbox.

## Source collection

Market Desk does not promise unrestricted crawling. Automatic monitors are intended for official RSS/Atom feeds, permitted JSON endpoints, or authorized APIs. One-link imports fetch a user-selected public page and may fail when a site requires sign-in, blocks automated requests, renders no readable data, or prohibits the request.

Contributors must preserve source-specific terms, robots directives where applicable, rate limits, and user-initiated collection boundaries.

## Development

```bash
npm run lint
npm test
npm run check:release
npm run db:generate
```

`npm test` performs a production build, regression tests, and the public-release privacy check.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md), especially the rules against committing real job records, application files, credentials, or deployment identifiers.

## License

Market Desk is available under the [MIT License](LICENSE).

## Independence

This project is not affiliated with or endorsed by the American Economic Association, EconJobMarket, AcademicJobsOnline, Interfolio, X, Dropbox, OpenAI, or any employer whose public posting may be imported by a user.
