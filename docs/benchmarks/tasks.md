# Benchmark task suite

Fixed prompts. Do not edit them between runs — that breaks comparability. If a task needs to evolve, add a new one (e.g. L2.1b) rather than mutating in place.

Each task includes the level, expected file count, and a one-line description of the success criterion.

## L1 — Atomic, single file

### L1.1 — Add /health endpoint
**Level:** L1 · **Expected files:** 1 · **Sandbox:** clean main

```
Add a GET /health endpoint that returns {status: 'ok'}.
```

**Success:** new route registered inside existing usersRoutes (or as a separate plugin), `validation_pass`, no other files touched.

### L1.2 — Add Zod validation
**Level:** L1 · **Expected files:** 1 · **Sandbox:** clean main

```
Add Zod schema validation to POST /users (require name min 2 chars, email format).
```

**Success:** zod imported, schema defined, used via parse/safeParse on body, existing routes preserved.

### L1.3 — Computed field with TS strict
**Level:** L1 · **Expected files:** 1 · **Sandbox:** clean main

```
Add a GET /users/:id/stats endpoint that returns the user data plus a computed
accountAge field (number of days since createdAt).
```

**Success:** Date arithmetic with .getTime(), 404 via reply.code(404).send, typecheck passes.

## L2 — Cross-file

### L2.1 — Cross-file middleware
**Level:** L2 · **Expected files:** 2 · **Sandbox:** clean main

```
Add a request-logging middleware in src/middleware/request-log.ts that logs
{method, url, statusCode, durationMs} on every response. Register it in
src/server.ts via app.addHook("onResponse", ...).
```

**Success:** new file created with proper Fastify hook signature, server.ts gets the registration WITHOUT losing existing imports / app.listen / env vars.

### L2.2 — Refactor schema extraction
**Level:** L2 · **Expected files:** 2 · **Sandbox:** clean main with L1.2 already applied

```
Extract the Zod validation schema for POST /users into a new file
src/schemas/user-schema.ts (export createUserSchema). Import it back into
src/routes/users.ts and use it via safeParse. The endpoint behavior must not change.
```

**Success:** schema file created AND integrated in routes (not orphan), all tests still pass.

### L2.3 — Multi-file feature (soft delete)
**Level:** L2 · **Expected files:** 3 · **Sandbox:** clean main

```
Add soft-delete to users. (1) In src/types.ts, add `deletedAt: string | null` to
the User interface. (2) In src/services/user-service.ts, update create() to set
deletedAt: null on new users, update list() to filter out users where deletedAt
is not null. (3) In src/routes/users.ts, add a DELETE /users/:id endpoint that
finds the user, sets deletedAt to new Date().toISOString(), and returns 204.
Preserve all existing routes, imports, and behavior elsewhere.
```

**Success:** all 3 files touched correctly, types compatible across them.

## L3 — Refactoring

### L3.1 — Object literal → class refactor
**Level:** L3 · **Expected files:** 1 · **Sandbox:** clean main

```
Refactor UserService from a const object literal into a class. In
src/services/user-service.ts, replace `export const UserService = {...}` with
`export class UserService`. Make methods static so existing call sites like
UserService.list() still work without changes in src/routes/users.ts.
Preserve all existing imports and the in-memory users Map.
```

**Success:** routes/users.ts not touched, all tests pass, behavior identical.

## L4 — Bug fixing

### L4.1 — Find and fix a real bug
**Level:** L4 · **Expected files:** 1-2 · **Sandbox:** custom (bug-injected)

Setup: before running, manually inject a bug in `UserService.create()` that
forgets to set `createdAt`. Then run:

```
The POST /users endpoint returns users without a createdAt field. The User
interface requires createdAt as a string. Find and fix the bug. Don't change
the User interface.
```

**Success:** createdAt restored in create(), no other changes.

## Cumulative sequence (separate test)

Some runs test cumulative state (each task on top of the previous):
1. Run L1.1 → merge → L2.1 → merge → L3.1 → merge → L2.2 → merge → L2.3
2. Track regression at each merge point

Cumulative runs are noted explicitly in the run file (Configuration → "Cumulative: yes").
