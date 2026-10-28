---
title: "What Production Android Teams Learned That the Docs Can't Teach"
description: "Fifty-three engineering write-ups from Meta, Grab, Square, Duolingo, Signal and others, and the twelve patterns that keep reappearing in them."
publishedDate: 2026-10-28
topics:
  - Android
  - Performance
  - Architecture
draft: false
---
Android documentation is very good at explaining what a tool does.

It will tell you precisely what `WorkManager` guarantees, how R8 shrinks and rewrites code, what a Baseline Profile contains, how App Links verification works, and which coroutine scope cancels when. It is accurate, well maintained, and genuinely better than most platform documentation.

What it does not explain is what happens when a technically correct tool meets a hundred engineers, ten thousand device models, eight years of accumulated code, a product roadmap competing for the same headcount, and a release that has to go out on Tuesday.

That second layer only appears in production write-ups. So I read fifty-three of them: first-party engineering blogs from Meta, Grab, Square, Dropbox, Cash App, Spotify, Discord, Signal, DoorDash, Duolingo, Instacart, SoundCloud, Shopify, Pinterest and Mozilla, plus the Android case studies Google publishes with the teams involved.

Twelve patterns kept reappearing. None of them is in the documentation, and most of them contradict the obvious reading of it.

## How to read the evidence

The cases below vary a lot in rigour, and it matters which kind you are looking at.

Some are complete chains: production problem, measured root cause, decision, rollout, field outcome, and the guardrail that stopped it coming back. Meta's MobileLab, Grab's TLRU cache work and Duolingo's performance programme are all like this.

Others disclose the interesting engineering but not the outcome. Cash App's Molecule work is a genuinely novel idea with no published metrics. Signal's encrypted storage case is one of the most instructive in the whole set and reports no numbers at all.

A third group are vendor case studies co-published with Google. These have real measurements, but the measurements are chosen by a party with an interest in the result. Reddit's Baseline Profiles numbers are useful. They are not a controlled experiment.

I have tried to say which kind each one is as I go, because "51% faster startup" from a co-published case study and "we detected a 1% regression" from an internal benchmark lab are very different claims.

One more caveat worth stating early: almost every number below is self-reported, measures something slightly different from every other number, and comes from a team that chose to publish because the result was good. Nobody blogs about the optimisation that did nothing.

## 1. The loop that keeps reappearing

Before the individual patterns, there is a shape.

Across Meta, Grab, Lyft, DoorDash, Spotify, Duolingo, Square and Pinterest, the strongest cases follow the same sequence, and the differences between a famous result and a forgettable one are usually in the last two steps rather than the middle.

<figure class="article-diagram">
  <img src="/images/writing/android-production-lessons/production-performance-loop.svg" alt="A seven-stage cycle: field telemetry from real devices, segmenting by device, OS, network and journey, reproducing the actual bottleneck, removing, deferring, caching or redesigning the work, a staged rollout or experiment, verifying user and guardrail metrics, and finally encoding a regression signal in CI or tooling, which feeds back into field telemetry." width="720" height="620" decoding="async">
  <figcaption>The last two stages are what separate a result from a temporary remediation.</figcaption>
</figure>

Most engineering advice concentrates on the middle of this loop, the part where you make something faster. The case studies suggest the middle is the easy part. Teams that stopped at "fix shipped" tended to be back a year later. Teams that reached "regression signal automated" and "ownership assigned" stayed fixed.

I will come back to that in the final section, because it is the single most consistent finding in the corpus.

## 2. Measure the machine before you read the code

Meta's [MobileLab](https://engineering.fb.com/2018/10/19/android/mobilelab/) is my favourite case in the collection, because the problem it solves is one most teams do not know they have.

Meta runs performance tests against thousands of changes a day on real devices. The tests were noisy. Not noisy in an annoying way, noisy in a way that made them useless: the variance between runs on the same device was larger than the regressions the tests existed to catch.

The cause was physical. Android devices change CPU and GPU frequency in response to temperature and battery state. A phone that has been running tests for twenty minutes is a different computer from the same phone at room temperature. Add variance from live backend services and the signal disappears entirely.

The fix was not better test code. Meta built controlled device racks, pinned frequency and governor settings, replayed recorded HTTP traffic instead of hitting live services, and computed confidence intervals across repeated runs. Reported result: detection of roughly 1% performance changes, confidence intervals about 7 times tighter, and 75% fewer false positives.

The transferable claim is uncomfortable. **If you have not characterised your benchmark's variance, you do not know whether your last optimisation did anything.** A 3% improvement measured on a laptop-tethered phone in an open-plan office is not a measurement, it is a mood.

[Profilo](https://engineering.fb.com/2018/03/13/android/profilo-understanding-app-performance-in-the-wild/) makes the same argument from the production side. Meta could see from telemetry *that* a regression had happened, and frequently could not see *why*. Full tracing is far too expensive to leave running, and naive stack collection at high event rates distorts the thing it measures.

So they built a low-overhead, remotely configurable on-device tracing stack with custom stack unwinding, sampled across real users. The reported effect is the one worth stealing: a cold-start investigation that previously took days came down to under an hour in their example, and the system could detect regressions measured in tens of milliseconds.

Meta's earlier [instrumentation work](https://engineering.fb.com/2015/10/26/android/performance-instrumentation-for-android-apps/) found the related failure mode. Hand-written begin and end markers rot. As asynchronous flows evolve, manually paired timers stop covering the real path, and the instrumentation becomes confidently wrong. Their answer was to instrument at framework boundaries and propagate performance context across asynchronous execution automatically, so the measurement follows the code rather than being maintained alongside it.

Mozilla hit a softer version of this with [Firefox for Android's profiling pipeline](https://blog.mozilla.org/performance/2026/02/03/the-road-to-better-performance-profiles/). CI was producing Simpleperf profiles that were technically available and practically unusable, because native profile addresses need correct symbols and the tooling drifts. They built a pipeline that converts and symbolicates automatically and uploads clickable profiles to Treeherder. No user-facing outcome yet, but the principle is clean: observability only counts if the cost from red test to readable flame graph is close to zero.

Four companies, four different scales, one conclusion: at production scale, profiling is a data engineering problem, not a button in the IDE.

## 3. Averages hide the users you are losing

The most repeated mistake in the corpus is optimising a global median while a specific cohort suffers.

[Duolingo's 2025 performance write-up](https://blog.duolingo.com/android-app-performance/) is the clearest example. Their aggregate numbers looked acceptable. Segmented by device class, 39% of entry-level Android users were waiting more than five seconds for startup. After a dedicated performance team and over 200 Android experiments in 2024, that fell to 8%, and app-open conversion moved from 91% to 94.7%.

Note the second number. The startup fix was not a developer-satisfaction win, it was a conversion win, and it was invisible in the average.

Meta found this a decade earlier, in person. [Engineers travelled to emerging markets](https://engineering.fb.com/2014/06/19/android/improving-facebook-on-android/) and encountered single-core, low-memory phones, intermittent connectivity, and users exhausting data plans within days. Startup was initialising large numbers of unrelated features at once. Deferring that work until after first usable UI contributed to a reported startup-time reduction of more than 50% over six months.

The structural follow-up was [Year Class and Connection Class](https://engineering.fb.com/2015/03/26/android/classes-performance-and-network-segmentation-on-android/), built after Meta counted more than 10,000 active Android device models. The insight is that **device model is the wrong dimension**. It is simultaneously too granular to act on and a poor proxy for capability. RAM, CPU and storage characteristics matter; the name on the back does not. Likewise `NETWORK_TYPE` is a bad proxy for network quality, because LTE is frequently slower than Wi-Fi. Both abstractions are deliberately lossy, and both are more useful than the precise thing they replace.

Grab reached the same place from storage. [Project Bonsai](https://engineering.grab.com/project-bonsai) targeted app size specifically because Southeast Asian users on low-storage devices and uneven networks paid disproportionately for binary growth, and they reported a 26% reduction in download size across a codebase of over four million lines.

Discord found it in memory. Their [mobile performance work](https://discord.com/blog/supercharging-discord-mobile-our-journey-to-a-faster-app) showed low-end Android phones blanking frames or running out of memory in emoji-heavy surfaces, in a test involving emoji from around 200 servers. The same surface was fine on the devices the team carried.

<figure class="article-diagram">
  <img src="/images/writing/android-production-lessons/cohorts-not-averages.svg" alt="A healthy-looking overall percentile splits into four segmentation dimensions: device capability cohort, Android or vendor version, network quality cohort, and journey or feature. All four converge on locating the harmed tail, which is then the population to optimise." width="720" height="560" loading="lazy" decoding="async">
  <figcaption>A median can stay flat while an entire cohort degrades underneath it.</figcaption>
</figure>

The practical form of this is simple and annoying: a performance dashboard with one number per metric is a dashboard that will hide your worst users from you. You need at least capability cohort, OS or vendor version, network quality and journey, and you need them before the incident rather than during it.

## 4. Remove work before you make work faster

Several of the strongest results in the corpus are not optimisations at all. They are deletions.

The underlying arithmetic is hard to argue with: the fastest possible execution of unnecessary work is zero.

Facebook deferred feature initialisation rather than speeding up initialisers. [Lyft](https://android-developers.googleblog.com/2022/03/how-single-android-developer-improved.html) moved blocking network calls off the launch path and cached data across sessions rather than fetching it faster. Duolingo restructured the end of a lesson so the Session Complete screen appears while network work finishes, rather than optimising the network call that users were staring at. [Dropbox](https://dropbox.tech/mobile/revamping-the-android-testing-pipeline-at-dropbox) stopped running irrelevant test suites. [Square](https://developer.squareup.com/blog/supercharging-continuous-integration-with-gradle/) stopped running irrelevant CI shards.

None of these made anything faster in the sense the word usually means.

This suggests a better profiling checklist than "which method is slow?":

1. Does this operation need to happen at all?
2. Does it need to happen every time?
3. Does it need to happen now?
4. Does the user need to wait for it?
5. Only then: can it execute faster?

Duolingo's version of question four is the most interesting one in the corpus, because it is a product decision disguised as a performance decision. They reported reducing perceived session-end latency by more than 60%, not by making the backend call faster, but by deciding the user's task was complete before the server agreed. **The user's critical path and the program's critical path are different objects.** Treating them as the same thing is why so much latency work produces no measurable user effect.

The trade-off is real and they name it: work completing after the UI has moved on creates eventual-state and error-handling complexity. Something has to reconcile when the background call fails after the user has already seen a success screen.

Meta's [ReDex](https://engineering.fb.com/2016/04/12/android/open-sourcing-redex-making-android-apps-smaller-and-faster/) is the same principle applied one level down, and it is the case that surprised me most. Startup classes scattered across DEX files cause extra storage reads, and random flash I/O is dramatically more expensive on cheap devices. ReDex performs profile-guided class layout, physically placing startup-hot code together. First production deployment reported a 25% smaller APK and up to 30% faster startup.

Two functionally identical APKs can start at measurably different speeds purely because of where the bytes landed. That is not a dimension most Android engineers consider to exist.

## 5. Telemetry is an organisational instrument

This is the pattern I expected least and now think about most.

Lyft Driver's startup was roughly 15 to 20% worse than comparable apps. The engineering problem was not mysterious: blocking network calls, launch-critical initialisation that was not actually launch-critical, and data refetched between sessions. Any competent Android engineer could have listed those causes.

The actual blocker was that performance work competed with product work for headcount, and lost.

What changed it was Android vitals. Not as a diagnostic tool, as an argument. The data made the problem legible to people who decide where engineers go, and that bought one engineer for one month. Reported outcome: 21% startup reduction and a 5% increase in driver sessions, which in turn funded a continuing mobile performance workstream.

The metric's job was persuasion. The profiler's job came afterwards.

Spotify's [developer experience work](https://engineering.atspotify.com/2022/10/how-we-improved-the-development-experience-for-our-client-developers) is the same lesson pointed at a budget rather than a roadmap. They studied 318 engineers, found build latency was damaging satisfaction, and then did something most engineering organisations never consider: they benchmarked Apple silicon, built a financial case, and accelerated a hardware refresh across hundreds of developers in eleven countries. Overall builds came out 43% faster, Android builds up to 50% faster, and more than 90% of surveyed upgraded developers rated their perceived productivity 5 out of 5.

The highest-return build optimisation available to them was a purchase order.

[Square's configuration cache work](https://developer.squareup.com/blog/5-400-hours-a-year-saving-developers-time-and-sanity-with-gradles/) frames the same argument in the unit that actually moves decisions. Not "a clean build takes 136 seconds" but "this organisation spends 182 hours a week waiting for local builds". After the work, that figure was reported at 25 hours a week, with observed local builds falling from about 136 to 74 seconds and an estimated 5,400 developer-hours recovered per year.

One clean-build benchmark is a fact. Collective waiting time is a budget line.

[LINE's lint work](https://engineering.linecorp.com/en/blog/synchronizing-geographically-distributed-teams-with-lint) is the smallest version of this idea and possibly the most immediately usable. Their distributed teams were spending review bandwidth repeating the same conventions, so they encoded the conventions as Android Lint rules. The reasoning generalises: when a review comment appears for the third time, it has stopped being feedback and started being build tooling you have not written yet.

## 6. Caches are consistency systems, not maps

Three cases in the corpus form an unusually good set when read together, because each exposes a different face of the same object.

[Grab's TLRU work](https://engineering.grab.com/reclaiming-tetabytes-optimizing-android-image-caching-with-tlru) is the storage face. Their image cache used standard LRU, which has no concept of age: an image can survive indefinitely because it was popular once, long after it stopped being useful. They modified the proven disk-cache implementation into a time-aware LRU combining recency with TTL, and migrated the existing cache rather than clearing it.

The part worth copying is not the data structure. It is that they **defined an acceptable cache-hit degradation before rollout, accepted up to a 3 percentage point decline, and coordinated backend capacity to absorb the extra requests that decline implied**. Reported result: P95 device footprint down around 50 MB, aggregating to terabytes reclaimed across their install base, with hit ratio staying inside the guardrail and no reported infrastructure cost increase.

That is the difference between a local optimisation and production systems engineering. The eviction policy was treated as a negotiation between four budgets rather than a tuning parameter.

[DoorDash's payments work](https://careersatdoordash.com/blog/eight-things-we-learned-from-implementing-payments-in-the-doordash-android-app/) is the correctness face. Their original architecture modelled everything as a Card. Wallets, credits and country-specific rules then produced duplicated calculations across domain and UI layers, because the repository was not the single source of truth and each layer recomputed payment decisions independently. Caching payment data makes checkout faster; stale device or server state breaks it.

Their general lesson is broader than caching, and I think it is the most reusable sentence in the whole corpus: **model the concept that will expand, not today's provider.**

[Signal's storage management](https://signal.org/blog/storage-management-for-android/) is the security face, and it is the case I would hand to anyone who thinks encryption is a storage-layer decision. Signal encrypts SQLite via SQLCipher and encrypts media blobs itself, because device-level full-disk encryption has historically been inconsistent. The consequence is that ordinary Android image and video APIs, which expect readable files, cannot operate on the stored representation at all. Signal had to build its own storage visualisation and RAM-based alternatives wherever standard media APIs could not consume ciphertext.

Encryption at rest is not a persistence choice. It propagates outward and invalidates assumptions in APIs that look completely unrelated to it.

<figure class="article-diagram">
  <img src="/images/writing/android-production-lessons/cache-policy-budgets.svg" alt="A single cache policy decision fans out into seven separate budgets: freshness and time to live, device storage, user network data, backend load, security sensitivity, offline requirement, and migration behaviour on rollout." width="720" height="520" loading="lazy" decoding="async">
  <figcaption>Each arrow is a budget someone owns. Most cache bugs are an unowned arrow.</figcaption>
</figure>

## 7. Build time is architecture, and modules are not free

There is a progression across Dropbox, Square and Grab that reads like a single escalating story.

[Dropbox](https://dropbox.tech/mobile/modernizing-our-android-build-system-part-i-the-planning) started with a custom build layer called BMBF that regenerated `build.gradle` state during builds. This defeated Gradle's incremental and up-to-date checking, and created a second build language every engineer had to learn. They [replaced it](https://dropbox.tech/mobile/modernizing-our-android-build-system-part-ii-the-execution) with standard Gradle and Kotlin conventions, having explicitly evaluated Bazel and rejected it: Bazel offered scale but at the time lagged on Android capabilities such as App Bundle support and implied far more internal ownership.

The lesson they draw is one most teams underweight. A custom build system is debt not primarily because it is slow, but because every new Android engineer must learn your private ecosystem instead of the public one.

[Square](https://developer.squareup.com/blog/evolution-of-developer-productivity-at-square-part-two/) shows the next scale. With thousands of modules, the bottleneck stopped being compilation. Configuration, dependency-graph traversal and IDE synchronisation became major cost centres in their own right, and they attacked different phases separately: configuration caching, development apps that build a feature in isolation at a reported 18 seconds against 96 for the full build, cloud workstations, and shard-skipping analysis that itself fell from about 11 minutes to 2.

Their uncomfortable finding is the one that contradicts standard advice: **modularisation was contributing to the slow graph traversal.** It improved compilation and code ownership while degrading configuration and IDE performance.

[Grab](https://engineering.grab.com/how-we-improved-android-studio-in-large-monorepo) pushes it to the end point. At roughly 2,000 modules and 11 million lines, simply letting Android Studio know every module existed was too expensive. Full sync ran to tens of minutes and consumed around 10 GB of memory. Their Focus plugins load only a selected module and its dependency slice, bringing sync under a minute for suitable modules and memory to around 2 GB. The trade-off is explicit and genuinely costly: cross-repository Find Usages and refactors are incomplete in focused mode, and developers switch back to full sync when they need them.

A monorepo does not imply that every developer tool should see the monorepo. Repository topology and IDE topology are allowed to differ.

<figure class="article-diagram">
  <img src="/images/writing/android-production-lessons/build-optimisation-ladder.svg" alt="Five escalating build optimisation stages: optimise compilation, then optimise configuration, then skip unaffected work, then build features in isolation, and finally stop the IDE loading the unrelated repository. Each stage becomes relevant at a larger codebase scale than the last." width="720" height="400" loading="lazy" decoding="async">
  <figcaption>Each rung only becomes the bottleneck once the one below it is solved.</figcaption>
</figure>

[Pinterest](https://medium.com/pinterest-engineering/slashing-ci-wait-times-how-pinterest-cut-android-testing-build-times-by-36-feb6ff121d91) adds the scheduling corollary. Their instrumented tests were distributed by package, which meant shard wall time was set by the slowest shard, and test count turned out to be a poor approximation of runtime. They fed historical per-test runtimes into greedy min-heap load balancing, with round-robin fallback for tests with no history. Reported result: end-to-end CI down 36%, about 9 minutes a build, and the slowest shard down 55%.

Shard by predicted cost, not object count. Test scheduling is a bin-packing problem and historical timings are the input you already have.

[Cash App's Metro migration](https://code.cash.app/cash-android-moves-to-metro) is the dependency-injection version. Dagger with Anvil and kapt was blocking K2 adoption. After migrating, they reported ABI incremental builds falling from 28.77 to 11.93 seconds and non-ABI from 17.45 to 7.15, with raw compilation down about 17%.

## 8. Production architecture is allowed to be asymmetric

A recurring instinct in Android architecture is consistency: one implementation, one platform strategy, one way of doing a thing. Three cases argue against it, each in a different direction.

[SoundCloud's Dagger Reflect work](https://developers.soundcloud.com/blog/dagger-reflect/) says developers and users can need different implementations. Code-generation DI deliberately moves reflection cost from runtime into compile time, which is correct for users and increasingly punitive for engineers: one of their example builds spent 42 of 59 seconds in annotation processing and generated a component over ten thousand lines long. Their answer was to use reflection-based DI during development, where the equivalent glue generation took around 60 milliseconds, while production continued shipping generated Dagger.

Developer latency and user latency are separate products and may deserve separate solutions.

[Discord](https://discord.com/blog/supercharging-discord-mobile-our-journey-to-a-faster-app) says Android and iOS can need different implementations. Their emoji surface failed on low-end Android through memory pressure in a way it did not on iOS, so they recycled components on Android specifically, used native Android implementations where they performed better, and moved animated emoji from GIF to WebP, reporting 60 FPS on a Galaxy A14 in the showcased path. They are explicit that this accepts greater maintenance divergence between platforms.

[Shopify](https://shopify.engineering/shop-app-migration) says the same company's architecture can rationally reverse over time. React Native served Shop well for years. What changed was not that React Native got worse: the next architecture migration required major reinvestment at the same moment that coding agents altered the cost of maintaining two native implementations, particularly with a working RN app available as a behavioural reference. A six-engineer core team shipped a greenfield Kotlin and Compose rebuild in twelve weeks.

I would read Shopify's conclusion carefully rather than enthusiastically. They are not claiming native beats cross-platform. They are claiming **architecture decisions have an economic half-life**, and a choice that was correct in 2020 can invert when the cost structure of implementation changes underneath it. The showcased 120 FPS figure is a demo path, not a fleet metric, and they do not present it as one.

The common thread across all three is not "go native" or "use reflection". It is: optimise for the expensive constraint you actually have, and keep enough observability to notice when that constraint changes.

Two adjacent cases are worth naming here. Cash App's [Molecule](https://code.cash.app/the-state-of-managing-state-with-compose) work found that the Compose *runtime* was valuable independently of Compose UI, using it to produce state declaratively with no widgets involved. [Redwood](https://code.cash.app/native-ui-and-multiplatform-compose-with-redwood) extends that to cross-platform, sharing the tree-building semantics while each platform renders with native controls. Both separate state composition from rendering technology, which is an asymmetry the frameworks themselves do not advertise.

Meta and Google's [Instagram Direct Compose migration](https://android-developers.googleblog.com/2026/09/jetpack-compose-ai-native-ui-instagram-direct.html) found the inverse asymmetry: migrating in small islands was worse than migrating large surfaces, because mixed hierarchies add interop complexity and prevent composition-level optimisation across the tree. They report the UI codebase shrinking by around half, with agent execution down 35% and token cost down 33%. Incremental is usually the safe default, and here it was the expensive one.

## 9. Some Android bugs live on a web server

[DoorDash's Android 12 deep link failure](https://careersatdoordash.com/blog/your-deep-links-might-be-broken-web-intents-and-android-12/) is the case I would put in front of anyone who tests only inside the APK.

Links from search, email and the web that previously opened the app started silently opening the browser instead. Nothing in the app had changed. Android 12 changed generic HTTP and HTTPS intent resolution so that domain ownership must be verified, which meant correct-looking manifest intent filters were no longer sufficient.

The fix touches almost nothing a mobile engineer controls: `autoVerify` in the manifest, a Digital Asset Links `assetlinks.json` file hosted over HTTPS with the right content type and no redirects, reachable by Google's verifier, containing the right signing fingerprints.

So the complete failure surface for this feature includes a web server's redirect configuration, a content-type header, bot accessibility rules, your release signing identity, and an OS verification process you cannot observe directly. No amount of unit testing Kotlin proves that path works.

Mozilla's [DNS-over-HTTPS rollout](https://blog.mozilla.org/en/firefox/dns-android/) is a quieter version of the same boundary. Encrypted DNS adds a latency tax that compounds across queries, and the determining factor was resolver and CDN behaviour rather than client-side encryption cost. Their performance work with partners produced a reported 61% improvement in P75 DoH lookups in the cited deployment, reaching roughly native-DNS latency, and Android defaulting stayed contingent on those measurements. Sometimes the fix for your app's latency is not in your app.

[SoundCloud's Oboe migration](https://developers.soundcloud.com/blog/soundcloud-is-playing-the-oboe/) makes the hardware version of the argument. Android audio latency and device behaviour vary substantially by manufacturer and API level, because OpenSL ES implementations carry device-specific quirks and AAudio was not universally available. Adopting Oboe let them use AAudio where appropriate with OpenSL ES fallback, keeping device workarounds behind one abstraction, and production telemetry showed around 10% lower overall latency.

On Android hardware APIs, the documented contract is half the interface. The OEM matrix is the other half, and it is not written down anywhere.

[DoorDash's passkeys rollout](https://careersatdoordash.com/blog/doordash-supporting-passkeys-to-create-a-secure-and-seamless-login-experience/) adds the identity version: passkeys exist simultaneously in client credential stores and server records, and account renames, deletions or unsynchronised state can leave a user holding a credential the server does not recognise. Their approach was staged introduction with fallback authentication rather than mandatory conversion. An authentication mechanism that strands a legitimate user is a production incident regardless of how secure it is.

## 10. Size and stability are ownership problems

Three companies independently concluded that app size cannot be fixed, only governed.

[Spotify built Ruler](https://engineering.atspotify.com/2022/02/introducing-ruler-our-tool-for-measuring-android-app-size) because existing tools could show what was inside the APK but not who in a thousand-module organisation owned each byte. Size is an emergent property of a dependency graph: a library arrives transitively, no individual pull request looks irresponsible, and attribution is the hard part rather than measurement. Ruler produces daily historical reporting and per-PR size deltas. After more than six months they reported just over 9% size reduction.

Their framing is the useful one. A size tool should not answer "what is large?" It should answer **"who can do something about it?"**

[DoorDash](https://careersatdoordash.com/blog/doordash-shrinking-your-mobile-app/) reached the same design independently: release-over-release reports, main-branch delta alerts, and a mandatory review group for new assets. Both of their apps shrank 7% and, more importantly, the upward trend stopped. Grab's Bonsai work established the same measure, reduce, contain workflow with every merged commit monitored.

The shared conclusion is that App Bundles solve delivery waste, not architectural growth. A mature app needs internal cost accounting for bytes, because organisational growth adds them one reasonable dependency at a time.

[Grab's stability work](https://engineering.grab.com/app-stability-at-scale-with-a-layered-defense) applies the same thinking to crashes, and is refreshingly unambitious about it. There is no testing layer that catches everything, because device, configuration and state combinatorics make complete pre-release proof unrealistic. So they stack imperfect filters: static checks and tests, a mandatory employee and early-access release, automated new-crash detection and ticketing, staged production rollout, feature flags, and on-call Crashlytics thresholds. Early access catches new crash classes monthly before they reach production.

Reliability here is not a pre-release property. It is a sequence of filters each of which is allowed to leak.

## 11. Large migrations need a compatibility seam

The migration cases agree on something that sounds obvious and is routinely ignored: design the coexistence period before designing the end state.

Cash App's Metro migration kept old and new DI systems working simultaneously through compatible generated-factory boundaries and parallel source sets, so the project stayed buildable and testable throughout, and only then removed kapt, Anvil and Dagger.

Shopify's native rebuild preserved sign-in, push and analytics continuity specifically so the migration would appear to users as an ordinary update.

[Spotify's platform migration guidance](https://engineering.atspotify.com/2022/11/strategies-and-tools-for-performing-migrations-on-platform) is the organisational version, and it is the one I would read first if I were planning anything large. Their codebase grew 29%, 49% and 23% in successive years across more than a hundred squads. Their conclusion is that scope uncertainty and communication cost dominate technical implementation, so they run POC to alpha to beta to GA, automate the migration itself, and associate around 2,200 components with owning systems before asking anyone to move.

At hundreds of engineers, migration ergonomics is part of API design. Build the migration tooling before announcing the migration.

[Duolingo's two-year Kotlin migration](https://blog.duolingo.com/migrating-duolingos-android-app-to-100-kotlin/) shows the socio-technical half. What got them to 100% was not syntax conversion, it was scheduled port work, recurring reviews, a Kotlin-specific reviewer role, and lint enforcement. [LINE's earlier Kotlin adoption](https://engineering.linecorp.com/en/blog/why-we-use-kotlin-in-line-creators-studio) found the same thing from the other end: the first real friction was not runtime behaviour but test architecture, because mocking final Kotlin classes forced them toward interfaces. Interoperability is what made the experiment reversible, which is why it was safe to run at all.

[Dropbox's Store rewrite](https://dropbox.tech/mobile/store-grand-re-opening-loading-android-data-with-coroutines) is worth naming for its framing rather than its metrics, of which there are none. Moving from callbacks and Rx to coroutines and Flow was not about syntax. Structured concurrency is ownership of work: who is responsible for cancelling this, and what happens when the thing that wanted the result is gone.

[Instacart's Formula](https://www.instacart.com/company/how-its-made/what-the-formula-managing-state-on-android/) names the constraint behind most of these migrations honestly. Their Rx patterns were not wrong, they became hard to teach as the team grew. Architecture has a people-scale limit, and a pattern that works for five experts can be a bad production choice for fifty engineers of mixed experience. Their [Coil](https://www.instacart.com/company/how-its-made/introducing-coil-kotlin-first-image-loading-on-android/) work is the counterpoint: sometimes owning a foundational library is worth it when it removes organisational friction as well as runtime overhead, though open-sourcing it converts that into a maintenance contract.

The Compose case studies sit in the same bucket. [Clue](https://android-developers.googleblog.com/2023/04/clues-development-speed-improves-after-rebuilding-with-jetpack-compose.html) reported some work becoming two to three times faster after rebuilding around Compose and a shared design system, and [Max](https://android-developers.googleblog.com/2024/06/max-implemented-ui-changes-faster-using-jetpack-compose.html) estimated UI changes roughly 30% faster than Views. Both are co-published and largely qualitative on the developer side, with runtime effects unspecified. The honest reading is that Compose's clearest payoff in these cases was organisational consistency rather than rendering performance.

## 12. A fix without a guardrail is temporary remediation

This is the finding I did not expect to be so uniform.

The strongest cases in the corpus do not end at "we fixed it". Spotify added PR-level size accounting after reducing size. DoorDash added merge-level alerts and an asset review gate. Grab added lint rules around startup-critical initialisation after cleaning up startup. Meta built benchmarks capable of catching future 1% regressions. Pinterest turned historical runtimes into an ongoing scheduler rather than rebalancing shards once.

In each case the durable artefact was not the optimisation. It was the mechanism that makes the regression difficult.

This gives a usable definition of done for Android performance work:

```text
problem found
    ↓
cause understood
    ↓
fix shipped
    ↓
field impact verified
    ↓
regression signal automated
    ↓
ownership assigned
```

Stop before the last two steps and you have bought time, not a fix. Grab's startup case states this explicitly: after the initial cleanup, the most important optimisation was preventing the next hundred engineers from putting the work back.

The Baseline Profile cases make the same point in a narrower way. [Reddit](https://android-developers.googleblog.com/2024/12/reddit-improved-app-startup-speed-using-baseline-profiles-r8.html) reported around 51% median startup improvement and 36% lower P95 frozen frames on the home feed, with R8 contributing separately and nearly 30% lower ANRs. [NordVPN](https://android-developers.googleblog.com/2023/11/nordvpn-boosted-speed-of-login-user-flow-using-baseline-profiles.html) reported a 60% faster login flow by generating profiles around that specific journey rather than generic startup. [Trello](https://android-developers.googleblog.com/2025/11/deeper-performance-considerations.html) reported 25% faster startup from a single main-journey profile. [Meta](https://engineering.fb.com/2025/10/01/android/accelerating-our-android-apps-with-baseline-profiles/) reported up to 40% improvement in critical metrics, having found that startup can touch more than 20,000 classes before any feed work begins.

These are co-published numbers and should be read as such. But the structural claim beneath them holds: ART's runtime profile is lost across updates, so without a shipped profile your users repeatedly re-learn the same cold paths. A Baseline Profile is production configuration with an owner and a telemetry signal, not a Gradle setting you enable once.

[Grab's R8 case](https://engineering.grab.com/r8-optimization-at-scale-with-ai-assisted-debugging) is the sharpest illustration, because they found their own startup and baseline profiles had been implemented incorrectly, and fixing that contributed more than R8 itself did. R8 accounted for roughly 12% of startup improvement out of a reported total near 27%, alongside 25% lower ANR rate and a 16% smaller download. An unowned profile silently stops working, and nothing tells you.

They also name the reason the migration had stalled repeatedly before, which is not a technical reason: optimised code is rewritten and obfuscated, which makes reproduction hard, and local optimised builds took a very long time. The enabling work was debuggability and feedback speed, not the compiler flag. Compiler optimisations usually fail organisationally rather than technically.

## What I would carry into the next project

Reading fifty-three of these in sequence, the advice that survives contact with production looks fairly different from the advice in a getting-started guide.

**Do not initialise from habit.** Every library that asks to run in `Application.onCreate()` should have to justify occupying the startup path. Facebook, Lyft and Grab all show years of individually reasonable additions compounding into a collectively unreasonable startup architecture.

**Do not benchmark only on a Pixel.** Cheap flash, limited RAM, GC pressure, manufacturer audio stacks and thermal governors change which bottleneck dominates. Meta, SoundCloud, Grab and Discord all found problems their own devices could not reproduce.

**Treat cohort metrics as product requirements.** Duolingo's 39% to 8% result does not exist in a world where the team accepted a healthy-looking average.

**Separate perceived completion from backend completion.** If correctness allows the network call to outlive the screen transition, that is frequently a larger win than any optimisation of the call itself.

**Assume every cache creates debt somewhere else**, whether in device storage, stale state, data transfer, backend load or invalidation complexity. Grab and DoorDash are the paired study worth reading.

**Do not assume more modules means faster builds.** Boundaries enable incremental compilation and simultaneously impose configuration, graph traversal and indexing cost. Square and Grab have the clearest evidence of that second-order effect.

**Use different strategies for development and production when their objectives conflict.** SoundCloud's reflective development DI against generated production DI is the cleanest example in the set.

**Design migrations for coexistence first.** Cash App's compatibility seam, Shopify's continuity requirements and Spotify's staged rollout all treat the overlap period as the design problem.

**Test the parts of Android behaviour that live outside your APK.** DoorDash's deep links depend on a hosted JSON file, HTTP headers, redirects, a signing fingerprint and an OS verification process. None of that is covered by your test suite.

**Expect security choices to reach APIs that look unrelated.** Signal's encrypted media invalidated standard platform processing and forced a custom pipeline.

**Observe production before redesigning architecture.** Profilo and MobileLab are the purest statement of this. At scale, an architecture built from intuition is worth considerably less than infrastructure that can tell you what real devices are actually doing.

The pattern underneath all of these is that production Android problems are rarely pure engineering problems. They are engineering problems with organisational scale, hardware variance, historical code and competing priorities wrapped around them, and the published cases that are worth reading are the ones honest enough to describe the wrapping.
