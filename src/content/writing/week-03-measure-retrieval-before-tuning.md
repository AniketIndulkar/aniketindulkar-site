---
title: "Building IncidentOps AI: Measure Retrieval Before You Tune It"
description: "What a near-whole-document chunking winner taught me about evidence labels, retrieval metrics, and the cost hidden behind a high score."
publishedDate: 2026-10-17
topics:
  - Retrieval
  - Evaluation
  - AI Engineering
series:
  id: incidentops-ai
  title: Building IncidentOps AI
  order: 3
draft: false
---
The chunk size that won my experiment was almost the entire document.

That was the result I trusted least in my third week building IncidentOps AI, and the one I learned the most from. A 2,000-character chunk scored best by a wide margin. It was also close to the length of the documents themselves, which meant the experiment had partly measured “can I find the right document?” rather than “is this a useful passage to retrieve and cite?”

The [first week](https://aniketindulkar.dev/writing/week-01-backend-foundations/) gave me a typed API with persistence and idempotency. The [second](https://aniketindulkar.dev/writing/week-02-valid-json-isnt-enough/) added a small LLM feature with explicit failure handling. This week was about the part between a question and a model: retrieval. Given an incident, which runbook sections and past postmortems should the system find before anything tries to diagnose it?

I built a small corpus, an evaluation set, an ingestion pipeline, five chunking configurations, embeddings stored in PostgreSQL with pgvector, and a benchmark I could run again with one command. The code and recorded results are in the [Week 3 pull request](https://github.com/AniketIndulkar/IncidentOps-AI/pull/3). The numbers below come from its 16 October 2026 runs.

## Separate retrieval from generation

Before writing code, I wrote a one-page model of retrieval:

```text
documents → chunks → embeddings → vector store
                                      │
question → embedding ──────────→ filtered search
                                      │
                                 ranked chunks
                                      │
                           later: rerank, cite, answer
```

Each stage can lose the answer in a different way:

| Stage | How it loses the answer |
|---|---|
| Parsing | Text is missing or garbled, for example in tables. |
| Chunking | The answer is cut in half, or buried in unrelated text. |
| Embedding | An important identifier, such as `PAY-1042`, is poorly represented. |
| Search | The relevant chunk ranks 12th, but only the top five are returned. |
| Context | The right passage is found but cannot be understood on its own: “it”, “the service”. |

That table changed what I measured. A wrong generated answer could come from retrieval or generation. Evidence missing from the retrieved context gives me an earlier problem to investigate, before asking a model to use it.

## Write the questions before the search

I wrote the evaluation set before implementing retrieval. The corpus contains 18 synthetic documents: 11 runbooks and seven postmortems, written to match the services in the Week 2 samples. Public incident reports would not have matched those services, so I accepted the trade-off: one author could bias both the documents and the questions.

The evaluation set contains 30 questions and 42 evidence spans, split across five question styles:

| Style | Count | Example intent |
|---|---|---|
| Lookup | 8 | “How many connections can one pod open?” |
| Paraphrase | 8 | The question avoids the document’s own wording. |
| Identifier | 5 | An error code, command, or variable name. |
| Procedure | 4 | A sequence of steps. |
| Multi-part | 5 | The answer needs two places, often a runbook and a postmortem. |

The most useful decision was the shape of the ground truth. Labelling each question with the chunk that answers it would tie the labels to one chunking configuration. Instead, each question points to an exact quote from a document. Here is one record, trimmed to the fields that matter:

```json
{
  "id": "q03",
  "category": "identifier",
  "question": "What does internal error code PAY-1042 mean and what should I do about it?",
  "relevant": [
    {
      "doc": "rb-payments-latency",
      "evidence": "| PAY-1042 | Acquirer timeout after 8 seconds | Fail over the region, see below |"
    }
  ]
}
```

At load time, the quote becomes a character span in the cleaned document. Matching tolerates differences in line wrapping and whitespace, but the quote must occur **exactly once**:

```python
pattern = r"\s+".join(re.escape(token) for token in evidence.quote.split())
matches = list(re.finditer(pattern, document.text))
```

If the quote matches zero times or more than once, loading fails. I wanted a broken evaluation set to stop the run rather than quietly produce a misleading score.

<figure class="article-diagram" id="evidence-spans">
  <img src="/images/writing/week-03-measure-retrieval-before-tuning/evidence-spans.svg" alt="A document has a fixed evidence span from character 400 to 600. In chunking A, the chunk from 300 to 700 covers all of it. In chunking B, chunks from 0 to 500 and 500 to 800 each cover half. All three count as relevant under the 50 percent coverage rule; the gold label stays unchanged." width="720" height="500" loading="lazy" decoding="async">
  <figcaption>The evidence stays fixed while chunk boundaries move. Relevance is a coverage rule, not a judgement that a passage contains a complete answer.</figcaption>
</figure>

The same quotes can judge different chunkings, embedding models, and retrievers as long as the underlying document text still matches. I committed the corpus, questions, hypotheses, and selection rule together, before adding retrieval code.

## Define what a good score means

A retrieved chunk counts as relevant when it comes from the correct document and covers at least half of a labelled evidence span. The implementation checks both:

```python
if chunk.doc_id != gold.doc_id:
    return False
overlap = min(chunk.end, gold.end) - max(chunk.start, gold.start)
return overlap >= 0.5 * (gold.end - gold.start)
```

This avoids counting a single matching word as a hit. It is still a permissive proxy: half an evidence span may not contain enough information to answer the question. Two chunks that each cover less than half are not combined to earn a hit.

For each question, I calculate:

| Metric | What it measures here |
|---|---|
| Recall@K | Fraction of labelled evidence spans covered by at least one of the top K chunks. |
| Precision@K | Number of relevant chunks in the top K, divided by K, even if fewer results are returned. |
| Hit@K | Whether at least one relevant chunk appears in the top K. |
| Reciprocal rank | `1 / rank` of the first relevant chunk; zero if none appears in the top ten. |

The reported recall, precision, and hit rate are averages over questions. **MRR@10** is the mean reciprocal rank using that ten-result cutoff.

MRR rewards finding the first useful result early. Recall asks whether the remaining evidence arrived too. A question can score perfectly on reciprocal rank while still missing half its evidence; that distinction becomes important in the failures below.

With only 30 questions, small changes deserve caution. Moving one question’s Recall@5 from zero to one changes the mean by about 3.3 percentage points; recovering half its evidence changes it by about 1.7 points. Those increments describe the benchmark’s granularity, not a statistical significance threshold. I have no confidence intervals here, and repeated runs over the same cached vectors do not add independent evidence.

## Keep every chunk traceable

A retrieval result needs a path back to its source, especially when the next stage will need citations.

Each chunk is an exact slice of the cleaned document text and carries:

```text
tenant, document id and type, service, source path,
chunker name, position, character start and end,
start and end page, and heading path
```

The parser recognises form-feed characters as page boundaries and Markdown headings as sections. It removes the page-break markers but remembers page offsets, so a chunk can be located within the cleaned document and a section such as `Orders pool exhausted > Fix`.

Three choices kept this manageable:

- **Preserve the text’s structure.** Cleaning removes trailing whitespace and excess blank lines without joining wrapped lines, which could damage lists and shell commands.
- **Use deterministic chunk IDs.** A UUID is derived from the tenant, document, chunker, and position. Repeating the same layout gives the same IDs; the ID alone does not prove that a document’s contents have stayed unchanged.
- **Make ingestion repeatable.** It runs in one transaction. Unchanged documents are skipped, changed ones are replaced, and removing absent documents requires an explicit `--prune`.

Every retrieval request also requires a tenant filter. This is preparation for later authorisation work, rather than a complete permissions system. Adding the parameter now was cheaper than threading it through every retriever and test later.

## Choose the rule before seeing the numbers

I wrote down six hypotheses before running the experiment:

- **H1:** section-aware chunks beat fixed windows on MRR.
- **H2:** very small chunks have the best precision but lose recall on multi-part answers.
- **H3:** very large chunks lower MRR because one vector blurs several topics.
- **H4:** dense retrieval is weakest on identifier questions.
- **H5:** filtering by the incident’s service raises precision.
- **H6:** `text-embedding-3-large` improves Recall@5 by less than five percentage points over `text-embedding-3-small`.

The chunking selection rule was fixed too:

1. Run all five primary configurations on the same 30 questions, with the same embedding model and no service filter.
2. Find the highest MRR@10.
3. Among configurations within 0.02 of that score, prefer the higher Recall@5, then the smaller average chunk.

Context headers and service filters were separate exploratory comparisons. Keeping them outside the primary selection made it possible to distinguish the planned decision from ideas tried along the way.

## The winning chunk was nearly a document

I compared fixed windows of 500, 1,000, and 2,000 characters, a paragraph-based chunker, and a chunker that uses section headings. These sizes are **characters, not tokens**. For example, `fixed-500-50` means a window of up to 500 characters with a configured overlap of 50.

The results below use real `text-embedding-3-small` vectors and exact cosine search. The first five rows are the primary comparison; the final row is exploratory.

| Configuration | Recall@5 | Precision@5 | MRR@10 | Mean characters in top five |
|---|---|---|---|---|
| fixed-500-50 | 0.917 | 0.260 | 0.690 | 2,332 |
| fixed-1000-100 | 0.967 | 0.273 | 0.673 | 4,198 |
| **fixed-2000-200** | **0.983** | 0.260 | **0.961** | **7,433** |
| paragraph-1000 | 0.933 | 0.227 | 0.725 | 3,659 |
| section-1500 | 0.933 | 0.233 | 0.801 | 1,961 |
| section-1500 + context header | 0.950 | 0.240 | 0.889 | 2,016 |

By the rule, `fixed-2000-200` won: MRR@10 was 0.961, against 0.801 for the next-best primary configuration. H3 had predicted the opposite.

<figure class="article-diagram" id="chunking-tradeoff">
  <img src="/images/writing/week-03-measure-retrieval-before-tuning/chunking-tradeoff.svg" alt="Two aligned bar charts compare MRR at 10 and mean characters in the top five results for six chunking configurations. Fixed 2000 wins on MRR with 0.961 but retrieves 7,433 characters. Section 1500 with a context header scores 0.889 while retrieving 2,016 characters; this is an exploratory result outside the primary selection." width="900" height="650" loading="lazy" decoding="async">
  <figcaption>The selected configuration reads about 3.8 times as much text as section-1500. The context-header result is exploratory. Source: the recorded 16 October chunking experiment. <a href="/images/writing/week-03-measure-retrieval-before-tuning/chunking-tradeoff.svg" target="_blank" rel="noreferrer">Open the full-size chart.</a></figcaption>
</figure>

The cost column is why I do not take that win at face value. The documents average about 1,900 characters. A 2,000-character window therefore approaches whole-document retrieval: this configuration produces just 23 chunks from 18 documents.

That makes finding some labelled evidence easier, while returning 7,433 characters across the top five results instead of 1,961. The count sums chunk text, including any repeated text from overlap; it is a context-size proxy, rather than a token bill or a measure of unique information.

I added that column after an offline check with hashed-word vectors ranked the same chunking first. The real embeddings later selected it too. That made corpus size a plausible explanation for the win, although it does not isolate the cause. I kept the original rule and reported the cost beside the score.

The context header was useful in a different way. Prefixing the embedded text with `document title > section` raised `section-1500` from 0.801 to 0.889 MRR@10 and `fixed-500-50` from 0.690 to 0.774. For the winning large-window configuration, it lowered MRR@10 from 0.961 to 0.950.

My interpretation is that the prefix restores context lost by a short passage. The original chunk text and citation offsets stay unchanged. Section-aware chunks with a context header are therefore a candidate to test on longer documents; this experiment does not establish how they will perform there.

## Keep embeddings and filters in the same retrieval path

The embedder is an interface with three implementations:

| Implementation | Purpose |
|---|---|
| OpenAI embedder | Real vectors, with bounded retries and SDK retries disabled. |
| Fake embedder | Deterministic hashed-word vectors for offline tests. |
| Caching embedder | Reuse vectors by text hash in separate cache files for each model and dimension count. |

The fake embedder tests the pipeline’s behaviour, not semantic retrieval quality. Its reports say so. Cached real vectors avoid another provider charge when the inputs, model, and dimensions are unchanged; a new configuration can still require new embeddings.

The database stores vectors in a `vector(1536)` column, together with the embedding model and whether a context header was used. Indexing refreshes missing vectors or those made with a different model or context setting. Changing models requires re-embedding the corpus: equal dimensions alone do not make two models’ vectors comparable.

Search is one SQL statement, with filters in the `WHERE` clause. This excerpt omits the document join, service and type filters, non-null check, and deterministic tie-breaking:

```python
distance = ChunkRow.embedding.cosine_distance(vector)
statement = (
    select(ChunkRow, distance)
    .where(
        ChunkRow.tenant_id == filters.tenant_id,
        ChunkRow.embedding_model == embedder.model,
    )
    .order_by(distance)
    .limit(k)
)
```

I chose pgvector because PostgreSQL already held the application data. It let metadata filtering and vector ranking stay in one query without introducing another store. Other vector databases can support filters too; the advantage here was keeping this project’s storage and operations simple.

I did not add an approximate nearest-neighbour index. At this scale, an exact scan is a useful reference: it returns the nearest eligible vectors without approximation error. It can still miss the evidence if those vectors rank the wrong passages highly.

A test compares pgvector’s ranking with an in-memory reference across all 30 questions, with and without the service filter. That checks agreement between implementations; it does not establish that either ranking is useful.

## Establish the dense baseline

Using the chosen chunking and `text-embedding-3-small`, the pgvector benchmark reported:

| Measure | Result |
|---|---|
| Recall@1 / 3 / 5 / 10 | 0.800 / 0.983 / 0.983 / 1.000 |
| Hit@1 | 0.933 |
| MRR@10 | 0.961 |
| Query latency | Mean 210 ms; p95 285 ms. Includes query embedding and database search. |
| Questions below full Recall@5 | 1 of 30 |

These are measurements from this run, rather than a latency guarantee. The recorded findings attribute most query time to the embedding request.

The embedding-model comparison was a smaller story. `text-embedding-3-large`, shortened to the same 1,536 dimensions, improved Recall@5 by zero percentage points on the chosen configuration: both scored 0.983. That met my rule for keeping the cheaper small model on this benchmark. It does not establish that the models are equivalent on other questions or corpora.

## Read the failures across configurations

The chosen baseline had only one question below full Recall@5. The ten cases I inspected therefore include failures from other chunkings and cases where relevant evidence was retrieved but ranked below less useful passages. They are not ten failed questions in the winning baseline.

Four were particularly useful:

| Case and configuration | What happened | What it suggests testing |
|---|---|---|
| February notification outage; chosen chunking | The postmortem ranked first, but the runbook evidence was absent from the top five. | Whether query expansion or better source coverage can recover the second source. |
| `INDEXER_BATCH_SIZE`; fixed-500 and section chunks | A passage using the variable outranked the sentence defining it. | Whether a reranker can distinguish a definition from a mention. |
| SMS provider throughput; chosen chunking | The relevant fact ranked third, with low similarity scores across the top results. | Whether smaller passages represent the specific fact better. |
| Checkout 502 and keepalive mismatch; section chunks | General topic matches crowded out the passage containing “keepalive”. | Whether keyword retrieval adds evidence the dense ranking missed. |

The first case shows why MRR and recall need to be read together:

<figure class="article-diagram" id="first-hit-isnt-full-recall">
  <img src="/images/writing/week-03-measure-retrieval-before-tuning/first-hit-isnt-full-recall.svg" alt="For question q25, the first result contains postmortem evidence A and results two through five are unrelated postmortems. Runbook evidence B is missing. This gives reciprocal rank 1, evidence Recall at 5 of 1 out of 2, and Precision at 5 of 1 out of 5." width="720" height="530" loading="lazy" decoding="async">
  <figcaption>q25 earns a perfect reciprocal rank while missing half its labelled evidence. MRR averages reciprocal ranks; it does not measure completeness.</figcaption>
</figure>

The SMS scores were another caution. Low similarity alone does not diagnose the cause, and these values are not a confidence threshold. Reading the passage suggested that a small fact was diluted inside a large chunk. That is a hypothesis for the next comparison.

## Revisit the hypotheses

| Hypothesis | What this experiment showed |
|---|---|
| H1: section-aware beats fixed windows | Partly supported: it beat the two smaller fixed windows, but lost to the near-document-sized one. |
| H2: small chunks maximise precision but lose recall | Partly supported: fixed-500 had the lowest Recall@5, but fixed-1000 had higher Precision@5. |
| H3: large chunks lower MRR | Contradicted on this corpus: the largest configuration won. |
| H4: identifiers are dense retrieval’s weakest category | Contradicted on the chosen configuration: identifier MRR@10 was 1.000. |
| H5: a service filter raises precision | A small observed gain: Precision@5 moved from 0.260 to 0.267. This does not establish a general effect. |
| H6: the large model gains fewer than five Recall@5 points | Consistent with this run: no gain on the selected configuration. |

Writing these down first made the disagreements visible. Without that record, I might have remembered only that large chunks worked well and missed how much the corpus shaped the result.

## What went wrong along the way

- **My local PostgreSQL lacked pgvector.** The Homebrew PostgreSQL 14 instance did not have the extension installed. The project switched its test, CI, and Compose setup to `pgvector/pgvector:pg17`. This was a local installation issue: the [pgvector installation guide](https://github.com/pgvector/pgvector#installation) lists support for PostgreSQL 13 and later.
- **The API key expired on the first real run.** The provider returned HTTP 401. Work continued with offline tests, and real results were recorded after the key was replaced. The project notes put the embedding runs’ cost at a few cents.
- **Three tests encoded the wrong assumptions.** A paragraph in the fixture was 61 characters rather than 70; a chunk spanning pages two and three starts on page two; and a chunk beginning at a title line can carry the title’s section. I corrected those expectations after checking them against the specified behaviour.

## Reproduce the measurements

The [Week 3 branch](https://github.com/AniketIndulkar/IncidentOps-AI/tree/feat/w03-retrieval-foundations) contains the corpus, questions, and runners. Use its README to install dependencies, configure a pgvector-enabled PostgreSQL database, and apply migrations. The recorded [chunking experiment](https://github.com/AniketIndulkar/IncidentOps-AI/blob/3f8e81584ec876986f5f0f7fcb67389282585768/evals/retrieval/runs/2026-10-16-chunking-text-embedding-3-small.md) and [dense baseline](https://github.com/AniketIndulkar/IncidentOps-AI/blob/3f8e81584ec876986f5f0f7fcb67389282585768/evals/retrieval/runs/2026-10-16-dense-baseline.md) preserve the results discussed here.

With the database configured and `OPENAI_API_KEY` set, run from the project root:

```bash
# Parse and store the corpus using the selected chunking.
uv run python -m incidentops_ai.retrieval.ingest data/corpus

# Embed the stored chunks.
uv run python -m incidentops_ai.retrieval.index

# Measure the dense retriever.
uv run python -m incidentops_ai.retrieval.benchmark

# Compare the five chunking configurations and exploratory variants.
uv run python -m incidentops_ai.retrieval.chunking_experiment
```

For an offline wiring check that needs neither an API key nor a database:

```bash
uv run python -m incidentops_ai.retrieval.chunking_experiment \
  --fake --out-dir /tmp/incidentops-retrieval-wiring
```

That command uses hashed-word vectors and does not measure semantic retrieval quality. The PR records 387 tests at the end of Week 3, with fake embeddings and no model calls. The test suite still requires a dedicated pgvector-enabled test database.

## What I’m carrying forward

This week changed how I approach retrieval in four ways:

1. **Write the evaluation before tuning.** The questions, hypotheses, and selection rule existed before the first retrieval result.
2. **Keep labels independent of chunk boundaries.** Quotes let the same evidence judge five chunkings and two embedding models.
3. **Put context size beside retrieval quality.** MRR alone would have hidden how much text the winner returned.
4. **Read the retrieved passages.** The averages described the baseline; inspecting individual cases suggested what to test next.

The limits matter. One author wrote 18 synthetic documents and 30 questions. The same questions helped select the configuration and report its baseline, so this is a development benchmark rather than an independent held-out evaluation. The 50% coverage rule is permissive, and labelled quotes do not necessarily exhaust every useful passage.

Precision@5 also needs care: several overlapping chunks can match the same evidence span and each count as relevant, so the number of evidence spans does **not** impose a fixed precision ceiling. A higher score need not mean more distinct evidence.

The next stage is to test whether keyword search, rank fusion, and reranking address the failures I actually observed, and whether their gains justify their cost. That comparison needs the section-based configuration too, because the selected baseline is already near the ceiling of this small benchmark. Beyond retrieval, I need to learn how to produce an answer whose claims trace back to sources—and how to make “I don’t have evidence for that” an allowed outcome.

*Project code: [IncidentOps AI on GitHub](https://github.com/AniketIndulkar/IncidentOps-AI). This is Week 3 of the Building IncidentOps AI series. The next post covers hybrid retrieval and diagnosis grounded in retrieved evidence.*
