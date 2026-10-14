---
title: "Building IncidentOps AI: Valid JSON Isn’t Enough"
description: "Learning to build structured LLM interactions with explicit uncertainty, tested failures, and evidence about their limits."
publishedDate: 2026-10-14
socialImage: /images/writing/social/week-02-valid-json-isnt-enough.png
topics:
  - LLM Engineering
  - Reliability
  - Evaluation
series:
  id: incidentops-ai
  title: Building IncidentOps AI
  order: 2
draft: false
---
The same incident report came back as SEV3 on one run and SEV2 on another. Both responses passed validation.

That was the most useful result from my second week building IncidentOps AI. It exposed a gap between two questions: can my application consume this response, and is the response a good interpretation of the report?

In the first week, I built an API that could store and retrieve incidents, handle duplicate submissions, and return structured errors. This week, I added LLM-backed extraction and a read-only tool for finding recent incidents.

The feature was deliberately narrow. Given an incident’s title and description, the model should extract a service, symptoms, error codes, environment, suggested severity, entities, and missing information. A second endpoint let it request recent incidents from the database and produce a related-incident summary.

Working on that small feature taught me how much application behaviour surrounds a model call: validation, retry decisions, tool boundaries, database lifetimes, and records that let me inspect what happened.

## Make uncertainty part of the contract

A report such as “the site feels slow” leaves several questions unanswered. Which service? Which environment? What evidence describes the impact?

A schema can accidentally pressure an extractor to fill those gaps. If every field demands a concrete value, the output has no useful way to represent missing information.

I designed the extraction model to preserve uncertainty. A service name and environment can be `null`. The service also includes `stated_explicitly`, so an inferred name can be distinguished from one present in the report. Missing information is returned as fields and follow-up questions. Severity is represented as a candidate with a rationale.

For example, a fragment of an extraction for a vague report could look like this:

```json
{
  "service": {
    "name": null,
    "stated_explicitly": false
  },
  "environment": null,
  "missing_information": [
    {
      "field": "affected_service",
      "question": "Which service is experiencing the slowdown?"
    }
  ]
}
```

This is an illustrative fragment, rather than the complete schema. The important design choice is that unknowns have a defined representation.

The prompt and schema serve complementary purposes. The schema permits `null`; the prompt explains when the model should use it. The schema describes a severity candidate; the prompt explains how to interpret impact and uncertainty.

That changed how I approached schema design. I needed fields that could carry the evidence and uncertainty downstream, alongside the extracted values.

## Put application behaviour behind a provider boundary

I introduced an `LLMProvider` interface with operations for structured generation and tool-calling turns. The application depends on that interface, while the vendor implementation contains the SDK calls.

Three implementations divide the work:

| Implementation | Responsibility |
|---|---|
| `OpenAIProvider` | Make an individual provider request and translate known failures. |
| `FakeProvider` | Supply scripted results and failures in tests. |
| `RetryingProvider` | Apply the application’s retry policy around a provider. |

This was a familiar interface-and-decorator pattern, applied to a new dependency. Its immediate value was testing: extraction and retry behaviour could be exercised without a network call or an API key.

Known failures became application result values with explicit statuses such as `timed_out`, `invalid_output`, `truncated`, and `rejected`. A failed structured result carried no extracted value. The caller could choose its response from the status, without depending on vendor exception types.

The boundary also made an important question visible: which part of the system owns retries? I disabled the SDK’s automatic retries and put that policy in the wrapper, where attempts and outcomes could be counted and tested.

## Decide whether another attempt can help

“Retry on failure” was too broad a rule. A slow provider, a truncated reply, and an invalid API key have different causes.

I used the cause of the failure to choose the response:

| Failure | Policy in this project |
|---|---|
| Timeout, temporary rate limit, network error, or provider 5xx | Retry with bounded backoff. |
| Output fails validation | Allow one additional attempt, then fail explicitly. |
| Output reaches the token cap | Allow one additional attempt with a larger output cap. |
| Invalid key, exhausted quota, or malformed request | Reject immediately. |
| Model refusal | Return an explicit refusal without retrying. |

Rate limiting and exhausted quota were a useful example. Both can arrive as HTTP 429, but waiting may help only the temporary rate limit. The provider’s error details matter alongside the HTTP status.

For each structured provider call, the configured limits were three attempts, a 30-second per-attempt timeout, and a 60-second budget across attempts and waits. A requested retry wait above 30 seconds ended the operation rather than keeping the caller waiting.

Tool conversations have multiple model turns, so that per-call budget does not establish a 60-second deadline for an entire conversation. The loop has a separate three-turn limit. A whole-conversation deadline is a further concern.

I also injected the clock, sleep function, and randomness into the retry wrapper. Tests could advance fake time and inspect delays without actually waiting through a timeout. This made familiar dependency-injection techniques useful for testing time-dependent behaviour.

## Inspect failure information before parsing the answer

One of the most instructive defects involved truncated output.

The initial implementation used an SDK parsing helper. In the truncation test, the helper tried to validate incomplete JSON before the application could inspect the completion status. The result was classified as invalid output, and useful response metadata was lost.

That distinction mattered because truncation had a different retry policy: the next attempt should receive a larger output cap.

I changed the flow to inspect the response first and validate its text only after checking for incomplete output or refusal. The lesson was about ordering: failure metadata can determine whether parsing should happen at all.

Another fault test supplied a string where a boolean was expected. Pydantic’s default validation accepted a compatible string by converting it. I changed the output validation to use strict mode:

```python
value = schema.model_validate_json(response.output_text, strict=True)
```

For this boundary, silently accepting a wrong type would hide an upstream contract violation. Provider-side structured-output constraints reduce formatting problems; application-side validation checks what actually arrived.

Neither check establishes that a service name or severity assessment is correct. They establish properties of the response that the rest of the code can rely on.

## Test the layers,and check the assumptions between them

I used three levels of testing:

| Level | What it helped establish |
|---|---|
| Scripted provider results | Retry policy, review rules, and application control flow. |
| Injected HTTP responses through the real SDK | Request construction, response parsing, and error translation. |
| Deliberate real-model checks | Whether the provider accepted the integration and how the model behaved on sample reports. |

The HTTP layer was especially useful. The SDK code ran normally, but a fake transport supplied chosen responses. This let me create faults that would be difficult to encounter reliably through live requests.

In the SDK version used by this project, an HTML body with HTTP 200 came back as a plain string. A broken JSON body with HTTP 200 raised a JSON decoding error outside the vendor exception family I initially expected.

Both cases required explicit handling. Otherwise, the application’s assumptions about a successful SDK call or a vendor-specific exception would leave gaps.

The real-model checks exposed different missing cases. A related-incident lookup included the incident being analysed, allowing the model to report it as related to itself. I updated the query to exclude that incident. Inspecting stored run data also exposed the difference between SQL `NULL` and JSON `null` in a JSONB column.

Those cases can be covered by tests once understood. The lesson was that fixtures encode assumptions, and passing tests cannot establish that every assumption matches the real integration.

## A tool call is another input boundary

The model’s tool was intentionally small:

```text
get_recent_incidents(service: str, limit: int)
```

The model requests a call; application code decides whether to execute it. Before running a handler, the registry checks that the tool exists and validates its arguments strictly. Limits outside the allowed range, wrong types, missing fields, and unknown fields are rejected.

The tool reads recent incidents from the project’s database, caps the result count, and returns summaries without descriptions. It uses parameterized queries. A rejected request is returned to the model as an error result, so it can correct its arguments without the invalid call being executed.

When the model requested independent lookups, they ran concurrently. This brought back a lesson from the first week: a SQLAlchemy session must not be shared across concurrent tasks. Each lookup opens its own short session.

Database lifetimes mattered around the model call too. The analysis route loads the incident and closes that session, waits for the model, then opens another short session to record the run. It avoids holding a database connection while waiting on a slow external dependency.

The extraction and related-incident endpoints are separate from incident creation. A provider outage can therefore make analysis unavailable while the application continues to store and retrieve incident reports.

## Record decisions and make review reasons inspectable

Prompts are versioned files shipped inside the Python package. Runs record the prompt name and version, model, status, token usage when available, latency, and attempt outcomes. Failed operations also have records.

These records provide context for investigating changed behaviour. They do not make a model deterministic or guarantee that an earlier result can be reproduced.

I also added review rules over validated extractions. A missing service, an inferred service, an unspecified environment, no symptoms, many open questions, or a SEV1 suggestion produces a review flag with reason codes.

I chose those inspectable rules because I had no calibration evidence for a confidence score reported by the model. A flag such as `service_inferred_not_stated` gives a reviewer a concrete reason to inspect the result.

At this stage, the feature returns and stores the flag. It does not route the result to a person or block an action until approval. That workflow remains future work, and the rules themselves need evaluation and tuning.

## What the real-model runs established

I ran ten varied reports twice, including clear reports, vague descriptions, noisy logs, staging and development problems, and one prompt-injection example.

| Observation | First run | Second run |
|---|---|---|
| Valid typed results | 10/10 | 10/10 |
| Service matched the expected value | 10/10 | 10/10 |
| Severity for the payments report | SEV3 | SEV2 |
| Per-call latency | 4.0–11.3 seconds | 5.4–17.7 seconds |

Reports without a named service preserved unknown service and environment values and returned follow-up questions. The injection example produced a structured extraction despite instructions embedded in the report. That single case was useful to inspect, but it established little about resistance to other attacks.

The changed severity was the finding I kept returning to. With the same prompt, model, and input, the two runs produced different assessments. There was no labelled expected severity in the dataset, so the comparison did not establish which assessment was correct. It established variability that an evaluation needs to account for.

The samples checked parsing and service matching. They did not score the correctness of symptoms, error codes, entities, or severity. A “10/10” result needed that context attached to it.

## What I need to learn next

The next step is to define expected answers and evaluate quality across repeated runs. More retry tests cannot answer whether an extracted symptom is supported by the report or whether a severity suggestion is appropriate.

There are also application gaps: analysis requests lack idempotency, authentication and rate limiting remain unfinished, there is no fallback provider or circuit breaker, and review is still a flag rather than an approval workflow. Those limits matter when deciding where this prototype can be used.

My learning this week was to separate the evidence for each claim. Schemas and validators establish response contracts. Fault tests establish behaviour under chosen failures. Real checks expose integration assumptions. Labelled evaluations are needed to assess answer quality.

I now have a small LLM feature with explicit failures and records I can inspect. The work ahead is to establish how well it interprets incidents, then use that evidence to decide which outputs deserve trust and which need further review.

*Project code: [IncidentOps AI on GitHub](https://github.com/AniketIndulkar/IncidentOps-AI). This is the second post in the series, following the backend foundation built in Week 1.*
