# Contributing to cms-api-node-typescript-flatfile

Thanks for taking a look. This is a build-in-public project at version 0.3.0, so it is still moving and contributions of every kind are welcome: bug reports, questions, ideas, and code.

## Ground rules

- Stay on Node's built in modules. The point of this project is the standard library, so please do not add runtime dependencies.
- Stay within TypeScript's erasable-types subset (no enums, namespaces, decorators, or constructor parameter properties) so Node can strip types at startup with no build step.
- The conformance test suite is the contract. If you change behavior, change the tests in the same pull request and explain why. Keep them green.
- This is not production software, and the README says so. Please keep that framing.

## Getting started

```sh
git clone https://github.com/ericbinek/cms-api-node-typescript-flatfile.git
cd cms-api-node-typescript-flatfile
cp .env.example .env
```

Run it:

```sh
node src/server.ts
```

Run the tests:

```sh
node --test "test/*.test.ts"
```

The code runs with no install step. Type checking is optional and uses two dev-only, types-only packages (`typescript`, `@types/node`):

```sh
npm install
npm run typecheck
```

## Sending a change

1. For anything beyond a small fix, open an issue or discussion first so we do not duplicate work.
2. Keep each pull request focused on one thing.
3. Run the test suite locally and make sure it is green before you open the pull request.
4. Describe what changed and why.

## Style

ES modules and `node:` imports, no transpilation and no framework. Strict, erasable TypeScript. Match the surrounding code.
