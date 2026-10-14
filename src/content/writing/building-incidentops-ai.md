---
title: "Building IncidentOps AI: What I’m Building and Why"
description: "A living overview of an evidence-driven incident triage and diagnosis system, the engineering principles behind it, and what I learn while building it."
publishedDate: 2026-10-14
topics:
  - AI Engineering
  - Incident Response
  - Reliability
featured: true
series:
  id: incidentops-ai
  title: Building IncidentOps AI
  order: 0
draft: false
---
Incident response is full of information, but that information rarely arrives in one clean place. A report may begin as a short message, while the evidence needed to understand it lives across logs, runbooks, postmortems, service relationships, screenshots, and operational databases.

I am building IncidentOps AI to investigate how an engineering system can turn that fragmented input into a structured, evidence-backed diagnosis without hiding uncertainty or treating a model response as truth.

This is not an attempt to build an autonomous operator that makes production changes on its own. It is a learning project focused on the systems work around AI: reliable APIs, retrieval quality, explicit failure handling, evaluations, observability, security, and human approval.

> This is a living project overview. I will update it as the system develops and add each detailed learning post to the series below.

## The problem I want to explore

During an incident, responders need to answer several questions quickly:

- What service is affected?
- What symptoms and error codes have been reported?
- Have we seen something similar before?
- Which runbooks, postmortems, or dependencies are relevant?
- What diagnosis is supported by the available evidence?
- What is still unknown, and when should a person review the result?

An LLM can help interpret language and connect information, but a useful incident system needs much more than a prompt. It needs trustworthy data boundaries, retrieval that preserves provenance, citations for generated claims, controlled tools, durable state, and a clear response when a dependency fails.

The project gives me one concrete system in which to study all of those concerns together.

## What the system is intended to do

The target workflow begins with an incident report in text, screenshots, or documents. It extracts structured facts, retrieves evidence from operational sources, builds a diagnosis with citations, and sends uncertain or risky outcomes to human review.

```text
Incident report
      ↓
Structured extraction
      ↓
Evidence retrieval
      ↓
Grounded diagnosis with citations
      ↓
Recommendation or human review
```

The evidence layer is planned to combine lexical and semantic retrieval over runbooks and postmortems, service relationships from a graph, and constrained access to operational data. The workflow will eventually coordinate these sources, preserve checkpoints, and resume safely after failures.

Any action with meaningful risk should remain behind an explicit approval boundary. The system may gather evidence and recommend a next step, but application code decides which tools exist, validates their arguments, enforces permissions, and records what happened.

## The engineering principles

The project is deliberately organised around a few rules.

### Evidence before intuition

Retrieval strategies, chunking choices, rerankers, and model changes should be compared against versioned evaluation sets. A component earns its place through measured quality, latency, cost, or reliability rather than because it is fashionable.

### Explicit failure over a plausible guess

Timeouts, malformed output, refusals, missing evidence, invalid tool arguments, and unavailable dependencies should become visible application states. If the system cannot support an answer, returning that limitation is better than silently producing something convincing.

### Deterministic controls around probabilistic models

Schemas, database constraints, retry budgets, tool registries, access rules, and approval steps belong in ordinary application code. Models can interpret and propose; they should not define their own trust boundary.

### Production concerns from the beginning

Idempotency, concurrency, migrations, structured errors, observability, security, and degradation are not release-week additions. Building them alongside the AI features makes their interaction easier to understand and test.

## How I am building it

The work is split into a sequence of small, evidence-producing stages:

1. Build a typed API with PostgreSQL persistence, migrations, duplicate-request protection, tests, and a deployment exercise.
2. Add structured LLM extraction, explicit uncertainty, bounded retries, strict validation, and a read-only tool boundary.
3. Build an evaluated retrieval pipeline over runbooks and postmortems, then compare dense, lexical, hybrid, and reranked retrieval.
4. Add cited diagnosis, graph context, and multimodal evidence from screenshots and documents.
5. Introduce a recoverable workflow with checkpoints, budgets, loop detection, and human approval.
6. Add integrations, permissions, red-team tests, observability, evaluation gates, load testing, and graceful degradation.

The goal is not simply to finish a feature list. Each stage should leave behind tests, measurements, decision records, or failure evidence that explains what the system can and cannot claim.

## Current state

The first two stages are complete.

The backend accepts and retrieves incidents through a typed FastAPI interface, persists them in PostgreSQL, protects repeated submissions with idempotency keys, and returns structured errors. Its concurrency behaviour is tested against a real database.

The first AI capability extracts structured incident information and can request recent incidents through a narrow read-only tool. Provider failures are translated into explicit result states, retries are bounded and observable, output is validated strictly, and analysis runs record the model, prompt version, latency, attempts, and token usage when available.

The real-model checks have already produced an important result: schema-valid output is not the same as a correct interpretation. The same report received different severity suggestions across two runs. That variability is now part of what the evaluation work needs to measure.

The next stage focuses on retrieval. I will create a small corpus and evaluation set before choosing chunking, embedding, fusion, or reranking strategies.

## Learning log

Each post focuses on the engineering lessons from one stage rather than repeating the complete project description.

1. [Week 1: The backend decisions that came first](/writing/week-01-backend-foundations/)

   API contracts, async execution, transaction boundaries, idempotency under concurrency, testing, and deployment.

2. [Week 2: Valid JSON isn’t enough](/writing/week-02-valid-json-isnt-enough/)

   Structured LLM output, uncertainty, retry policy, tool validation, provider failures, and what real-model variability revealed.

Future posts will cover retrieval evaluation, grounded diagnosis, graph and multimodal evidence, workflow orchestration, human approval, security, observability, and failure engineering.

## What this project is not

IncidentOps AI is currently a prototype and learning system. It is not connected to a production environment, it does not have permission to make operational changes, and its early evaluation data is intentionally small.

Those limits are part of the project rather than footnotes. The purpose is to establish evidence for each capability before expanding its authority.

The source, roadmap, tests, evaluations, and decision records are available in [the IncidentOps AI repository](https://github.com/AniketIndulkar/IncidentOps-AI).
