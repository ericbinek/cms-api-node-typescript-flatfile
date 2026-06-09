# schema.org aligned CMS API (TypeScript on Node.js)

[![Tests](https://github.com/ericbinek/cms-api-node-typescript-flatfile/actions/workflows/test.yml/badge.svg)](https://github.com/ericbinek/cms-api-node-typescript-flatfile/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)
![Status](https://img.shields.io/badge/status-work_in_progress-orange.svg)
![Build in public](https://img.shields.io/badge/build-in_public-ff69b4.svg)
![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)
![Node.js 24](https://img.shields.io/badge/Node.js-24-green.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)

A standalone, schema.org aligned CMS API written in plain TypeScript on Node.js 24.

Node 24 strips the types at startup, so there is no build step and no `node_modules` at runtime. It runs on Node's built in modules, `node:http` to serve and `node:test` to test.

It exposes CRUD endpoints for 10 schema.org entity types such as BlogPosting, Person, and WebPage, backed by flat-file JSON storage, with validation, pagination, filtering, sorting, ETag caching, and reference embedding.

A conformance test suite defines the HTTP contract.

## Status: work in progress (v0.1.0)

This is an ongoing build-in-public project, shared only for community and communication purposes. Do not deploy it in production. Do not rely on its interfaces or data format remaining stable.

## No build step

Node 24 runs TypeScript directly by stripping the type annotations at startup, so there is no compile step and nothing is emitted. The runtime is Node's standard library alone: `node:http`, `node:fs`, `node:test`. The only dependencies are dev-only and types-only: `typescript` and `@types/node`, used for the optional `npm run typecheck` (`tsc --noEmit`) in CI. The code stays within TypeScript's erasable-types subset, so it never needs a transpiler.

## Requirements

- Node.js 24 or newer

## Installation

```sh
git clone https://github.com/ericbinek/cms-api-node-typescript-flatfile.git
cd cms-api-node-typescript-flatfile
cp .env.example .env
```

## Running

```sh
node src/server.ts
```

The server listens on `PORT` (default 3008).

## Usage

```sh
curl http://localhost:3008/blog-postings
```

All list endpoints return `{ items, total }`. See per-entity routes below.

## Entities

- `BlogPosting`
- `Person`
- `WebPage`
- `ImageObject`
- `CategoryCode`
- `CategoryCodeSet`
- `DefinedTerm`
- `DefinedTermSet`
- `Comment`
- `WebSite`

## Testing

```sh
node --test "test/*.test.ts"
```

## Type checking

```sh
npm install
npm run typecheck
```

This installs the two dev-only packages and runs `tsc --noEmit` in strict mode. It is optional: the code runs without it.

## Contributing

Contributions are welcome. This is a build-in-public project, so issues, questions, and ideas count as much as pull requests. If you send code, keep it on Node's built in modules with no new runtime dependencies, stay within the erasable-types subset so Node can strip types without a build, and keep the conformance suite green, since the tests are the contract. Run them with `node --test "test/*.test.ts"`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guidelines.

## License

MIT. See [LICENSE](LICENSE).
