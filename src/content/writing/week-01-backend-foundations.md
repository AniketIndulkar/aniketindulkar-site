---
title: "Building IncidentOps AI: The Backend Decisions That Came First"
description: "Learning Python backend engineering through API contracts, concurrency, persistence, and deployment."
publishedDate: 2026-10-14
topics:
  - Backend Engineering
  - Reliability
  - Python
draft: false
---
What should happen if the same incident report reaches an API ten times at once?

That became one of the most useful questions in my first week building IncidentOps AI. A create endpoint is straightforward when every request arrives once, the database is available, and the client receives the response. Retries and concurrent requests force you to be much more precise about what the system promises.

I’m building IncidentOps AI to explore how an application can turn incident reports into structured information and, eventually, retrieve evidence and support diagnosis. The first week established the backend: a typed API, PostgreSQL persistence, duplicate-request protection, automated checks, and a deployment exercise on AWS.

With Kotlin as a reference point, I was also learning how Python’s backend libraries fit together. Familiar concepts helped me get started. Following requests and testing failures helped me understand where those comparisons stopped being useful.

## Start with a small, explicit contract

The first version had two main operations:

```text
POST /incidents        Create an incident
GET /incidents/{id}    Retrieve an incident
```

A report included a title, description, service, severity, and environment. The server assigned its identifier, timestamps, and initial status.

Separating client-provided fields from server-owned fields made the API easier to reason about. The create model described what a caller could submit; the response model described what the application returned after persistence.

I used Pydantic for validation. Titles had length limits, service identifiers followed a naming convention, and severity and environment were enums. Unknown input fields were rejected.

This led to an important distinction: an API model and a database model have different jobs. Pydantic checks values as they enter the application. Database constraints protect stored data, including when several requests compete to write it. A Python type annotation alone does neither of those things at runtime.

That distinction will matter later when model-generated data enters the same application. Having an expected shape is one step; enforcing the contract at the boundary is another.

## Understand the stack by following one request

Initially, there were several libraries to get familiar with. Following a single request made their responsibilities clearer:

```text
Client → Uvicorn → FastAPI → Repository → SQLAlchemy → asyncpg → PostgreSQL
```

The route receives validated data and delegates persistence to the repository. SQLAlchemy manages mapped objects and database operations, asyncpg handles communication with PostgreSQL, and PostgreSQL executes the query.

The supporting pieces have their own responsibilities:

| Piece | Responsibility in this project |
|---|---|
| Uvicorn | Serve the application over HTTP through ASGI. |
| FastAPI | Route requests, supply dependencies, and define response contracts. |
| Pydantic | Validate and serialize application data. |
| SQLAlchemy and asyncpg | Manage database work and communicate with PostgreSQL. |
| Alembic | Apply versioned changes to the database schema. |

My Kotlin comparisons were useful here. A Pydantic model felt familiar as a data class with validation and serialization. A repository resembled the persistence boundary I would use around a DAO.

But SQLAlchemy’s session introduced another idea: it tracks mapped objects and coordinates pending database work. Understanding that lifecycle required more than translating familiar class names into Python.

Keeping routes small and persistence behind a repository also gave the project a useful structure. Future extraction services and workflow code can reuse domain and persistence code without depending on an HTTP route.

## Async changes how waiting works

Kotlin coroutines gave me a starting point for Python’s `async def` and `await`, but I needed to understand the execution model directly.

Calling an `async def` function creates a coroutine object. It does not immediately start running the function. Awaiting it or scheduling it as a task drives its execution.

The other detail that mattered was sequencing. Awaiting one database call and then awaiting another still runs them sequentially. Concurrency requires scheduling overlapping work, for example through `asyncio.gather` or a task group.

For this backend, async is useful because requests spend time waiting for database I/O. While one task waits, the event loop can run another ready task. Blocking work inside an async function can still occupy the event-loop thread and delay other requests.

The lesson I carried forward was to inspect the work inside the function. The `async` keyword does not establish that everything it calls is non-blocking, or that independent operations run concurrently.

## Learn the transaction boundary before adding more features

Each ordinary API request gets its own database session. Within that session, SQLAlchemy coordinates the work that eventually becomes a transaction.

Two operations were particularly useful to distinguish:

- **Flush:** send pending changes to the database inside the current transaction.
- **Commit:** complete the transaction and make its changes durable.

That distinction became concrete in the idempotency implementation. An incident row could be flushed before its associated key was inserted, while both writes still belonged to the same transaction. If the key insert failed, rolling back also removed the incident created by that attempt.

I also learned to treat schema changes as explicit work. Editing a mapped Python class does not update an existing database. Alembic migrations record the changes and provide a repeatable way to apply them.

These are familiar backend concerns, but implementing them in a new stack made me articulate assumptions I might otherwise have carried over without checking.

## A retry should have a defined meaning

Consider a client submitting an incident. The server creates the row, but the response is lost. The client retries because it cannot tell whether the first request succeeded.

Without duplicate protection, that retry creates another incident.

I added an optional `Idempotency-Key` header with three explicit behaviours:

| Request | Behaviour |
|---|---|
| Same key and same validated body | Return the existing incident. |
| Same key and different validated body | Reject the request with a stable error code. |
| No key | Create a new incident for each request. |

The key is stored with a fingerprint of the validated payload and the identifier of the incident it created. Validating before fingerprinting means insignificant differences removed by validation, such as surrounding title whitespace, do not create different fingerprints.

The difficult case is concurrency. Two requests can both check for a key, find nothing, and proceed to create an incident. An application-level existence check leaves that race open.

The implementation therefore stores the incident and key in one transaction and uses a database uniqueness constraint on the key’s scope and value. If another request commits the same key first, the losing transaction rolls back and retrieves the winner’s incident, after checking that the payload matches.

The test that made this behaviour tangible submitted ten concurrent requests with the same key and body. It checked that every response succeeded, every response contained the same incident identifier, and the database contained one incident.

This gave me a stronger way to think about reliability: define the behaviour a caller needs, then put the guarantee at the layer that can enforce it under concurrency.

## Test the promises, including failure responses

The tests used PostgreSQL and applied the application’s migrations. That mattered because transactions, uniqueness constraints, and database errors were part of the behaviour being tested.

The first week covered input validation, missing incidents, persistence across application restarts, repeated requests, concurrent duplicate submissions, and failure responses.

I also gave errors a consistent problem-detail shape with stable application codes. A client should be able to distinguish an invalid request, a missing incident, and an unavailable database without parsing prose. Error responses avoided exposing submitted values or internal exception details.

One small lesson came from CI itself. The first run failed on lint and formatting checks, and the local working copy differed from the committed snapshot. It was a reminder to verify the state that CI actually checks.

The pipeline ran linting and tests, then built the Docker image only after both passed. These checks established a repeatable baseline for adding more behaviour in the following week.

## Deployment exposes another set of assumptions

I packaged the API in a Docker image and ran it with PostgreSQL through Docker Compose. The image used separate build and runtime stages, ran the application as an unprivileged user, and included a health check. The startup script applied migrations before starting the server.

An immediate practical detail was CPU architecture: my Mac was ARM-based, while the temporary Lightsail server was x86. I built the deployment image for `linux/amd64`.

The deployment was manual. I exported the image, copied it to the server, loaded it, and started the containers. CI built an image as a check; it did not publish an image or deploy the application automatically.

From outside the server, I verified the health endpoint, incident creation and retrieval, and an idempotent replay. I also checked that PostgreSQL’s port was not publicly reachable. The instance was deleted after the exercise.

This was a useful deployment milestone with clear limits: a temporary prototype deployment using a single server. Authentication, HTTPS, managed infrastructure, and continuous deployment were still future work. The health endpoint showed that the API process was responding; it did not establish database health.

## What I’m carrying into the AI work

By the end of the week, I could explain what happened to an incident from validation through persistence, what repeating a request meant, and which behaviours the tests actually established.

The most useful learning came from making boundaries explicit: client fields versus server fields, validation versus database constraints, flush versus commit, and coroutine creation versus scheduled execution.

Those boundaries gave the next week a concrete starting point. Incident creation and retrieval already worked independently. I could add LLM analysis as a separate operation, then investigate its latency, failures, and output quality without making incident storage depend on a model call.

*Project code: [IncidentOps AI on GitHub](https://github.com/AniketIndulkar/IncidentOps-AI). The next post covers structured extraction, bounded retries, tool calling, and what two real-model runs revealed.*
