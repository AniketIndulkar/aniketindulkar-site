---
title: "Building IncidentOps AI: Earn the Complexity"
description: "Why hybrid search earned its place, a reranker stayed off, and server-checked citations still could not prove that a diagnosis followed from the evidence."
publishedDate: 2026-11-11
socialImage: /images/writing/social/week-04-earn-the-complexity.png
topics:
  - Retrieval
  - Evaluation
  - AI Engineering
series:
  id: incidentops-ai
  title: Building IncidentOps AI
  order: 4
draft: false
---

*Week 4: learning hybrid search, reranking, and cited diagnosis by deciding in advance what would count as an improvement.*

Hybrid search beat dense search by about one question out of thirty.

That was the headline result of my fourth week building IncidentOps AI, and I shipped it anyway. The more useful part was what I learned from the other stage I built, a reranker that made the benchmark slightly worse. It was the most interesting component of the week, and the evidence said to leave it switched off.

[Week 3](/writing/week-03-measure-retrieval-before-tuning/) ended with a dense retrieval baseline that was near its ceiling: Recall@5 of 0.983 and MRR of 0.961 on my 30 questions. The ten failures I had read were each about a different mechanism. This week I added the tools that match those mechanisms, then asked a plain question about each: does it earn its place?

I built BM25 keyword search, rank fusion, a cross-encoder reranker, and a benchmark that scores every stage on the same questions. Then I used the winning stack to build a diagnosis endpoint where every cause has to carry a citation the server has checked.

## Match each tool to a failure you already saw

The Week 3 failures gave me a shopping list, and it was shorter than the list of techniques I had read about:

| Failure from the baseline | Candidate fix | Why I expected it to help |
|---|---|---|
| A rare word (“keepalive”) outweighed by topic words | BM25 | It weights rare terms heavily. |
| The right topic found, the wrong passage ranked first | Cross-encoder reranker | It reads the question and the passage together. |
| A second source that shares no words with the question | Neither, probably | This looked like a graph problem for later. |
| A definition ranked below its usages | Reranker, maybe | It might notice which passage answers the question. |

Writing “neither, probably” was useful. It stopped me from expecting a technique to fix everything, and it made the later results easier to interpret.

## Write the rule that picks the stack before running it

I repeated the Week 3 method: hypotheses and a selection rule first. The new hypotheses were H7 to H12, for example “BM25 is no better than dense on identifiers” and “the reranker adds under 300 ms”. The rule was:

- Stages are Dense, BM25, Hybrid, and Hybrid + rerank.
- A stage replaces the one before it if MRR rises by at least **0.02** on one decision configuration, falls by no more than 0.02 on the other, and the whole stack stays under a 1,000 ms p95.
- Otherwise the simpler stage wins. A tie goes to the simpler stage.

There were two decision configurations. My chosen chunking was `fixed-2000-200`, but it sat at Recall@5 of 0.983, which left almost no room for a gain. I added `section-1500` with the context header, which had headroom. A third, plain `section-1500`, was exploratory and outside the rule.

I also fixed a “too heavy to run locally” bar before measuring the reranker: more than 300 ms of added p95 latency for 20 candidates, or more than 500 MB of added memory. My plan was to run it on my laptop first and consider AWS only if it hurt.

## BM25 is small enough to write and test yourself

BM25 scores a chunk by the query words it contains. It rewards rare words (inverse document frequency), saturates repeated words, and penalises long chunks. I wrote about 120 lines instead of using a library, because I wanted exact tests and no hidden choices. Postgres full-text ranking was not an option either: it is not BM25 (it ignores how rare a word is across the corpus), so calling it BM25 would have made my comparison table misleading.

The decision that mattered was the tokeniser. Error codes and variable names are what BM25 should win on, so identifiers are indexed whole and in parts:

```python
tokenize("PAY-1042 INDEXER_BATCH_SIZE")
# pay-1042, pay, 1042, indexer_batch_size, indexer, batch, size
```

A query for the exact code matches the whole token, and a query for “1042” still matches. I made two more choices before looking at any results:

- The parameters stay at the textbook values, `k1 = 1.2` and `b = 0.75`. Tuning them on 30 questions would only fit the question set.
- There is **no stemming**. I wanted to see what that cost, and it turned out to cost one question, which I come back to below.

Statistics such as average chunk length are computed per tenant. One tenant’s text must never change what a word is worth for another, and a service filter must not change a word’s weight. Filters pick candidates after scoring.

## Fuse ranks, not scores

Dense scores are cosine similarities of about 0.2 to 0.6. BM25 scores run to 13 or more. Adding them would let one scale drown the other. Reciprocal Rank Fusion avoids the problem by using only each chunk’s rank in each list:

```python
for position, result in enumerate(ranking, start=1):
    key = result.chunk.id
    scores[key] = scores.get(key, 0.0) + 1.0 / (k + position)
```

I used the standard `k = 60`, equal weights, and the top 50 from each source, matched by chunk identifier. A chunk found by both sources appears once with both contributions. Because every stage implements the same `Retriever` interface from Week 3, building the stack was composition:

```python
hybrid = HybridRetriever(dense, DbBm25Retriever(session_factory))
stack = RerankingRetriever(hybrid, reranker)
```

One test failed in an instructive way. I check that the hybrid built on pgvector ranks exactly like the one built in memory. It failed on one question, and the cause was not hybrid at all. Two chunks that were tied to seven decimal places swapped places once their vectors passed through PostgreSQL’s float32 storage. The test now requires exact agreement where the dense lists agree, tolerates swaps between tied scores where they do not, and demands at least 40 exact comparisons, so it cannot pass by skipping.

## A reranker reads the question and the passage together

Dense search embeds the question and each chunk separately, then compares the vectors. A cross-encoder takes the question and one chunk as a single input and outputs a relevance score. It can notice that a chunk is about the right topic but does not answer the question, at the price of one model run per candidate.

I used a small model, `ms-marco-MiniLM-L-6-v2`, through ONNX so I did not need PyTorch. It is an optional extra (`uv sync --extra rerank`), loaded on first use, so CI and the default Docker image never touch it. Tests use a fake reranker that scores word overlap. The real model has one opt-in test, and the first run downloaded about 87 MB.

The reranker takes the top 20 from the hybrid stage, scores each one with its context header attached, and re-orders them. If it returns the wrong number of scores, it raises an error rather than silently misordering results.

## Make the harness honest before reading the table

Three decisions about measurement mattered more than I expected:

- **Latency must include a real query embedding.** My first design would have put question vectors in the same disk cache as chunk vectors. That makes dense search look free. Question embeddings are now live API calls, while chunk vectors stay cached.
- **Added latency is the reranker’s own time per question.** Differences between whole-pipeline timings are dominated by network jitter.
- **Memory is current resident memory before and after, not peak memory.** A peak figure hides growth that stays below an earlier peak.

The report also lists “questions moved”: which questions improved or got worse between stages. Averages hide that, and a regression is easier to explain per question.

As a sanity check, the dense rows reproduced the Week 3 numbers exactly (MRR 0.961, 0.889, and 0.801). That told me the new harness was measuring the same thing.

## What the numbers said

Recall@5 / MRR@10 for each stage:

| Stage | `fixed-2000-200` | `section-1500` + header | `section-1500` (exploratory) |
|---|---|---|---|
| Dense | 0.983 / 0.961 | 0.950 / 0.889 | 0.933 / 0.801 |
| BM25 | 0.983 / 0.957 | 0.900 / 0.815 | 0.850 / 0.764 |
| **Hybrid** | **1.000 / 0.967** | **0.950 / 0.918** | 0.867 / 0.793 |
| Hybrid + rerank | 1.000 / 0.961 | 0.967 / 0.889 | 0.967 / 0.889 |

Applying the rule:

- **Dense → Hybrid:** +0.006 and +0.029 MRR, with p95 around 250 ms. Adopted.
- **Hybrid → Hybrid + rerank:** −0.006 and −0.029. Neither configuration rose, so the simpler stage wins. Not adopted.

The honest reading of hybrid’s win is smaller than the table suggests. On the section configuration, three questions improved and two got worse, a net of one. On `fixed-2000-200`, the visible effect was one question moving into the top five. I chose hybrid because it was never meaningfully worse and costs no extra API money, not because the gain was large.

On the reranker, the plain section configuration is where it looked good: MRR from 0.793 to 0.889. But dense search with the **free** context header already reaches 0.889 on that chunking. The cheaper fix wins.

## The reranker failed my local bars, and AWS was not the answer

As pre-registered, the reranker was too heavy for my laptop. For 20 candidates, p95 rerank time was 715, 455, and 423 ms across the three configurations, and loading it added 1.3 GB of memory. I then ran the first fallback steps from my plan:

| Setting | p95 on large chunks | p95 on small chunks | Memory added |
|---|---|---|---|
| depth 20, batch 64 (the plan) | 715 ms | 423 to 455 ms | 1,298 MB |
| depth 20, batch 8 | 688 ms | 300 to 326 ms | 658 MB |
| depth 10, batch 8 | 355 ms | 192 to 209 ms | 650 MB |

A smaller batch halved the memory, and depth 10 brought small chunks under 300 ms, with the same MRR as depth 20. Nothing got under 500 MB. The large chunks also hit the model’s 512-token limit: 87 of 600 reranked candidates were cut off.

My plan said I would look at AWS if local performance suffered. The numbers closed that question: the rule did not adopt the reranker, so there was nothing to move. A 1 GB Lightsail server could not have held it anyway. The reranker stays built, tested, and off by default.

## Read the regressions

Counting questions that got worse is cheap. Reading why is where the learning is:

| Question | What happened | Mode |
|---|---|---|
| “How often must we post updates during a SEV1 incident?” | The answer says “update every 15 minutes”. With no stemming, BM25 never matched “updates” to “update”. | A pre-registered design choice with a visible cost. |
| “Why did the double charge happen on a technical level?” | BM25 followed the words shared with a neighbouring payments incident. Fusion lifted it, and the reranker kept it on top. | A vague question plus a neighbouring incident. |
| “Renewals are charging subscribers twice… What do I do first?” | The runbook and postmortem for the same incident swapped places on a near tie (5.87 against 5.78). | The reranker does not weigh “what do I do first”. |
| “Why don’t password reset emails arrive when the broker is unreachable?” | The one sentence naming password resets sat in a section about something else, and the reranker demoted it. | A small fact in a section about something else. |
| “What follow-up actions came out of the March checkout 502 postmortem?” | The reranker put the “Action items” section first, by reading the question against the heading. | A win, for contrast. |

The pattern: the reranker fixes “right document, wrong section” when the question echoes a heading, and it breaks cases where topic overlap points the wrong way. The questions that still fail in most stages, about a second source or a neighbouring incident, are not passage problems. That is the knowledge graph’s job in the next stage.

## Show only what the server can verify

With a retrieval stack chosen, I built `POST /incidents/{id}/diagnosis`. The design question was how to stop the model presenting an unsupported claim as evidence.

The endpoint retrieves the top five chunks and numbers them `E1` to `E5`. The prompt shows the model the numbered evidence and asks for causes, each with citations made of an evidence number and a quote copied verbatim. The model returns:

```json
{
  "answer_status": "answered",
  "causes": [
    {"claim": "…", "citations": [{"evidence_id": "E2", "quote": "…"}]}
  ]
}
```

Before anything reaches the client, the server checks each citation against the chunk the model named:

```python
found = re.search(r"\s+".join(re.escape(word) for word in words), item.chunk.text)
```

The words must match exactly, including case, while spacing and line breaks may differ. A quote needs at least 12 characters, because a phrase like “the pool” can sit inside almost any text. A cause with no valid citation is dropped and counted. The citation metadata shown to the client comes from stored data: the document, section, page, and the character span of the quote in the source. It never comes from the model’s wording.

<figure class="article-diagram" id="citation-checks">
  <img src="/images/writing/week-04-earn-the-complexity/citation-checks.svg" alt="Retrieved evidence is numbered E1 to E5. The model proposes claims and quotes. The server checks the evidence ID, exact-case quote match with flexible whitespace, and minimum quote length. Causes with no valid citation are dropped. A matching quote proves that the words exist, not that the claim follows." width="800" height="720" loading="lazy" decoding="async">
  <figcaption>The server validates citation provenance before returning a cause. Whether the evidence supports the claim remains a separate evaluation. <a href="/images/writing/week-04-earn-the-complexity/citation-checks.svg" target="_blank" rel="noreferrer">Open the full-size diagram.</a></figcaption>
</figure>

Two more decisions made “no answer” a first-class result:

- If retrieval returns nothing, the model is not called.
- The result type itself cannot hold a cause without a citation, so “every shown cause has provenance” is a property of the type, not only of the code.

The no-answer reasons are `no_evidence`, `insufficient_evidence` (the model declined), and `no_supported_cause` (every proposed cause failed the check). The offline tests cover each blocked case: an unknown evidence number, a quote that exists only in another chunk, a wrong-case quote, a too-short quote, a cause with no citations, and text inside a chunk that imitates an evidence header.

## What a real model did with it

I ran five incidents through a scratch database with the real embedding model and LLM: three that the corpus covers and two it does not.

| Incident | Result | Retrieval | Model |
|---|---|---|---|
| Checkout 502s after a release | Answered, 1 cause, 2 citations | 583 ms (first call, builds the index) | 5.3 s |
| Orders API pool exhaustion | Answered, 1 cause, 1 citation | 260 ms | 5.7 s |
| Password reset emails missing | Answered, 1 cause, 3 citations | 225 ms | 8.4 s |
| Office printers crash (off-corpus) | No answer: insufficient evidence | 309 ms | 2.4 s |
| Blurry hero image on iPhone (off-corpus) | No answer: insufficient evidence | 198 ms | 1.5 s |

The off-corpus incidents still retrieved five irrelevant chunks. The model declined to invent a cause, in under 50 output tokens each. That is two cases, not an evaluation, and it shows that nothing in the server stopped them reaching the model. A relevance threshold needs off-corpus incidents to calibrate against, so I left it for later.

The third answer showed the limit of what a citation proves. The claim combined a runbook fact with an inference from an older incident (“an expired broker certificate is a strong candidate… but the current report does not confirm it”). The model hedged it itself. The server could not have caught an overconfident version, because every quote did exist. **A citation proves the words exist, not that the claim follows.** Checking claims needs its own evaluation.

## What went wrong along the way

- The first real reranker run showed 1.3 GB of added memory on the first configuration and almost nothing on the other two. The model loads once per process, so the first configuration pays for it. I reported the first-load figure and said so.
- Several of my own test expectations were wrong: a regular expression written back to front, a case-sensitive word in an assertion, and a test document missing its tenant. The code was right each time.
- I reread the finished branch and found that selecting the rerank stack without its optional extra would let the server start, then fail every diagnosis. It now refuses to start and names the install command.
- My Homebrew PostgreSQL still cannot load pgvector, so the tests run against the container from Week 3.

## Try it yourself

```bash
uv run python -m incidentops_ai.retrieval.stack_benchmark --fake                       # offline wiring check, all stages
uv run python -m incidentops_ai.retrieval.stack_benchmark --stages dense,bm25,hybrid   # real run, no model download
uv sync --extra rerank                                                                 # optional: the local reranker
uv run --extra rerank python -m incidentops_ai.retrieval.stack_benchmark               # all four stages, three chunkings
```

The diagnosis endpoint needs the corpus ingested and indexed, an OpenAI key, a model name, and the API token. `INCIDENTOPS_RETRIEVAL_STACK` selects `dense`, `hybrid` (the default), or `hybrid-rerank`. The suite has 491 passing tests, none of which need a key, a model, or a download (one more, the real-reranker test, is skipped unless you opt in).

## What I’m carrying into the next stage

1. **Decide what counts as better before you run it.** The rule gave me permission to leave the interesting component off, which I would have struggled to do after seeing it work on one configuration.
2. **Put the cost beside the gain.** The reranker’s best result came with a 1.3 GB memory bill, and a free context header matched it.
3. **Ask how many questions a difference is worth.** A 0.029 MRR gain sounded larger than “one question net”.
4. **Make the unsupported answer impossible to display.** A system prompt that says “cite your sources” is a request. A server-side check that discards uncited claims is a guarantee.

The limits are the same as before and a little sharper. One author wrote the corpus and the 30 questions, so most differences this month are one or two questions. The memory and latency figures come from one laptop and one run each. The diagnosis check covered five incidents. There is no relevance gate, and no check that a claim follows from its quote.

What I need to learn next is how a knowledge graph can answer the questions that retrieval cannot: the ones that need a second source or a neighbouring incident. I also need larger evaluation sets, including off-corpus incidents, so the next improvement is judged on more than one or two questions.

*Project code: [IncidentOps AI on GitHub](https://github.com/AniketIndulkar/IncidentOps-AI). This is the fourth post in the series, following the retrieval foundations from Week 3. The next post covers modelling incidents, services, and fixes as a knowledge graph.*
