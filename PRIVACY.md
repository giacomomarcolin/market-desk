# Privacy and data boundaries

Market Desk is built to keep a job seeker's application activity outside the public source repository.

## What the repository contains

- Application source code
- Database schema and migrations
- Generic source-monitor definitions
- Automated tests
- A fictional social-preview image
- Placeholder environment values

## What the repository must never contain

- Real tracked jobs or application statuses
- Personal notes, interview details, contacts, or correspondence
- CVs, cover letters, research papers, reference lists, or other application files
- OpenAI API keys
- Dropbox refresh or access tokens
- Encryption secrets
- A live Sites `project_id`
- Exported D1 databases, R2 objects, local SQLite files, or Wrangler state

## Runtime storage

Structured records are stored in the deployment's D1 database. Uploaded files are stored in its R2 bucket. OpenAI and Dropbox credentials are encrypted using deployment-specific secrets before their encrypted records are written to D1.

The repository does not provide a route for exporting these runtime resources into Git.

## Single-user boundary

The current application is a single-user tracker. Database queries are not scoped by user ID. The deployment must therefore be protected by an owner-only access policy. Deploying it as a public or generally shared application can expose all records to every visitor and is unsupported.

Do not expose an unmodified deployment to the public internet.

Multi-user support requires a deliberate schema and authorization change that associates every job, file, note, task, requirement, and integration record with an authenticated owner.

## Before every public release

Run:

```bash
npm run check:release
```

Then inspect the complete staged diff and confirm that no local data, secrets, identifiers, or generated deployment output are included.
