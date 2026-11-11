---
title: "How NFC Works on Mobile Phones: An Engineer's Guide"
description: "From inductive coupling to Android IsoDep, APDUs and passport authentication: a ground-up guide to building reliable NFC scanning on mobile."
publishedDate: 2026-11-11
socialImage: /images/writing/social/how-nfc-works-on-mobile-phones.png
topics:
  - Android
  - Mobile Engineering
  - NFC
  - Security
draft: false
---

When a phone "scans" an NFC tag, the phone's coil creates a 13.56 MHz magnetic field. That field powers a battery-less chip and also carries the reader's commands. The chip answers by changing how much energy it draws from the field. Everything else, from anticollision to APDUs to passport cryptography, is layered protocol on top of that one shared magnetic field. If you keep that picture in mind, every NFC bug you will ever see belongs to one of six layers: coupling, activation, transport, commands, access control or verification.

<figure class="article-diagram">
  <img src="/images/writing/how-nfc-works-on-mobile-phones/inductive-coupling.svg" alt="A phone powers a passive passport chip through a 13.56 MHz magnetic field, sends commands by modulating that field, and detects the chip’s reply through load modulation." width="800" height="540" />
  <figcaption>One shared magnetic field supplies power and carries both directions of communication. The passport chip has no battery.</figcaption>
</figure>

**TL;DR**

- **The physics decides your UX.** NFC is inductive coupling at 13.56 MHz, deep inside the near field (the boundary is about 3.5 m, and the tag is a few centimetres away).<sup><a href="#nfc-source-1">[1]</a></sup> Field strength drops steeply with distance, so alignment of the phone's antenna with the tag's antenna matters more than anything else. Most "it doesn't work" reports are really coupling problems: the user is holding the phone in the wrong place or moving it.
- **The protocol stack is standard and layered.** For smart-card-style tags such as passports, ID cards, payment cards and DESFire, the stack is ISO/IEC 14443-2 (signalling, Type A or B), then 14443-3 (polling and anticollision), then 14443-4 (ISO-DEP block transport), then ISO/IEC 7816-4 APDUs. On Android you work at the IsoDep layer.<sup><a href="#nfc-source-2">[2]</a></sup> On iOS you work through NFCISO7816Tag, which is gated by Info.plist AIDs and a 60-second session limit.<sup><a href="#nfc-source-3">[3]</a></sup><sup><a href="#nfc-source-4">[4]</a></sup> Simple NDEF tags use the NFC Forum tag types instead.
- **Passports add access control and verification on top.** First you unlock the chip with BAC or PACE, using keys derived from the MRZ or the CAN. Then you read the data groups over secure messaging. Then you verify: Passive Authentication against trusted CSCA certificates shows the data is genuine, and Chip or Active Authentication shows the chip is not a clone. ICAO's current Doc 9303 Part 11 text says issuers must implement PACE from 1 January 2027, must stop issuing BAC chips from 1 January 2028, and must have BAC documents out of circulation by 2038.<sup><a href="#nfc-source-5">[5]</a></sup><sup><a href="#nfc-source-6">[6]</a></sup> Readers must keep supporting both protocols for years.

---

## Who this is for and how to read it

This guide is for mobile engineers and technical product people. You know software well, but radio engineering and cryptography are not your field. Every term is defined the first time it appears. The guide builds from the physics upward, because each higher layer only makes sense once you know what the layer below can and cannot do.

The order is:

1. Physics and hardware (Part A)
2. Signalling (Part B)
3. The standards landscape (Part C)
4. Discovery and activation (Part D)
5. The command layers (Part E)
6. Mobile platforms (Part F)
7. A deep worked use case on passports and ID documents (Part G)
8. Wrap-up: an end-to-end timeline, a troubleshooting table, a glossary and further reading (Part H)

Throughout, the "**Building it**" notes translate the theory into decisions for a real scanning feature. They are written from the perspective of an identity-verification SDK on Android and iOS. Statements that are my own engineering inference, not something a cited source says, are marked **[Inference]**.

**A note on verification.** ISO/IEC standards are paywalled. Where I cite ISO content, it comes from publicly available preview pages (the ISO/IEC 14443-3 and 14443-4 sample PDFs on standards.iteh.ai), vendor application notes (NXP, Microchip/Atmel, ams) or academic work that quotes the standard. ICAO Doc 9303 is free, but its PDF blocked automated retrieval during my research. My Doc 9303 statements therefore come from the official ICAO PDFs as indexed by search, from ICAO meeting papers (TAG/TRIP/5) and from secondary sources, and I flag the weaker ones. A few byte-level protocol details (REQA/WUPA codes, ISO-DEP block bits, BAC key-derivation constants, secure-messaging tags) are widely documented in vendor datasheets and open-source implementations, but I could not re-fetch a primary text for them in this pass. They are labelled "[widely documented; verify against spec]" so you know to check them before you build on them.

---

## Part A — Physics and hardware

### 1. What NFC is, and the vocabulary

NFC (Near Field Communication) is a family of short-range radio technologies at 13.56 MHz. Two devices talk by coupling their antennas through a magnetic field when they are a few centimetres apart.

There are always two roles:

- **The reader.** ISO/IEC 14443 calls it the **PCD** (Proximity Coupling Device). The reader generates the field and always speaks first. When your phone scans something, the phone is the PCD.
- **The card or tag.** ISO/IEC 14443 calls it the **PICC** (Proximity Integrated Circuit Card). It answers the reader. Other names you will see for the same thing are "tag", "transponder" (the older RFID term: a device that *trans*mits in res*pond*s to a signal), "contactless IC", "inlay" (chip plus antenna laminated into a card or page) and "chip".

These terms are defined in ISO/IEC 14443's own vocabulary, and Microblink's ISO 14443 glossary page summarises them.

A **passive** tag has no battery. It gets all its operating energy from the reader's field. Passports, ID cards, bank cards, transit cards and sticker tags are all passive. This one fact explains a great deal of NFC behaviour, as the following sections show.

### 2. How a battery-less chip gets power: inductive coupling

The phone's NFC controller drives an alternating current at 13.56 MHz through a coil antenna. An alternating current in a coil produces an alternating magnetic field around it. When the tag's own coil sits in that field, the changing magnetic flux through the tag coil induces a voltage across it. This is Faraday's law, the same principle a transformer uses. A transformer has two coils wound on a shared iron core. NFC is a transformer with an **air gap** instead of the core, and with coils that are much further apart and very loosely coupled.

The tag's coil is paired with a capacitor to form a **resonant circuit** tuned to 13.56 MHz. Resonance means the circuit naturally "rings" at that frequency, so a small induced voltage builds up to a much larger one. An NFC course deck from the University of Aveiro describes the tag antenna as a coil with a capacitor forming a resonant circuit tuned to the reader's frequency, where the voltage at the coil peaks. The tag then **rectifies** this AC voltage (diodes turn it into DC) and smooths it with a capacitor to run its logic.

The crucial conceptual point is that **the carrier and the magnetic field are the same thing**. The 13.56 MHz field the phone emits is at once:

- the **power supply** for the tag;
- the **clock** the tag runs on (the tag derives its timing from the 13.56 MHz carrier);
- the **channel** the reader modulates to send commands; and
- the **channel** the tag modulates (by changing its load) to answer.

There is one field doing all four jobs. This is why a reader cannot "turn off the field for a moment" without resetting the tag, and why anything that weakens the field weakens power and data together.

How strongly the two coils couple is described by the **coupling factor** (often written *k*, between 0 and 1). It depends on:

- **distance** (it falls off steeply);
- **angle** (the magnetic field is a vector, so a tag coil tilted relative to the field lines captures less flux); and
- **antenna geometry** (relative sizes and overlap of the two coils).

The Aveiro deck notes that tag orientation affects performance because the field has vector characteristics, and that 13.56 MHz systems are sensitive to metal in the operating zone.

> **Building it.** Every "hold your phone still" instruction exists because coupling is fragile. A user sliding the phone 1–2 cm, or tilting it, can drop the chip below its operating voltage. The chip then resets mid-transaction and you get a "tag lost" error, not a polite failure response. **[Inference]**

### 3. Why 13.56 MHz, and what "near field" means

**Wavelength** is the distance a radio wave travels during one cycle: λ = c / f. At 13.56 MHz, λ = 3×10⁸ / 13.56×10⁶ ≈ **22.1 m**. The RFID4U explainer and an ETH Zürich lecture both give the 22.1 m figure.

Close to an antenna, within a fraction of a wavelength, the field is dominated by stored, non-radiating energy. This is the **near field**, and for a coil it is mostly **magnetic**. Far from the antenna, the field becomes a propagating electromagnetic wave (radio in the usual sense). This is the **far field**. The commonly used boundary is about **λ/2π**, which at 13.56 MHz is about **3.5 m**. RFID4U states that for a 13.56 MHz system "the near-field zone ends" at λ/2π, or 3.5 m. Friedemann Mattern's ETH lecture slides say the same and add that near-field strength falls off as **O(1/r³)**, while far-field strength falls as O(1/r).

A tag held 1–4 cm from a phone is therefore *deep* inside the near field, by a factor of about 100. That is why NFC is "magnetic coupling", not "radio".

Contrast this with **UHF RFID** (around 860–960 MHz, used for logistics labels). Its wavelength is about 33 cm, so the near-field boundary is only about 5 cm. Mattern's slides give about 50 mm at 1000 MHz. UHF tags therefore work in the far field and reply by **backscatter**: they reflect a modulated part of the reader's radio wave. RFID4U contrasts the two regimes this way: 125–135 kHz and 13.56 MHz use inductive coupling, and systems above 100 MHz use backscatter.

Why 13.56 MHz in particular?

- **It is an ISM band.** ISM (Industrial, Scientific and Medical) bands are internationally reserved for unlicensed use, so the same device works worldwide. The Mattern slides list 13.56 MHz among the typical ISM-band RFID frequencies.<sup><a href="#nfc-source-7">[7]</a></sup>
- **It is low enough for cheap chips.** Simple, low-power silicon can be clocked directly from the carrier. **[Inference, consistent with vendor positioning]**
- **It is high enough for useful bit rates.** The base rate of about 106 kbit/s is fc/128, and 14443 defines higher rates up to fc/16 ≈ 848 kbit/s (see section 8).
- **It allows small antennas.** At 13.56 MHz a tag antenna needs only a few turns; the Mattern slides say 3–10 turns, against 100–1000 turns at 125 kHz. That fits in a card or a passport page.

The 1/r³ fall-off is a feature as well as a limitation. It makes eavesdropping and skimming harder because the signal dies quickly, and it makes the "tap" gesture an intuitive form of consent.

**Range.** ISO/IEC 14443 is a *proximity* standard. Microblink's summary gives "roughly 10 cm by specification, ~4 cm in practice".<sup><a href="#nfc-source-8">[8]</a></sup> NXP's MIFARE Ultralight EV1 product page says operating distance is up to 100 mm "depending on antenna geometry and reader configuration".<sup><a href="#nfc-source-9">[9]</a></sup> Phones have small antennas and limited transmit power, so expect a working distance of 0–4 cm. **[Inference from the above; varies by phone]**

### 4. The phone's NFC hardware

A phone's NFC subsystem has three parts:

1. **The NFC controller (NFCC).** A dedicated chip that generates the carrier, modulates and demodulates, and runs the low-level protocols (polling, anticollision, and often ISO-DEP framing). The phone's main processor talks to it over a host interface. In Android this is the NFC Forum's NCI (NFC Controller Interface) protocol. **[widely documented; verify against spec]**
2. **The antenna.** Usually a **planar spiral coil**, meaning a flat coil printed or etched onto a flexible printed circuit (FPC), placed under the back cover.
3. Optionally, a **secure element (SE)**: a tamper-resistant chip, either embedded (eSE) or the SIM (UICC), used for payments and credentials. When the phone emulates a card, the controller can route the reader's commands to the SE or to the main processor (host card emulation; see section 18).

**Metal is the enemy, and ferrite is the fix.** An alternating magnetic field induces **eddy currents** (swirling currents) in nearby metal such as the battery can, chassis, camera bracket or a metal back cover. By Lenz's law, those eddy currents create an opposing field that cancels the antenna's own field and detunes its resonance. NXP's PN7160 antenna design guide (AN13219) explains that metal near the NFC antenna generates eddy currents and that a **ferrite sheet** shields the antenna from the metal. The guide says the sheet "must cover at least the entire surface of the antenna" and warns that ferrite changes the antenna's inductance and resistance, so the antenna must be retuned with the ferrite in place.

Ferrite is a magnetic ceramic with high permeability. It gives the magnetic flux an easy path behind the coil instead of through the metal. Academic work on handset antennas describes very thin sintered ferrite sheets: about 80 µm thick, relative permeability around 200, placed between the NFC coil and the battery. One example is Lee et al., *International Journal of Antennas and Propagation*, 2014.

**Metal-body phones** need more tricks. Published designs include:

- cutting a **narrow slot** in the metal cover so eddy currents are interrupted and flux can pass through the opening (Zhu, Ban, Sim and Wu, *IEEE Transactions on Antennas and Propagation*, 2017);
- using the metal cover itself as part of the antenna, as a "booster";
- placing the coil near an edge or a non-metal section.

The NFC coil often shares space with the **wireless-charging (Qi) coil**. Researchers have published combined NFC and wireless-power couplers for metal-cover phones, for example an IPT–CPT combined coupler paper from San Diego State University.<sup><a href="#nfc-source-10">[10]</a></sup> Some designs use small chip or ferrite-core antennas where space is very tight. **[The general practice is from the cited papers; which phone uses which approach is not verified here]**

**Why "where do I hold it" is a real UX problem.** Antenna placement differs between phone models: near the camera, in the middle of the back, or towards the top edge. The usable "sweet spot" is roughly where the phone's coil overlaps the tag's coil. I am deliberately **not** listing antenna positions for specific phone models, because I could not verify them against manufacturer documentation. Manufacturer support pages and your own device-lab testing are the right sources.

> **Building it.** Ship positioning guidance as *data*, not as hard-coded artwork. Make it per device family where you have measured it, with a generic fallback ("move the phone slowly over the document; the NFC area is usually near the top of the back"). Log the device model alongside time-to-first-detection, so you can learn sweet spots from field telemetry. **[Inference]**

### 5. How a chip with no power stores data

A battery-less chip has three kinds of memory:

- **ROM.** Fixed at manufacture: the operating system code in many smart-card chips.
- **Non-volatile writable memory (EEPROM or flash).** Holds the data that must survive with no power: your UID (on some chips), NDEF records, passport data groups, keys and certificates. These technologies store bits as electric charge trapped on an insulated "floating gate" inside a transistor. The insulation is so good that the charge stays put for years without power. Mattern's slides cite "10 years data retention" for a 13.56 MHz tag product.<sup><a href="#nfc-source-7">[7]</a></sup> Writing needs a higher internal voltage, which the chip generates from the field. This is one reason writes need better coupling than reads and take longer. **[General semiconductor knowledge; not from a fetched NFC-specific source]**
- **RAM (volatile).** Working memory that exists only while the chip is powered.

What this means in practice:

- **Every session starts from scratch.** When the field drops, or coupling is lost for even a moment, the chip loses power and resets. Everything in RAM is gone: the selected application, the authentication state, the **session keys**, and the secure-messaging counters.
- **Recovery means starting again.** After a dropout you must re-poll, re-activate, re-select the application and redo BAC or PACE. You cannot "resume" mid-file with the old session keys.
- **Random UIDs regenerate on power-up.** NXP's AN10927 says the Random ID is generated at power-on reset. It is not reset by DESELECT, only by a field reset. Each new tap therefore looks like a "new" chip.

> **Building it.** Design your reader as a restartable state machine. On TagLost or a timeout, treat all crypto state as invalid, and resume at the *file* level: reuse already-verified bytes from your buffer if your design allows it, but re-authenticate first. **[Inference]**

---

## Part B — Signalling (ISO/IEC 14443-2)

### 6. Modulation vs coding

To send information over a carrier (a steady sine wave at 13.56 MHz), you change one of its properties:

- **amplitude** (how strong it is): AM or ASK;
- **frequency**: FM or FSK; or
- **phase** (where in its cycle the wave is): PM or PSK.

**Modulation** is how you impose a pattern onto the carrier. **Keying** is the digital version: you switch between discrete states. **ASK** (Amplitude-Shift Keying) switches between two amplitude levels. **OOK** (On-Off Keying) is ASK where one of the levels is "off". **BPSK** (Binary Phase-Shift Keying) switches between two phases 180° apart.

**Coding** (line coding) is a separate, earlier step. It decides which time pattern represents a 1 and which represents a 0 within each **bit period**. In 14443 a bit period is one **ETU**, the elementary time unit: 128 carrier cycles, about 9.44 µs at 106 kbit/s. Microchip's application note gives exactly this definition. Coding schemes you will meet:

- **NRZ (Non-Return-to-Zero), or NRZ-L.** The level is held for the whole bit: one level means 1, the other means 0.
- **Manchester.** Every bit has a transition in the middle. One direction of transition means 1, the other means 0.
- **Modified Miller.** Bits are marked by short "pauses" whose *position* in the bit period encodes the value (see below).

Coding decides the shape over time. Modulation decides how that shape is pressed onto the carrier.

### 7. Reader to tag: ASK

**Type A: 100% ASK with Modified Miller coding.** "100%" means the reader switches the carrier essentially *off* for short **pauses** (a few microseconds). Because the field also powers the tag, the pauses must be short and the coding must ensure they are sparse. The tag rides through them on its internal capacitor. The coding rules, as given in ISO/IEC 14443-2 and reproduced in Timo Kasper's 2006 thesis *Embedded Security Analysis of RFID Devices*, define three sequences:

- **Sequence X:** a pause in the *middle* of the bit period.
- **Sequence Y:** no modulation for the whole bit period.
- **Sequence Z:** a pause at the *start* of the bit period.

These map to bits as follows:

- **Logic 1** is sequence X: a pause in the middle.
- **Logic 0** is sequence Y (no pause), with two exceptions. If a 0 follows another 0, it is sent as Z (pause at the start); this avoids long pause-free stretches and keeps the receiver synchronised. If the first bit after start of frame is 0, it is also sent as Z.
- **Start of communication** is Z.
- **End of communication** is a logic 0 followed by Y.

```
Bits:        0     1     0     0     1
After SOF:   Z     X     Y     Z     X
Pause at:  start  mid  none  start  mid
```

(Rule check: the first 0 after SOF is Z. Then 1 is X. A 0 after a 1 is Y. A 0 after a 0 is Z. A 1 is X.)

**Type B: 10% ASK with NRZ-L coding.** The reader only *dips* the carrier slightly; it never switches it off. Microchip's Type B note says the "10% ASK" requirement actually specifies a modulation index between 8% and 14%. Logic 1 is the high amplitude (no modulation) and logic 0 is the reduced amplitude. The field, and so the tag's power, is continuous. That is friendlier for power-hungry crypto chips, but it makes the reader's signal harder to detect.

### 8. Tag to reader: load modulation and the subcarrier

A passive tag cannot transmit; it has no power source of its own. Instead it uses **load modulation**: it switches a resistor or capacitor across its coil on and off. Because the two coils are coupled like a transformer, a change in the load on the secondary (tag) side shows up as a tiny change in current and voltage on the primary (reader) side, which the reader detects. Microchip's note describes this as the card modulating the load on its antenna, which in turn modulates the load on the reader antenna.

That tiny change sits right next to the reader's own huge carrier. To make it separable, the tag does not toggle its load in step with the data directly. It toggles it at a **subcarrier** of fc/16 = **847.5 kHz**, which Microchip gives explicitly as "fs = fc/16 = 847.5 kHz". Mixing the 13.56 MHz carrier with an 847.5 kHz switching pattern creates **sidebands** at 13.56 ± 0.8475 MHz, so about **12.71 MHz and 14.41 MHz**. RF Wireless World gives 12.712 and 14.408 MHz. All the data lives in those sidebands. The reader can filter them out away from the strong carrier, and that is the whole reason for using a subcarrier.

**Type A at 106 kbit/s.** The subcarrier is **on-off keyed** and the data is **Manchester-coded**. According to Kasper's thesis, logic 1 means the subcarrier is on in the first half of the bit, logic 0 means it is on in the second half, and start of communication equals a logic 1.

**Type B.** The subcarrier runs continuously and its **phase** carries the data: **BPSK with NRZ-L**. Per the ISO/IEC 14443-2 text reproduced in public copies, the initial phase φ0 is defined as logic 1, and φ0 + 180° represents logic 0. Microchip notes each bit lasts 8 subcarrier periods and phase shifts only happen at nominal subcarrier edges.

**Bit rates.** The base rate is fc/128 ≈ **106 kbit/s** (the ETU of 128 carrier cycles). Higher rates are fc/64 ≈ 212, fc/32 ≈ 424 and fc/16 ≈ 848 kbit/s. Higher rates shorten the ETU, so each bit has fewer carrier and subcarrier cycles, and noise margin falls. In practice they need better coupling. Above 106 kbit/s, Type A's PICC-to-PCD direction no longer uses OOK Manchester. ISO/IEC 14443-2 specifies BPSK of the subcarrier for the higher rates in both types. **[widely documented; verify against spec]** The higher rates are negotiated *after* activation (via PPS for Type A, or ATTRIB parameters for Type B; see section 12). Everything starts at 106 kbit/s.

**Half-duplex, reader talks first.** Only one side transmits at a time, and the PICC only ever responds. Doc 9303 Part 10 requires the eMRTD to support "half-duplex transmission protocol defined in [ISO/IEC14443-4]".

**Active load modulation (ALM).** When a *phone* emulates a card, its small antenna and metal surroundings make passive load modulation too weak. Many phone NFC controllers therefore use ALM: the phone actively transmits a synchronised signal that mimics the effect of load modulation. RF Wireless World describes ASK active load modulation.<sup><a href="#nfc-source-11">[11]</a></sup> **[Secondary source only; treat the details as unverified]**

### 9. Type A vs Type B

| | Type A | Type B |
|---|---|---|
| Reader→tag modulation | 100% ASK (short pauses) | 10% ASK (8–14% index) |
| Reader→tag coding | Modified Miller | NRZ-L |
| Field during reader TX | Briefly interrupted | Continuous |
| Tag→reader (106 kbit/s) | OOK of 847.5 kHz subcarrier, Manchester | BPSK of 847.5 kHz subcarrier, NRZ-L |
| Identifier | UID (4/7/10 bytes) | PUPI (4 bytes) |
| Anticollision | Bit-wise, deterministic (tree walk) | Slotted, probabilistic |
| Typical examples | MIFARE family, NFC Forum Type 2, many passports | Many national ID cards, some passports |

Sources: Microchip and Microblink for signalling, NXP and Microchip for identifiers and anticollision. Microblink notes Type B is "common in national ID programs". Doc 9303 allows either type.

**What it means in practice.** Both types converge on the same ISO/IEC 14443-4 transport, so your APDU code does not care which type it is talking to. But your *reader* must poll for both. A passport app that only enables NfcA on Android will silently miss Type B documents. **[Inference, consistent with Doc 9303 allowing either type]**

---

## Part C — The standards landscape

### 10. ISO/IEC 14443 and its neighbours

**ISO/IEC 14443** ("Cards and security devices for personal identification — Contactless proximity objects") has four core parts:

- **Part 1: Physical characteristics.** Card dimensions and antenna classes. Doc 9303 recommends the Class 1 (ID-1 antenna size) coupling antenna area.
- **Part 2: Radio frequency power and signal interface.** Field strengths, modulation and coding (Part B above).
- **Part 3: Initialization and anticollision.** Polling, UID/PUPI and selection (Part D below).
- **Part 4: Transmission protocol.** ISO-DEP block transport (Part E below).

Part 4 is optional for a PICC in the sense that many simple tags (MIFARE Classic, Ultralight, NFC Forum Type 2) stop at Part 3 and use proprietary commands. Readers, however, must handle everything a compliant card might do. For example, NXP's AN10927 notes that ISO/IEC 14443 makes it mandatory for every PCD to support triple-size UIDs. Doc 9303 requires eMRTDs to conform to all four parts.

**Other 13.56 MHz technologies a phone may poll for:**

- **ISO/IEC 18092 (NFCIP-1).** The original "NFC" interface standard. It harmonises Type A–style signalling at 106 kbit/s with FeliCa-style signalling at 212 and 424 kbit/s. A Renesas patent text describes the 212/424 kbit/s mode as Manchester coding with 8–30% ASK. It also defines **peer-to-peer** communication between two NFC devices, in active mode (both sides take turns generating a field) or passive mode.
- **NFC-F / FeliCa (JIS X 6319-4).** Sony's technology, widely used for transit and payments in Japan. It runs at 212 and 424 kbit/s.
- **ISO/IEC 15693 (NFC-V, "vicinity cards").** Designed for longer range with big reader antennas, up to about 1 m, at about 26 kbit/s. Used for library tags and industrial labels.
- **NFC Forum tag types**, which map onto these radio technologies:

| NFC Forum type | Radio layer | Typical chips | Notes |
|---|---|---|---|
| Type 1 | 14443 A (no anticollision variant) | Innovision/Broadcom Topaz | Legacy **[widely documented]** |
| Type 2 | 14443 A, Part 3 only | MIFARE Ultralight, NTAG | Most common sticker tags |
| Type 3 | FeliCa (JIS X 6319-4 / 18092 at 212/424) | FeliCa Lite-S | Japan |
| Type 4 | 14443 A or B, Part 4 + 7816-4 APDUs | DESFire, NTAG 4xx, any ISO-DEP card | NDEF stored in a 7816-style file |
| Type 5 | ISO/IEC 15693 | ICODE, ST25TV | Vicinity |

The mapping of iOS polling options to tag types (iso14443 for Types 2/4, iso18092 for Type 3, iso15693 for Type 5) is from treastrain's "Demystify Core NFC" talk. One patent text describes Type 4 as compatible with both 14443 A and B.

**NDEF** (NFC Data Exchange Format) is the NFC Forum's standard message format: a list of typed records such as a URI, text, a MIME payload or a smart poster. NDEF is about *content*, and it can be stored on any of the five tag types.

**The three NFC modes:**

1. **Reader/writer.** The phone is the PCD and reads or writes a tag. This guide is mostly about this mode.
2. **Card emulation.** The phone behaves as a PICC, either from a secure element or in software through **HCE** (Host Card Emulation, where the app on the main CPU answers APDUs).
3. **Peer-to-peer.** Two phones exchange data (LLCP/SNEP over 18092).<sup><a href="#nfc-source-12">[12]</a></sup> Android's peer-to-peer feature, Android Beam, was **deprecated in Android 10**. The official Android 10 behaviour-changes page says "we're officially deprecating Android Beam".<sup><a href="#nfc-source-13">[13]</a></sup> It was removed in Android 14 (API level 34, October 2023); per ZAPPED, Android's API difference report for the NFC adapter lists the Beam and NDEF push methods, such as invokeBeam and setBeamPushUris, as removed (I did not open Google's report itself). iOS never offered peer-to-peer to apps. Treat P2P as dead for app development.

**NFC vs RFID.** RFID (Radio Frequency Identification) is the umbrella term for identifying things by radio. It covers LF (125–135 kHz), HF (13.56 MHz) and UHF (860–960 MHz), passive and active. NFC is a subset of HF RFID, built on 14443, 18092, FeliCa and 15693, with phone-oriented standards from the NFC Forum (modes, NDEF, tag types) layered on top. Every NFC tag is an RFID tag. Not every RFID tag is NFC: a UHF warehouse label is not.

---

## Part D — Discovery, anticollision and activation (ISO/IEC 14443-3 and -4)

### 11. The polling loop

A phone's NFC controller runs a **polling loop**:

1. Switch the field on.
2. Send a Type A request. Wait briefly.
3. Send a Type B request. Wait briefly.
4. Try FeliCa, then 15693, and so on.
5. Possibly switch the field off to save power.
6. Repeat.

ISO/IEC 14443-3 requires the PCD to "send REQA (or WUPA) and REQB (or WUPB) in any sequence".

There is also a timing rule. A tag needs time to power up after the field appears. ISO/IEC 14443-3:2018 says a Type B PICC "shall be able to accept a REQB (or WUPB) within 5 ms of unmodulated RF field". ICAO Doc 9303 Part 10 similarly says an eMRTD exposed to a field of 1.5 A/m "shall respond to any REQ/WUP appropriate to its Type after an unmodulated alternate magnetic field of 5 ms". So readers should leave the field on, unmodulated, for at least about 5 ms before polling.

On phones, the OS and NFC controller own this loop. Your app chooses *which* technologies to include. On Android these are the reader-mode flags; on iOS they are polling options.

### 12. Type A activation in detail

```
PCD → REQA  (0x26, 7-bit short frame)     or WUPA (0x52, also wakes HALTed cards)
PICC → ATQA (2 bytes; bits indicate UID size & anticollision support)
PCD → SEL CL1 (0x93) + NVB 0x20           "anticollision: tell me your UID bytes"
PICC → UID CL1 (4 bytes) + BCC
PCD → SEL CL1 (0x93) + NVB 0x70 + UID CL1 + BCC + CRC   "SELECT"
PICC → SAK (+CRC)
  ...repeat at CL2 (0x95), CL3 (0x97) if SAK says "UID not complete"...
PCD → RATS (0xE0 + param byte)            (only if SAK says 14443-4 compliant)
PICC → ATS
PCD → PPS (optional: change bit rate)
```

The byte values 0x26 and 0x52 are [widely documented; verify against spec]. SEL codes, NVB 0x70, SAK meanings and cascade tags are from NXP sources. RATS = 1110 0000b is from the ISO/IEC 14443-4 text and the ams AS3953 datasheet.

- **REQA vs WUPA.** REQA wakes only cards in the IDLE state. WUPA also wakes cards that were HALTed. REQA is a **short frame** of 7 bits, which no other command uses, so it is distinctive.
- **ATQA** (Answer To Request, Type A) is two bytes, sent least significant bit first per NXP's DESFire Light datasheet. It includes bits that announce the **UID size** (single, double or triple) and whether bit-frame anticollision is supported. NXP's AN10833 warns: "It is not advisable to use ATQA and SAK" alone to identify card types.
- **UID sizes and cascade levels.** UIDs are 4, 7 or 10 bytes, called single, double and triple size. They are revealed in up to three **cascade levels**: CL1 uses SEL 0x93, CL2 uses 0x95, CL3 uses 0x97. At each level the card returns 4 bytes plus a **BCC** (Block Check Character, the XOR of the 4 bytes). If the UID is longer than fits, the first byte at that level is the **Cascade Tag CT = 0x88**, meaning "more to come". A 7-byte UID is sent as `CT UID0 UID1 UID2 BCC` and then `UID3 UID4 UID5 UID6 BCC`. Because 0x88 has this role, NXP's AN10927 notes that UID0 of a 4-byte UID "must not be 0x88", and UID3 of a 7- or 10-byte UID must not be 0x88. In double and triple size UIDs, UID0 is a manufacturer code (0x04 = NXP).
- **NVB** (Number of Valid Bits) tells the card how many bits of the UID the reader is sending. Its upper nibble is a byte count and its lower nibble a bit count, both including SEL and NVB themselves. NVB = 0x20 means "just SEL+NVB: send me all your UID bits". NVB = 0x70 means "full 7 bytes follow": that is the SELECT command. NXP's Ultralight datasheet shows `SELECT | 93h | 70h`.
- **Bit-level collision detection.** If two Type A cards answer at once, they transmit the same Manchester-coded subcarrier pattern wherever their UID bits agree. Where they differ, one card fills the first half-bit and the other the second half. The reader sees subcarrier in *both* halves, which is an invalid Manchester symbol and therefore a detectable collision at that exact bit position. The reader then sends a SEL with an NVB covering the known bits plus a chosen value for the collided bit. Only cards matching that prefix answer. It repeats until one UID remains, like walking a binary tree. **[widely documented in RFID literature such as Finkenzeller's *RFID Handbook*; consistent with Manchester rules above]**
- **SAK** (Select AcKnowledge) is one byte. NXP's data sheets show the key bits:
  - **0x04 (bit 3)** set means "UID not complete, another cascade level follows". The Ultralight datasheet says SAK 04h "indicates additional cascade level".
  - **0x20 (bit 6)** set means the PICC is **ISO/IEC 14443-4 compliant**, so you should send RATS. NXP's AN10833 says bit 6 indicates "whether the PICC is compliant to the ISO/IEC14443-4". NXP's DESFire Light datasheet gives "SAK2 ... 20h, indicating UID complete and supporting ISO/IEC 14443-4".
  - For multi-level UIDs, NXP says only the **last** SAK should be used to identify the chip.
- **RATS / ATS.** RATS (Request for Answer To Select) carries **FSDI**, the reader's maximum frame size, and the **CID** the reader assigns. The card replies with the **ATS** (Answer To Select). Per ISO/IEC 14443-4:2016/2018 the ATS is:
  - **TL**, the length byte;
  - **T0**, the format byte: bits b7–b5 flag the presence of TC(1), TB(1) and TA(1), and bits b4–b1 are **FSCI**, the card's max frame size. The default FSCI is 2, meaning 32 bytes. Since the 2016 edition FSCI can go up to 'C', meaning 4096 bytes;
  - **TA(1)**, the supported bit rates in each direction;
  - **TB(1)**: the upper nibble is **FWI** (frame waiting time integer) and the lower nibble is **SFGI** (start-up frame guard time, how long the card needs after ATS before the next frame). A PCD receiving FWI = 15 must treat it as 4;
  - **TC(1)**: whether the card supports NAD and CID;
  - **historical bytes** T1…Tk, whose content is defined by ISO/IEC 7816-4.
- **FWT** (Frame Waiting Time), the maximum time the card may take to answer, is FWT = (256 × 16 / fc) × 2^FWI. That is about 302 µs × 2^FWI. FWI = 6 gives about 19.3 ms (ams AS3953 datasheet), FWI = 8 about 77.3 ms, and FWI = 14 about 4.95 s.
- **PPS** (Protocol and Parameter Selection) is optional. The reader uses it to switch to a higher bit rate the card advertised in TA(1). Phones usually do this inside the NFC controller. **[Inference]**

### 13. Type B activation

```
PCD → REQB/WUPB  (APf=0x05, AFI, PARAM incl. N)
PICC → ATQB   (0x50, PUPI[4], Application Data[4], Protocol Info[3])     in its chosen slot
PCD → Slot-MARKER (for slots 2..N, if N>1)
PCD → ATTRIB  (PUPI, params incl. bit rate, max frame size, CID)
PICC → answer to ATTRIB
```

Byte values APf/0x05 and 0x50 are [widely documented; verify against spec]. The structure is from ISO/IEC 14443-3 committee drafts and the Microchip and Analog Devices notes.

- **AFI** (Application Family Identifier) lets the reader address only cards of one application family. With AFI = '00', all PICCs must process the REQB/WUPB (ISO/IEC 14443-3 CD text).
- **N** is the number of slots. Each card picks a random slot R; ISO's note says "the probability of response (ATQB) in the first slot is 1/N". The reader then sends up to N−1 **Slot-MARKER** commands to open the later slots. This is a **slotted ALOHA-style** probabilistic anticollision. It is not bit-wise like Type A.
- **ATQB** carries:
  - the **PUPI** (Pseudo-Unique PICC Identifier, 4 bytes);
  - **Application Data** (hints about the applications on the card); and
  - **Protocol Info**: max frame size, supported bit rates, FWI, and whether CID and NAD are supported.

  ATQB is the Type B equivalent of ATQA, SAK and ATS rolled into one.
- **ATTRIB** selects the card by PUPI and sets the communication parameters, including the **CID** (Card IDentifier) used afterwards in ISO-DEP frames. After ATTRIB the card is in the ISO-DEP layer. Type B has no RATS.

### 14. The UID is not an identity

- **Random UIDs.** NXP's AN10927 defines a single-size UID starting **0x08** as a **Random ID (RID)**: "UID1, UID2 and UID3 are dynamically generated during or after each Power-On-Reset". The note adds that RID "should be used to protect privacy". In AN10927's table, UIDs starting xF are "fixed, non-unique", and NXP warns that single-size UIDs are being re-used because the space ran out. So even "fixed" 4-byte UIDs are not unique.
- **Passports.** ICAO Doc 9303 Part 10 explains that a fixed UID or PUPI could make the document a tracking "beacon". It states: "The use of random IC identifiers is RECOMMENDED, but States MAY choose to apply unique UIDs for Type A or unique PUPIs for Type B."
- **Phones emulating cards.** Android's HCE documentation says: "HCE devices should be assumed to have a random UID", meaning a new one on every tap. Readers therefore "should not depend on the UID of HCE devices as a form of authentication or identification" (older Android HCE guide text).
- **Apple.** An Apple Developer Forums post reports NFCISO7816Tag's `identifier` changing for the same card type. That is consistent with random UIDs. **[User report]**

> **Building it.** Never key anything (user identity, deduplication, fraud flags) on the UID or PUPI. For passports, the identity is in DG1, and it is trustworthy only after Passive Authentication. Log whether the UID was random (Type A, 4-byte, first byte 0x08) because it is a cheap diagnostic. **[Inference]**

---

## Part E — The command layers

### 15. ISO/IEC 14443-4: ISO-DEP (T=CL) block protocol

After activation, both types speak **ISO-DEP**. It is also called **T=CL** by analogy with the contact-card protocols T=0 and T=1. Android's `IsoDep` class is defined as access to "ISO-DEP (ISO 14443-4) properties and I/O operations". Every frame has the form:

```
[PCB] [CID]? [NAD]? [INF ...] [EDC: CRC 2 bytes]
```

The ams AS3953 datasheet gives this structure: prologue (PCB, optional CID), information field, and epilogue (EDC, 2 bytes). **PCB** (Protocol Control Byte) says what kind of block it is:

- **I-block (Information).** Carries application data, i.e. your APDU or a piece of it. Includes a **block number** bit that toggles 0/1 so lost or duplicate blocks can be detected, and a **chaining** bit.
- **R-block (Receive-ready).** An **ACK** or **NAK**. Used to acknowledge a chained block or to ask for a retransmission.
- **S-block (Supervisory).** Two kinds:
  - **WTX** (Waiting Time eXtension): the card says "I need more time than FWT" and the reader must acknowledge. This is how a card doing slow crypto avoids a timeout.
  - **DESELECT**: ends the session with the card.

(The I/R/S semantics are [widely documented; verify against spec].)

**Chaining.** If an APDU is larger than the card's frame size (FSC, from FSCI), the sender splits it across several I-blocks with the chaining bit set, and the receiver ACKs each with an R-block. This is invisible to apps on Android and iOS because the NFC stack does it. But it is why frame size affects speed. **[Inference]**

**Timeouts.** If no valid response arrives within FWT (plus WTX extensions), the reader retries using R-blocks and eventually gives up.

**Presence check.** Between your commands, the OS periodically checks that the tag is still there, for example by sending an empty I-block or an R(NAK) and expecting a response (implementation-specific). Android's reader mode lets you tune the interval with `EXTRA_READER_PRESENCE_CHECK_DELAY`. **[From the Android NfcAdapter reference; verify current documentation]**

### 16. ISO/IEC 7816-4 APDUs

The payload of the I-blocks is an **APDU** (Application Protocol Data Unit). This is the same command format smart cards have used over contacts for decades.

**Command APDU:**

```
CLA INS P1 P2 [Lc data...] [Le]
```

- **CLA** (class): 00 for standard inter-industry commands. Bits in CLA also flag secure messaging (0x0C) and command chaining (0x10).
- **INS** (instruction): A4 = SELECT, B0 = READ BINARY, 84 = GET CHALLENGE, 82 = EXTERNAL AUTHENTICATE, 88 = INTERNAL AUTHENTICATE, 22 = MANAGE SECURITY ENVIRONMENT, 86 = GENERAL AUTHENTICATE.
- **P1, P2**: parameters.
- **Lc**: the length of the command data.
- **Le**: the expected response length.

**The four cases:**

| Case | Command data | Response data | Shape |
|---|---|---|---|
| 1 | no | no | CLA INS P1 P2 |
| 2 | no | yes | … Le |
| 3 | yes | no | … Lc data |
| 4 | yes | yes | … Lc data Le |

**Short vs extended length.** Android's IsoDep docs put it plainly: "Standard APDUs have a 1-byte length field, allowing a maximum of 255 payload bytes, which results in a maximum APDU length of 261 bytes. Extended length APDUs have a 3-byte length field, allowing 65535 payload bytes." With short APDUs, Le = 00 means "up to 256 bytes".

**Response APDU:**

```
[response data...] SW1 SW2
```

The two **status word** bytes are always last. The common ones, from ISO/IEC 7816-4 (1995 and 2005 texts as quoted in public copies and in EU tachograph regulation 2016/799):

| SW | Meaning | Typical cause in an NFC app |
|---|---|---|
| 90 00 | Success | — |
| 61 XX | XX more bytes available (T=0 style) | Rare over ISO-DEP |
| 62 82 | End of file reached before Le bytes | Read past end; harmless if handled |
| 63 00 / 63 CX | Verification failed (X retries left) | Wrong PIN/auth; some cards use 6300 for failed EXTERNAL AUTHENTICATE |
| 67 00 | Wrong length | Bad Lc/Le, extended length not supported |
| 69 82 | Security status not satisfied | Tried to read a protected file before BAC/PACE, or SM session broken |
| 69 85 | Conditions of use not satisfied | Command out of sequence |
| 69 87 | Expected SM data objects missing | Sent plain APDU when SM required |
| 69 88 | Incorrect SM data objects | Bad MAC / wrong SSC / wrong keys |
| 6A 82 | File or application not found | Wrong AID/FID; DG not present |
| 6A 86 | Incorrect P1–P2 | Unsupported select option |
| 6A 88 | Referenced data not found | Key/password reference not available |
| 6B 00 | Wrong P1–P2 (e.g. offset beyond EF) | Read offset too large |
| 6C XX | Wrong Le; XX = exact length | Retry with Le = XX |
| 6D 00 | INS not supported | Command not implemented on this chip |
| 6E 00 | CLA not supported | Wrong class byte |

The 1995 text lists '6987' "Expected SM data objects missing" and '6988' "SM data objects incorrect". The tachograph regulation explains that 6988 happens "if all the required tags are present but some lengths are different" from the ones expected.

**File system.** A 7816-4 card is organised like a tiny filesystem:

- **MF** (Master File), the root.
- **DF** (Dedicated File), a directory, often an **application** identified by an **AID** (Application IDentifier, 5–16 bytes, registered under ISO/IEC 7816-5).
- **EF** (Elementary File), holding data. A **transparent** EF is read as a byte string by offset. EFs have a 2-byte **FID** (File IDentifier), and often a 5-bit **SFI** (Short File Identifier) that lets you read without selecting first.

Two essential commands:

```
SELECT by AID:   00 A4 04 0C <Lc> <AID...>        (P2=0C: no FCI returned)
SELECT EF by FID:00 A4 02 0C 02 <FID hi> <FID lo>
READ BINARY:     00 B0 <offset hi> <offset lo> <Le>
READ BINARY SFI: 00 B0 <0x80|SFI> <offset 0..255> <Le>
```

READ BINARY with P1 bit 8 set uses the SFI, with P2 as the offset. Otherwise P1–P2 is a 15-bit offset (up to 32 767). Offsets beyond that need the odd-INS READ BINARY (B1) with an offset data object. ISO/IEC 7816-4 refers to "INS = 'B1'" for encapsulated reads. Doc 9303 notes that support for short EF identifiers is mandatory for the eMRTD and that it is "RECOMMENDED that the inspection system use short EF identifier".

### 17. NDEF tags, MIFARE, and how they differ from 7816 applications

- **NFC Forum Type 2 (e.g. NTAG/Ultralight).** Memory is a flat array of 4-byte pages, read and written with simple proprietary commands at the 14443-3 level (no ISO-DEP). An NDEF message lives in a TLV structure inside that memory. **[widely documented]**
- **NFC Forum Type 4.** NDEF is stored in a 7816-style file inside an application with a well-known AID. You read it with SELECT and READ BINARY over ISO-DEP. **[widely documented]**
- **MIFARE Classic.** Sector-based memory protected by NXP's proprietary Crypto-1 authentication. The UID is used as input to authentication (AN10927, Table 4).<sup><a href="#nfc-source-14">[14]</a></sup> It is not ISO-DEP. It is cryptographically broken, and many phone NFC controllers cannot read it at all. Android's own `MifareClassic` source says implementing the class on an Android NFC device is optional, and `MifareClassic.get()` returns null when the device does not support MIFARE Classic.
- **MIFARE Ultralight.** A Type 2 tag.
- **MIFARE DESFire.** An ISO-DEP card with its own native command set and an ISO 7816-4 wrapping mode. NXP's DESFire Light datasheet says it is "fully compliant" with 14443-4 and 7816-4 communication frames.

The key difference: **NDEF tags are about portable content any phone can read; 7816 applications are about access-controlled, application-specific data**. A passport is a 7816 application, not an NDEF tag. That is why on iOS you use `NFCTagReaderSession`, not `NFCNDEFReaderSession`, and why passports never auto-open anything when tapped.

---

## Part F — Mobile platforms

*Information current as of November 2026. Check official documentation for your target OS versions.*

### 18. Android

**Discovery APIs.** There are two ways for an app to receive tags:

- **Foreground dispatch** (`NfcAdapter.enableForegroundDispatch`). The OS discovers a tag and runs its normal NDEF-check and dispatch logic, then hands the tag to your foreground activity through an intent. It is simple, but the OS's own NDEF probing and the platform sound and behaviour still apply. **[From the Android NfcAdapter reference; verify current documentation]**
- **Reader mode** (`NfcAdapter.enableReaderMode(activity, callback, flags, extras)`). Available since API 19. Your activity takes exclusive control of polling. Flags choose technologies (`FLAG_READER_NFC_A`, `_NFC_B`, `_NFC_F`, `_NFC_V`), let you skip NDEF probing (`FLAG_READER_SKIP_NDEF_CHECK`) and silence the system sound (`FLAG_READER_NO_PLATFORM_SOUNDS`). Extras include the presence-check delay. For passport and ID scanning, reader mode with A|B and SKIP_NDEF_CHECK is the standard choice. **[Inference]** It stops the OS from sending extra commands that confuse some chips, and it stops other apps grabbing the tag.

**Tag technologies** (in `android.nfc.tech`): `NfcA`, `NfcB`, `NfcF`, `NfcV`, `IsoDep`, `Ndef`, `NdefFormatable`, `MifareClassic`, `MifareUltralight`. A single `Tag` object can expose several at once; a passport typically shows `NfcA` or `NfcB` plus `IsoDep`.

**IsoDep essentials** (from the official IsoDep reference):

- `transceive(byte[])`: "Send raw ISO-DEP data to the tag and receive the response". You pass a full APDU and get back the response data plus SW1 SW2. Android handles ISO-DEP framing, chaining and WTX underneath.
- `setTimeout(int ms)` sets the transceive timeout. It "only applies to ISO-DEP transceive, and is reset to a default value when close is called". The docs add: "Setting a longer timeout may be useful when performing transactions that require a long processing time on the tag such as key generation."
- `getMaxTransceiveLength()` gives the maximum bytes per transceive.
- `isExtendedLengthApduSupported()` (API 16+) reports extended-length support. The docs note: "Some NFC adapters, like the one used in the Nexus S and the Galaxy Nexus do not support extended length APDUs." So check it at runtime and don't assume.
- `getHistoricalBytes()` (Type A, from the ATS) and `getHiLayerResponse()` (Type B, from ATTRIB).
- A `SecurityException` is thrown "if the tag object is reused after the tag has left the field".

**Manifest:**

```xml
<uses-permission android:name="android.permission.NFC" />
<uses-feature android:name="android.hardware.nfc" android:required="false" />
```

Use `required="false"` if the app must still install on non-NFC phones, then check `NfcAdapter.getDefaultAdapter(context) != null && isEnabled()` at runtime. **[standard Android practice]**

**Host Card Emulation.** Extend `HostApduService`, declare it with the `BIND_NFC_SERVICE` permission, and register **AID groups** in XML. Android routes a SELECT AID to your service and passes it every APDU after that. Per the official HCE guide:

- AID groups are all-or-nothing: either all AIDs in a group route to your service, or none do.
- Since Android 4.4 the default route is the host CPU.
- The emulated UID is random on every tap.

**Common pitfalls:**

- **`TagLostException`** indicates that the tag has left the field; weak coupling or movement is a common cause (Part A). A generic `IOException: Transceive failed` can also have other I/O causes. Use stage timings and device diagnostics to distinguish them, and restart with a fresh session after tag loss.
- **Tag reuse after it has left the field** raises `SecurityException`. Get a fresh `Tag` from the next discovery.
- **Timeouts during crypto.** PACE and Chip Authentication on slow chips can take hundreds of milliseconds per command. Raise `setTimeout` (several seconds is common) before those steps. **[Inference]**
- **Device quirks.** Extended-length support, maximum transceive length, presence-check behaviour and polling timing differ by NFC controller and vendor firmware. Treat each as a capability to test, not a constant. **[Inference, consistent with the IsoDep doc's own caveat]**

### 19. iOS (Core NFC)

**Two session types:**

- **`NFCNDEFReaderSession`** (iOS 11+). Reads NDEF only, from any NFC Forum tag type.
- **`NFCTagReaderSession`** (iOS 13+). Native access to `iso7816`, `miFare`, `feliCa` and `iso15693` tags. Apple's WWDC19 session 715, "Core NFC Enhancements", introduced it as able to "Poll for ISO14443, ISO15693, and/or ISO18092 tags". It also introduced `NFCISO7816Tag` with "a sendCommand method for transmitting any form of APDU to the tag and receiving the response". Since iOS 14, `sendCommand` also has a form that returns a `Result` of an `NFCISO7816ResponseAPDU` or an error (WWDC20 session 10209).

**Polling options** (`NFCTagReaderSession.PollingOption`): `.iso14443`, `.iso15693`, `.iso18092`, and `.pace`.<sup><a href="#nfc-source-15">[15]</a></sup> Using `.pace` with `if #available(iOS 16, *)` appears in Apple Developer Forums code, and npm/Capacitor plugin docs describe it as "available on iOS 16 and later".<sup><a href="#nfc-source-15">[15]</a></sup><sup><a href="#nfc-source-16">[16]</a></sup> I could not confirm the iOS version from Apple's own page. According to Apple's documentation as quoted in the NFCPassportReader issue tracker, `.pace` is "an exclusive value that cannot be combine with other NFCPollingOption values". So a `.pace` session will not detect non-PACE documents.<sup><a href="#nfc-source-17">[17]</a></sup>

Why `.pace` exists: some PACE-only documents do not let you SELECT the eMRTD AID before PACE. Developers report that newer French ID cards (issued after March 2021) failed with "Incorrect parameters P1-P2" (6A86) under `.iso14443` but worked under `.pace` (NFCPassportReader issue #164; Apple Developer Forums thread 724845). **[Developer reports; the mechanism is my inference]**

**Entitlements and Info.plist** (verified with an Apple engineer's forum answer and WWDC19):

- **The capability.** "Near Field Communication Tag Reading" adds the `com.apple.developer.nfc.readersession.formats` entitlement, an array containing `NDEF`, `TAG`, and, for PACE polling, `PACE`. A real provisioning profile listing `[NDEF, TAG, PACE]` appears in forum thread 811459. Without `PACE`, a `.pace` session fails with "Missing required entitlement".
- **`NFCReaderUsageDescription`** in Info.plist: the user-facing reason string.
- **`com.apple.developer.nfc.readersession.iso7816.select-identifiers`** in **Info.plist**, not the entitlements file. An Apple Staff Engineer wrote in 2026 that these AIDs "while behaving like entitlements, they are not entered in the Entitlements file", and that they "do not need any special provisioning on the developer portal". For eMRTD the AID is **`A0000002471001`**. In thread 117329, a developer relays an Apple engineer's diagnosis that a passport was not detected because "the ICAO-9303 Application Identifier was missing" from this list. Core NFC SELECTs the listed AIDs during discovery and only reports an `iso7816` tag if one matches. Otherwise the tag may surface differently, or not at all. **[The last part is inference from WWDC19's "when Core NFC discovers a tag that has a matching AID, we receive it in our Delegate callback"]**
- **Payment AIDs** cannot be selected through `NFCTagReaderSession` (Apple; summarised by newly.app).

**Session limits and UI.** Apple's Core NFC SDK headers state: "An opened session has a 60 seconds time limit restriction after -beginSession is called". When it is reached, the delegate receives `NFCReaderError.readerSessionInvalidationErrorSessionTimeout`, error code **201** in Microsoft's .NET binding docs. WWDC19 also says "60 second maximum scan time". A developer on Apple's forums reports the connection to a tag dropping after about 20 seconds; that is unverified. Core NFC always shows a **system sheet** ("Ready to Scan") whose `alertMessage` you can update. You cannot customise it beyond that, and only one session can be active.

**Extended-length APDUs.** I found no Apple statement on maximum APDU size or extended-length support. In Apple Developer Forums thread 120496, developers report failures for responses of 1694 bytes or more, and better results from using short APDUs with chaining. **[Unverified; test on your target devices]**

**Card emulation on iOS:**

- **HCE (`CardSession`)** is available only in the **EEA** on iOS 17.4+ (iPhone XS or later). It requires an Apple-granted `com.apple.developer.nfc.hce` entitlement and a developer established in the EEA (Apple support page "HCE-based contactless NFC transactions for apps in the EEA").
- **NFC & SE Platform (`CredentialSession`)** is a separate, **Secure Element**–based programme. It started with iOS 18.1 in Australia, Brazil, Canada, Japan, New Zealand, the UK and the US, and expanded in iOS 18.2, 18.4 and 26.0. Apple says "Government IDs are now supported, starting with iOS 26.4." It needs a commercial agreement and the `com.apple.developer.secure-element-credential` entitlement. It is **not** HCE. Don't confuse the two.

**iOS vs Android summary:**

| | Android | iOS |
|---|---|---|
| Raw ISO-DEP | `IsoDep.transceive` | `NFCISO7816Tag.sendCommand` (AID must be in Info.plist) |
| Type A/B selection | flags | `.iso14443` covers both |
| PACE-only docs | just works (send MSE:Set AT directly) | may need `.pace` polling (iOS 16+, exclusive) |
| Session time limit | none (app-controlled) | 60 s |
| UI | fully custom | system sheet + `alertMessage` |
| Timeouts | `setTimeout` | not configurable |
| HCE | since 4.4, worldwide | EEA only, entitlement |
| Raw NfcA/NfcB frames | yes (`NfcA.transceive`) | limited (MIFARE family via `miFare` tag) |

---

## Part G — Use case: scanning passports and ID documents (eMRTD)

**Where passports fit.** NFC on phones is used for:

- **payments**: EMV contactless, ISO-DEP plus 7816 applications, routed to a secure element;
- **transit**: FeliCa, DESFire, Calypso;
- **marketing and pairing tags**: NDEF on Type 2 and Type 5;
- **access cards**: DESFire, iCLASS and others.

An **eMRTD** (electronic Machine Readable Travel Document: an e-passport, or an ID card that follows ICAO rules) is an ISO-DEP plus 7816-4 application. It has standardised access control and a global PKI.

### 20. What ICAO Doc 9303 requires of the chip

Doc 9303 Part 9 says: "The contactless ICs used in eMRTDs SHALL conform to ISO/IEC 14443 Type A or Type B and ISO/IEC 7816-4." Part 10 (and the TAG/TRIP/5 amended text) adds the following:

- **Conformance.** The chip must conform to ISO/IEC 14443-1 to -4, "including all associated amendments and corrigenda", use a Type A *or* Type B signal interface, and support 7816-4 transparent files and commands.
- **Bit rate.** "A minimum of 424 kilobits per second transmission speed is advised." This is advice, not a requirement. EMD (electromagnetic disturbance) features are OPTIONAL.
- **Antenna.** Class 1 (ID-1 size) coupling antenna area is recommended.
- **Memory.** The chip "SHALL be a minimum of 32 kB" (32 kilobytes, not kilobits). This is needed for the facial image, "typically 15 to 20 kB", plus the MRZ and security data.<sup><a href="#nfc-source-18">[18]</a></sup> There is no maximum.<sup><a href="#nfc-source-19">[19]</a></sup> The maximum size of an EF is "normally 32 767 bytes, but some contactless ICs support larger files".<sup><a href="#nfc-source-20">[20]</a></sup>
- **Protocol.** Half-duplex ISO-DEP, and random UIDs are recommended (section 14).
- **Anti-skimming and eavesdropping.** Protection comes from access control (BAC/PACE, section 22) and, for some documents, from physical shielding. The US State Department's 2006 e-passport media note says: "Metallic anti-skimming material incorporated into the front cover and spine of the e-passport book prevents the chip from being skimmed, or read, when the book is fully closed." This is an archived 2006 page; I found no current State Department or GAO restatement.

### 21. The Logical Data Structure (LDS)

**Master File level** (Doc 9303 Part 10):

| File | FID | SFI | Status |
|---|---|---|---|
| EF.CardAccess | 01 1C | 1C | CONDITIONAL: required if PACE supported; contains PACE SecurityInfos |
| EF.CardSecurity | 01 1D | 1D | Conditional (PACE-CAM / Terminal Authentication) |
| EF.ATR/INFO | 2F 01 | 01 | Optional (e.g. max APDU lengths, LDS2) |
| EF.DIR | 2F 00 | 1E | Required if LDS2 applications present |

**The eMRTD (LDS1) application**, AID `A0 00 00 02 47 10 01`:

| File | FID | SFI | Tag | Content | Status |
|---|---|---|---|---|---|
| EF.COM | 01 1E | 1E | 60 | LDS/Unicode version, list of DGs present | Mandatory |
| EF.SOD | 01 1D | 1D | 77 | Document Security Object (hashes + signature) | Mandatory |
| DG1 | 01 01 | 01 | 61 | MRZ data | Mandatory |
| DG2 | 01 02 | 02 | 75 | Encoded face (JPEG or JPEG 2000) | Mandatory |
| DG3 | 01 03 | 03 | 63 | Fingerprints | Optional, EAC-protected |
| DG4 | 01 04 | 04 | 76 | Iris | Optional, EAC-protected |
| DG7 | 01 07 | 07 | 67 | Displayed signature/usual mark | Optional |
| DG11 | 01 0B | 0B | 6B | Additional personal details | Optional |
| DG12 | 01 0C | 0C | 6C | Additional document details | Optional |
| DG14 | 01 0E | 0E | 6E | Security options (Chip Authentication, PACE info) | Conditional |
| DG15 | 01 0F | 0F | 6F | Active Authentication public key | Conditional |

FIDs, SFIs and the EF.COM/EF.SOD tags are from Doc 9303 Part 10 (English, French and Spanish consolidated texts). The tags for individual DGs are [widely documented; verify against Part 10 Table]. "Only two DGs are required" (DG1 and DG2) is also stated in an academic analysis published via CEUR-WS.

**Why not trust EF.COM.** EF.COM is *not* covered by the SOD signature. An attacker or a broken chip could list data groups that don't exist, or hide ones that do. The authoritative list of data groups is the set of hashes inside the signed EF.SOD. Newer LDS versions (1.8) put the LDS and Unicode version information in the SOD as well. **[The LDS 1.8 detail is from Doc 9303 Part 10 as I understand it; verify]** **Building it:** use EF.COM for hints only, and drive verification from the SOD.

**The read sequence in bytes.** These are shown in plaintext for clarity. After BAC or PACE every command below is wrapped in secure messaging (section 22).

```
// Select eMRTD application (P2=0C: no response data)
00 A4 04 0C 07 A0 00 00 02 47 10 01          → 90 00

// Select EF.COM by FID, then read first 4 bytes to learn TLV length
00 A4 02 0C 02 01 1E                          → 90 00
00 B0 00 00 04                                → 60 82 01 2A ... 90 00   (example)

// Or read DG1 directly by SFI (P1 = 0x80 | 0x01), offset 0
00 B0 81 00 00                                → 61 5B 5F 1F 58 ... 90 00

// Chunked read of DG2: repeat READ BINARY with increasing offset
00 B0 00 00 DF    (offset 0x0000, Le=0xDF)
00 B0 00 DF DF    (offset 0x00DF)
00 B0 01 BE DF    ...
```

The example response bytes are illustrative, not from a real document.

**Why DG2 dominates read time.** DG2 is typically 15–20 kB, against about 90 bytes for DG1.<sup><a href="#nfc-source-18">[18]</a></sup> With short APDUs and secure messaging, each READ BINARY returns at most about 223–231 bytes of plaintext, because the SM wrapper and MAC eat into the 256-byte response. So a 20 kB DG2 needs about 90 round trips. Each round trip costs ISO-DEP framing, chip processing, MAC computation on both sides and OS overhead. **[Inference; 0xDF = 223 is a common chunk size in open-source readers]** Extended-length reads cut the number of round trips sharply where both chip and phone support them.

### 22. Access control: BAC, PACE and secure messaging

**Why access control exists.** Without it, anyone with a reader within a few centimetres could read your name, nationality, birth date and photo (**skimming**). Anyone with an antenna nearby during a legitimate read could record the exchange (**eavesdropping**). Access control requires proof that the reader has **physical access to the document**: it must know data printed inside it. It also encrypts the session.

#### BAC (Basic Access Control)

1. **Key seed from the MRZ.** Take the document number plus its check digit, the date of birth plus its check digit, and the date of expiry plus its check digit, as printed in the MRZ (machine-readable zone). Hash them with **SHA-1**. The first 16 bytes are **K_seed**.
2. **Derive two keys.** Derive **K_enc** and **K_mac** from K_seed by hashing it with a counter (1 for encryption, 2 for MAC) and adjusting DES parity. These are two-key **3DES** keys. **[widely documented; verify against Doc 9303-11 §9.7]**
3. **GET CHALLENGE** (`00 84 00 00 08`). The chip returns an 8-byte random RND.IC.
4. **EXTERNAL AUTHENTICATE** (`00 82 00 00 28 <40 bytes> 28`). The reader generates RND.IFD and K.IFD, encrypts RND.IFD‖RND.IC‖K.IFD with K_enc, MACs it with K_mac and sends it. The chip checks, then replies with its own encrypted RND.IC‖RND.IFD‖K.IC. This is **mutual authentication**: each side proves it knows the MRZ-derived keys.
5. **Session keys.** Both sides derive session keys KS_enc and KS_mac from K.IFD ⊕ K.IC. They initialise the **SSC** (Send Sequence Counter) from the last 4 bytes of each nonce. **[widely documented; verify]**

**BAC's weaknesses.** The keys can only be as strong as the guessability of the MRZ fields:

- Juels, Molnar and Wagner (2005) estimated about **52 bits** of entropy for US passports: birth date about 14 bits, a 10-year expiry window, and US passport numbers "at most lg(15 × 10⁷) ≈ 27 bits". They noted the passport number "is not typically considered a secret".
- Avoine, Kalach and Quisquater (Financial Cryptography 2008) found sequential Belgian numbering reduced effective entropy to about **38 bits**. Even random numbering would only reach about 73 bits.
- The decisive problem is the **offline attack**. An eavesdropper who records one BAC session can brute-force the MRZ guesses at leisure on a computer, testing each candidate key against the recorded EXTERNAL AUTHENTICATE MAC. They then decrypt the whole recorded session. Nothing in BAC slows that down.

#### PACE (Password Authenticated Connection Establishment)

PACE was designed by the German BSI (TR-03110) and adopted by ICAO, first as **SAC** (Supplementary Access Control), then into Doc 9303 Part 11. It is a **password-authenticated key agreement**. A weak password (MRZ-derived, or the **CAN**) is used to *authenticate* a strong ephemeral Diffie–Hellman exchange. The password never directly protects the traffic.

**CAN** (Card Access Number) is a short number, typically 6 digits, printed on ID cards. It lets you run PACE without reading the full MRZ. This matters for TD1 ID cards, whose MRZ is on the back.

**Steps** (Doc 9303 Part 11, paraphrased; command bytes [widely documented; verify]):

1. **Read EF.CardAccess** (without authentication) to learn the supported PACE parameters: protocol OID, mapping, cipher (3DES or AES-128/192/256) and domain parameters (DH group or ECC curve such as brainpoolP256r1 or NIST P-256).
2. **MSE:Set AT** (`00 22 C1 A4 …`). Tell the chip which protocol OID and which password (MRZ or CAN) you will use.
3. **GENERAL AUTHENTICATE 1: encrypted nonce.** The chip sends a random nonce *s* encrypted under a key derived from the password. The reader decrypts it, which it can only do if it knows the password.
4. **GENERAL AUTHENTICATE 2: mapping.** Use *s* to derive a fresh, session-specific generator. There are three variants:
   - **Generic Mapping (GM):** an extra DH exchange.
   - **Integrated Mapping (IM):** a hash-to-point.
   - **Chip Authentication Mapping (CAM):** like GM, but it also lets the chip prove its static key later.
5. **GENERAL AUTHENTICATE 3: ephemeral key agreement.** Both sides exchange ephemeral public keys on the mapped generator and compute a shared secret, from which session keys are derived (AES with AES ciphersuites).
6. **GENERAL AUTHENTICATE 4: authentication tokens.** Each side sends a MAC over the other's ephemeral public key. Both now know the other side used the same password and the same exchange.

GENERAL AUTHENTICATE uses command chaining: CLA 10 for all but the last command, then 00.

**Why PACE resists offline attacks.** A recorded transcript contains only an encrypted random nonce and ephemeral public keys. To test a password guess offline, you would also need to break the Diffie–Hellman exchange. So the low entropy of the MRZ or CAN only allows *online* guessing, which needs the physical chip and is slow. **[Standard cryptographic argument, consistent with the BSI and ICAO design rationale]**

#### Secure messaging (SM)

After BAC or PACE, every APDU is protected:

- **CLA** gets the SM bit (0x0C).
- **Command data** is encrypted and placed in DO'87' (with a padding-indicator byte). Le goes in DO'97'.
- A **MAC** over the header, the data objects and the incremented **SSC** goes in DO'8E'.
- **Responses** come back with DO'87' (encrypted data), DO'99' (the status word) and DO'8E' (MAC).

Both sides increment the SSC for every command and every response. Lose sync by one step and the next MAC fails. The chip answers **69 88** ("incorrect SM data objects"), or simply refuses and drops the session. **[DO tags widely documented; 6987/6988 meanings confirmed in ISO/IEC 7816-4]**

#### The timeline: resolving the 2025 vs 2027 conflict

- **Doc 9303 7th edition (2015)**: chips may implement BAC only, PACE and BAC, or "Starting 1 January 2018, eMRTD chips implementing PACE only". The same edition told states not to implement PACE without BAC, for interoperability, and said BAC "may become deprecated in the future".
- **Current consolidated Doc 9303 Part 11, as indexed on icao.int**: "Issuing States and organizations issuing eMRTDs SHALL implement PACE as of **1 January 2027**". "Issuing States and organizations SHALL NOT issue eMRTDs with BAC as of **1 January 2028**", meaning PACE-only chips from that date. States "SHALL ensure that all eMRTDs with BAC are out of circulation by" a later date.
- **The end-of-circulation date.** Identity Week, reporting the ICAO TRIP-ICBWG announcement, gives it as **1 January 2038** and adds that "ICAO plans to phase out 3DES algorithms, requiring states to select AES-based PACE ciphersuites". Symbolic Software's October 2026 analysis attributes the 2027/2028 dates to "the February 2026 amendment to Doc 9303 Part 11, §4.1".
- **An older ICAO-hosted version** of Part 11 (on the www2023.icao.int mirror) uses slightly different wording: "From 1 January 2027, eMTRD chips MUST implement PACE … Implementing BAC only is deprecated" and "From 1 January 2028, BAC is deprecated and eMRTD chips MUST implement PACE only."
- **My conclusion.** Every ICAO text I could find gives **1 January 2027** for PACE becoming mandatory. I found no primary ICAO text giving 1 January 2025. The 2025 figure appears to come from earlier drafts or secondary summaries, which I could not trace. If you see 2025 in a vendor document, treat it as outdated unless it cites a specific ICAO amendment.
- **The EU.** The EU requires PACE for member-state passports. Signicat says "The EU mandates the implementation of PACE"; SmartCardFYI says EU ePassports have used PACE since 2014.<sup><a href="#nfc-source-21">[21]</a></sup><sup><a href="#nfc-source-22">[22]</a></sup> The legal basis is Commission Decision C(2011) 5499 of 4 August 2011 (amending C(2006) 2909), under which EU members had to implement PACE in electronic passports by the end of 2014. **[Cited via EUR-Lex and Wikipedia; I did not read the Decision text]**
- **Reader behaviour.** "If an eMRTD supports both PACE and BAC, the inspection system SHALL use either BAC or PACE but not both in the same session" (Doc 9303-11). Inspection systems "SHOULD implement and use PACE if provided" (7th ed.), and should fall back to BAC otherwise. The practical rule: read EF.CardAccess; if it lists PACE, do PACE; if PACE fails for a reason other than a lost connection, or EF.CardAccess is absent, try BAC. Readers must support **both** until at least 2038.

### 23. Reading and verification

Reading the data proves nothing by itself. Four separate checks answer four separate questions.

#### Passive Authentication (PA): "Is this data genuine and unmodified?"

1. Parse **EF.SOD**. It is a CMS SignedData structure containing the hash algorithm, a list of (DG number, hash) pairs, the signature and, usually, the **Document Signer Certificate (DSC)**.
2. Hash each DG you read and compare it with the SOD entry.
3. Verify the SOD signature with the DSC's public key.
4. Validate the DSC against the issuing country's **CSCA** (Country Signing Certificate Authority) certificate from your trust store. Also check validity periods and **CRLs** (certificate revocation lists).

Trust stores come from the **ICAO PKD** (Public Key Directory) and from **CSCA master lists**, which are signed collections of CSCA certificates published by some states. Doc 9303 Part 12 "explains how the reader establishes trust in the signing key" (Symbolic Software).

**The "self-signed / fantasy CSCA" forgery.** If your code trusts whatever CSCA-looking certificate comes along, perhaps one embedded in the SOD itself, or a chain that ends in a self-signed root you never pinned, a forger can sign arbitrary data with their own CA and pass "signature valid". The defence is to validate only against a curated, current set of genuine CSCAs. **[Inference; this is a well-known implementation pitfall rather than a cited source]**

**The operational burden.** ICAO Doc 9303 Part 12 recommends that a Document Signer private key be used to sign eMRTDs for at most three months, and ICAO's CSCA migration guidance says the CSCA certificate must be renewed, with a new key pair, every three to five years; CRLs must also be kept fresh. Keeping trust stores current is ongoing operations work. Do it server-side.

**PA's limit.** PA proves the *data* was signed by the issuer. It cannot detect a **clone**: an attacker who copies all the DGs and the SOD onto a blank chip passes PA perfectly.

#### Active Authentication (AA): "Is this the original chip?"

DG15 holds a public key whose private key is stored in the chip and cannot be read out. The reader sends **INTERNAL AUTHENTICATE** (`00 88 00 00 08 <8-byte challenge>`), and the chip signs the challenge. **[Command bytes widely documented; verify]** A clone cannot sign. AA has two limits:

- It cannot stop a **relay attack**: a live connection to the real chip somewhere else.
- **Privacy.** A signature over a verifier-chosen challenge is a transferable proof that this chip was present. That is why ICAO and BSI favour Chip Authentication. **[Standard critique; secondary]**

#### Chip Authentication (CA) and PACE-CAM: "Original chip, and a stronger channel"

DG14 holds the chip's static Diffie–Hellman public key. The reader does a **static-ephemeral DH**: it sends its ephemeral public key, and both sides derive **new session keys** from the shared secret. Secure messaging then **restarts** with the new keys and a reset SSC. Only a chip holding the static private key can continue the conversation, so cloning is defeated. The session also gets stronger keys than BAC provides.

**PACE-CAM** (Chip Authentication Mapping) folds this proof into PACE itself. Doc 9303 says that if PACE-CAM is supported it uses EF.CardSecurity, and that if Terminal Authentication "is supported by the IC, it MUST support Chip Authentication or PACE with Chip Authentication Mapping".

#### Terminal Authentication / EAC: "Is this reader authorised for biometrics?"

**DG3** (fingerprints) and **DG4** (iris) are protected by **Extended Access Control (EAC)**, specified in BSI TR-03110. The reader must prove, with a certificate chain issued by the document's issuing state (a country-verifying CA, then document-verifier certificates), that it is an authorised inspection system. Doc 9303 notes "A successful execution of the PACE protocol is REQUIRED before Terminal Authentication". States grant these certificates to other governments' border systems, not to commercial apps. **For an identity-verification SDK, DG3 and DG4 are out of reach.** Expect 69 82 if you try.

#### Dependency ordering

The anti-cloning results only mean something if the keys they rely on are authentic:

1. Run PA first, and make sure the SOD covers **DG14** (for CA) and **DG15** (for AA).
2. An attacker could otherwise put their *own* DG14 or DG15 key on a clone and "pass" CA or AA.
3. So: CA or AA success + DG14/DG15 hash matches the SOD + SOD signature valid + DSC chains to a trusted CSCA = genuine, non-cloned chip. Drop any link and the claim fails. **[Inference following the Doc 9303 design]**

### 24. Building a passport/ID NFC feature: practical guidance

1. **Capture the MRZ first.**
   - BAC and PACE-with-MRZ need the document number, date of birth and date of expiry *exactly*, with check digits. Use OCR on the data page (TD3 passports, 2 lines × 44 characters) or the back (TD1 ID cards, 3 lines × 30). Offer manual entry as a fallback.
   - Validate the check digits before you start NFC.
   - OCR confusions such as O/0, I/1, S/5 and B/8 produce wrong keys. With BAC that shows up as an EXTERNAL AUTHENTICATE failure, which some chips report as 63 00. With PACE it shows up as a token-verification failure.
   - When authentication fails with a valid connection, try the common confusions in the document number before asking the user. Keep the retry count small: chips may rate-limit, and some implement retry counters. **[Inference]**
2. **For ID cards, support the CAN.** Many TD1 cards accept PACE with the CAN, which users can type from the front. Some newer French ID cards need `.pace` polling on iOS.
3. **Tell connection loss apart from authentication failure.** The two need different user messages:

   | Signal | Meaning | User message |
   |---|---|---|
   | `TagLostException` / iOS connection error | Physics | "Hold still / reposition" |
   | Clean status word failure during auth (63 00, 69 82, 6A 88, a bad token) | Wrong MRZ or CAN | "Check your details" |
   | 69 88 mid-read | SM desync, often after a silent glitch | Restart the session |

4. **Report results as separate, typed outcomes**, never as one boolean:
   - chip read complete (which DGs);
   - PA hash check (per DG);
   - SOD signature;
   - DSC→CSCA chain (with trust-store version and revocation status);
   - CA, PACE-CAM or AA result (or "not supported by document");
   - DG1 vs printed MRZ match.
5. **Verify on the server.**
   - Send the raw SOD and DGs to your backend for PA and chain validation. Don't trust a "PA passed" flag computed on a possibly compromised phone.
   - For AA, have the **server choose the challenge** so the signature can't be replayed.
   - CA is interactive and must happen on the device, but the server can re-check that DG14 is covered by the SOD. **[Inference]**
6. **Cross-check against the physical document and the person.**
   - Compare DG1 (the chip's MRZ) with the OCR'd printed MRZ. A mismatch suggests a swapped data page or a different chip.
   - Compare the DG2 face with the user's selfie (face matching). DG2 is the strongest anchor because it is issuer-signed.
7. **Handle documents with no DG14 or DG15.** Some older passports have neither, so clone detection is impossible. Report "not available" honestly, not "failed", and let policy decide.
8. **Plan timeouts and WTX.**
   - PACE ECDH, CA and AA signatures take time on the chip.
   - On Android, raise `IsoDep.setTimeout` before crypto steps (for example to a few seconds) and restore it for bulk reads. **[Inference]**
   - Cards request WTX automatically. Don't treat a slow response as a failure until the OS times out.
   - On iOS you cannot set timeouts, so keep total time well under 60 s.
9. **Chunk size and extended length.**
   - Default to short APDUs with chunks of about 223 bytes of plaintext.
   - Use extended length only when `isExtendedLengthApduSupported()` is true on Android *and* EF.ATR/INFO or testing shows the chip supports it.
   - On iOS, be conservative (see the forum reports).
   - Add a fallback: if an extended read returns 67 00 or errors, drop to short reads.
10. **Guide the user to the chip.**
    - In passports the chip and antenna inlay are usually in the **front or back cover**, or in a polycarbonate data page. In ID cards they are in the card body.
    - Instruct "open the passport (for US-style shielded covers, the chip can't be read when closed), place the phone flat on the cover/page, move slowly". The State Department note confirms the US cover and spine shielding.
    - Do **not** claim a specific chip position for a specific country unless you have verified it.
11. **Log for diagnosis.** Log the device model and OS, the technology (A or B), the ATQA/SAK or ATQB, the historical bytes, FSCI/FWI, the max transceive length, the extended-length flag, every command's INS and SW1 SW2 (*not* the data), timings per stage, and the failure layer.
12. **Privacy and data handling.**
    - DG1, DG2 and DG11 are sensitive personal data (in the EU, biometric data used for identification is special-category data under GDPR).
    - Read only the DGs you need. Keep data in memory and wipe buffers. Encrypt in transit. Define retention.
    - Never log MRZ, keys or DG contents.
    - Tell the user what you read. On iOS, the `NFCReaderUsageDescription` string is part of that disclosure. **[Inference; consult counsel]**

---

## Part H — Wrap-up

### 25. One scan, end to end

| # | Stage | What happens | Rough time **[Inference]** |
|---|---|---|---|
| 1 | Field on | Phone NFCC drives 13.56 MHz into its coil | — |
| 2 | Power-up | Passport inlay resonates, rectifies, chip boots from ROM; random UID generated | ≥5 ms (ISO/ICAO guard) |
| 3 | Polling | REQA/WUPA and REQB/WUPB alternate; chip answers ATQA or ATQB | ms |
| 4 | Anticollision/select | Type A: SEL/NVB cascade → SAK 0x20. Type B: slots → ATTRIB | ms |
| 5 | RATS/ATS (A) | Frame size, FWI, bit rates; optional PPS to 424/848 | ms |
| 6 | OS hands tag to app | Android `onTagDiscovered` (IsoDep) / iOS `didDetect` (`.iso7816`, AID matched) | 10s of ms |
| 7 | Read EF.CardAccess | Learn PACE parameters (if present) | ~10s ms |
| 8 | PACE (or BAC) | MSE:Set AT + 4× GENERAL AUTHENTICATE (or GET CHALLENGE + EXTERNAL AUTHENTICATE) → session keys, SSC | 100s ms–~2 s |
| 9 | SELECT eMRTD app | `00 A4 04 0C 07 A0000002471001` under SM | ms |
| 10 | Read EF.COM, EF.SOD, DG1 | Small files | 100s ms |
| 11 | Read DG14/DG15, then CA/AA | Anti-cloning; CA restarts SM with new keys | 100s ms–s |
| 12 | Read DG2 | ~15–20 kB in ~90 short chunks | seconds; the bulk of the scan |
| 13 | Done / deselect | App ends session; user can remove phone | — |
| 14 | Verify (server) | PA hashes, SOD signature, DSC→CSCA, CRL; DG1↔MRZ; DG2↔selfie | server-side |

### 26. Troubleshooting by layer

| Symptom | Likely layer | What to check / do |
|---|---|---|
| Never detected | Physical coupling / polling | Wrong spot; closed shielded cover; NFC off; Type B not enabled; iOS AID missing in Info.plist; iOS PACE-only doc needs `.pace` |
| Detected, then lost immediately | Coupling | User moving; metal case; weak spot. Guide repositioning |
| Lost mid-DG2 | Coupling / power during long read | Ask user to hold still; resume after re-auth; smaller chunks |
| `TagLost` during PACE/CA | Coupling or timeout during crypto | Raise Android timeout; hold still; check WTX handling |
| 6A 82 on SELECT AID | Commands | Not an eMRTD app; wrong AID; PACE-only doc refusing pre-PACE select |
| 6A 86 on select (iOS) | Platform/access | PACE-only document; use `.pace` polling |
| 63 00 / auth token fail | Access control | Wrong MRZ/CAN (OCR error, wrong date format) |
| 69 82 on READ | Access control | Not authenticated; trying DG3/DG4 (EAC) |
| 69 87 / 69 88 | Secure messaging | Plain APDU sent in SM session; SSC desync; wrong keys after CA restart |
| 67 00 | APDU format | Extended length not supported; wrong Le |
| 6B 00 / 62 82 | APDU | Offset beyond file; read length handling |
| Hash mismatch for a DG | Verification | Corrupted read (re-read) or tampered data |
| SOD signature OK but chain fails | Verification / trust store | Missing or outdated CSCA; revoked DSC; fantasy CSCA |
| PA OK, CA/AA fails | Verification (clone) | Possible clone; or CA implementation bug; check DG14 covered by SOD |
| Works on Android, fails on iOS | Platform | Info.plist AIDs, `.pace`, 60 s limit, APDU size limits |

### 27. Glossary

- **AA (Active Authentication).** Chip signs a challenge with the DG15 key to prove it is not a clone.
- **AFI (Application Family Identifier).** Type B pre-selection by application family.
- **AID (Application IDentifier).** Names a smart-card application. eMRTD: A0000002471001.
- **ALM (Active Load Modulation).** Phone actively transmits to mimic load modulation in card emulation.
- **APDU (Application Protocol Data Unit).** ISO 7816-4 command/response message.
- **ASK (Amplitude-Shift Keying).** Data by switching carrier amplitude.
- **ATQA / ATQB (Answer To reQuest, Type A/B).** Card's first answer to polling.
- **ATS (Answer To Select).** Type A card's ISO-DEP capabilities.
- **ATTRIB.** Type B select-and-configure command.
- **BAC (Basic Access Control).** MRZ-keyed 3DES mutual authentication; legacy.
- **BCC (Block Check Character).** XOR of 4 UID bytes.
- **BPSK (Binary Phase-Shift Keying).** Data by flipping carrier or subcarrier phase 180°.
- **CA (Chip Authentication).** Static-ephemeral DH with the DG14 key; anti-clone, re-keys SM.
- **CAN (Card Access Number).** Short number printed on ID cards; a PACE password.
- **CID (Card IDentifier).** Logical card number in ISO-DEP.
- **CL / CT (Cascade Level / Cascade Tag 0x88).** UID staging in Type A.
- **CRL (Certificate Revocation List).**
- **CSCA (Country Signing CA).** A state's root for document signing.
- **DF / EF / MF.** Dedicated, Elementary and Master File (7816-4 filesystem).
- **DG (Data Group).** A file in the LDS (DG1 MRZ, DG2 face, …).
- **DSC (Document Signer Certificate).** Signs SODs; issued by the CSCA.
- **EAC (Extended Access Control).** Chip Authentication + Terminal Authentication, protecting DG3/DG4.
- **eMRTD.** Electronic Machine Readable Travel Document.
- **ETU (Elementary Time Unit).** One bit period (128/fc at 106 kbit/s).
- **FeliCa / NFC-F.** Sony's 212/424 kbit/s technology (JIS X 6319-4).
- **FID / SFI.** File IDentifier (2 bytes) / Short File Identifier (5 bits).
- **FSC / FSCI, FSD / FSDI.** Max frame size for card / reader, and their index encodings.
- **FWT / FWI.** Frame Waiting Time and its index.
- **HCE (Host Card Emulation).** App on main CPU emulates a card.
- **ISM band.** Industrial, Scientific and Medical unlicensed band.
- **ISO-DEP / T=CL.** ISO/IEC 14443-4 block transport.
- **LDS (Logical Data Structure).** ICAO file layout.
- **MRZ (Machine Readable Zone).** OCR-B lines on the document.
- **NAD (Node ADdress).** Optional ISO-DEP addressing.
- **NCI (NFC Controller Interface).** Host↔controller protocol.
- **NDEF (NFC Data Exchange Format).** NFC Forum message format.
- **NFCC.** NFC controller chip.
- **NRZ / NRZ-L (Non-Return-to-Zero (Level)).** Level-per-bit coding.
- **NVB (Number of Valid Bits).** Type A anticollision parameter.
- **OOK (On-Off Keying).** ASK with off as one level.
- **PA (Passive Authentication).** Hash + signature + chain check of LDS data.
- **PACE (Password Authenticated Connection Establishment).** DH-based access control.
- **PACE-CAM.** PACE with Chip Authentication Mapping.
- **PCB (Protocol Control Byte).** ISO-DEP block header.
- **PCD / PICC.** Proximity Coupling Device (reader) / Proximity IC Card (tag).
- **PKD (Public Key Directory).** ICAO's distribution of DSCs, CRLs and master lists.
- **PPS (Protocol and Parameter Selection).** Type A bit-rate change.
- **PUPI (Pseudo-Unique PICC Identifier).** Type B identifier.
- **RATS (Request for Answer To Select).**
- **REQA / WUPA, REQB / WUPB.** Request / Wake-up commands, Type A/B.
- **RID (Random ID).** Type A UID starting 0x08, regenerated at power-up.
- **SAC (Supplementary Access Control).** ICAO's name for PACE as a supplement to BAC.
- **SAK (Select AcKnowledge).** Type A select response.
- **SE / eSE / UICC.** Secure element / embedded SE / SIM.
- **SEL.** Select code 0x93/0x95/0x97.
- **SFGI / SFGT.** Start-up Frame Guard Time (index).
- **SM (Secure Messaging).** Encrypted and MACed APDUs.
- **SOD (Document Security Object).** Signed hash list (EF.SOD).
- **SSC (Send Sequence Counter).** SM replay counter.
- **SW1 SW2.** Status words.
- **TA (Terminal Authentication).** Reader proves authorisation (EAC).
- **TD1 / TD3.** ID-card / passport document formats.
- **UID (Unique IDentifier).** Type A identifier (not necessarily unique or fixed).
- **WTX (Waiting Time eXtension).** Card asks for more time.

### 28. What would change this guide

The foundations here are: inductive coupling at 13.56 MHz; 14443 Type A/B signalling; 14443-3/-4 activation and transport; 7816-4 APDUs; and the Doc 9303 LDS with BAC, PACE, PA, AA and CA. They have been stable for 15–20 years and are deeply embedded in issued documents that stay valid for a decade. What *would* change things:

- **New radio interfaces or bit rates.** For example, the very-high bit rates being standardised in ISO/IEC 14443 amendments, or wider use of EMD features.<sup><a href="#nfc-source-18">[18]</a></sup>
- **Doc 9303 amendments.** The BAC phase-out (2027/2028/2038), the 3DES retirement, **LDS2** (travel records, visas, additional biometrics, which require PACE) and any post-quantum signature schemes for PA. ICAO hosts research on post-quantum passive authentication.
- **Platform policy.** Changes to Core NFC entitlements, PACE polling, APDU size limits or the session time limit; changes to the Android NFC stack (reader mode, presence check); and further regional opening of HCE and Secure Element access.
- **Phone hardware.** New antenna placements, materials or controller chips change coupling and the "where to hold it" advice, but not the protocols.

### 29. Sources and further reading

**Physics and antennas**
- RFID4U, "Inductive and Backscatter Coupling": λ/2π boundary, 22.1 m wavelength. <https://rfid4u.com/inductive-and-backscatter-coupling/>
- F. Mattern, ETH Zürich, "Smart Identification" slides (Dagstuhl 2002): near/far field, 1/r³, antenna turns, ISM bands. <https://vs.inf.ethz.ch/publ/slides/dag2002-mattern-2.pdf>
- University of Aveiro, "RFID Inductive Coupling" lecture notes: resonant tag circuit, orientation, metal sensitivity. <https://sweet.ua.pt/andre.zuquete/Aulas/IRFID/11-12/docs/IRFID_nbc_3.pdf>
- NXP AN13219, PN7160 antenna design and matching guide: eddy currents, ferrite sheets. <https://www.nxp.com/docs/en/application-note/AN13219.pdf>
- Lee et al., "Enhanced Loop Structure of NFC Antenna for Mobile Handset Applications", Int. J. Antennas and Propagation (2014). <https://onlinelibrary.wiley.com/doi/10.1155/2014/187029>
- Zhu, Ban, Sim, Wu, "NFC Antenna With Nonuniform Meandering Line and Partial Coverage Ferrite Sheet for Metal Cover Smartphone Applications", IEEE TAP (2017). <https://www.semanticscholar.org/paper/127a818c2ba1bbafbabc62d4163b0dd98364f64a>
- Choi et al., "Efficient NFC coil antennas for fully enclosed metallic-framed wearable devices", IET MAP (2020). <https://ietresearch.onlinelibrary.wiley.com/doi/10.1049/iet-map.2019.0451>
- SDSU, "An NFC-Connected Coupler Using IPT-CPT-Combined…" (metal-cover phones, wireless charging plus NFC). <https://chrismi.sdsu.edu/publications/193.pdf>

**ISO/IEC 14443 signalling, activation and transport**
- Microchip (Atmel) application note, "Requirements of ISO/IEC 14443 Type B Proximity Contactless Identification Cards": ETU, subcarrier, Type A/B modulation, Type B anticollision. <https://ww1.microchip.com/downloads/en/devicedoc/doc2056.pdf>
- T. Kasper, *Embedded Security Analysis of RFID Devices* (2006 thesis): Modified Miller and Manchester rules. <https://www.langer-emv.de/fileadmin/2006_Embedded%20Security%20Analysis%20of%20RFID%20Devices.pdf>
- ISO/IEC 14443-3:2018 and -4:2016/2018 public sample pages (iteh): polling order, 5 ms rule, ATS structure, FSCI/FWI/SFGI. <https://cdn.standards.iteh.ai/samples/73598/64f2bdc65f8540718ee7c437446b6535/ISO-IEC-14443-3-2018.pdf>, <https://cdn.standards.iteh.ai/samples/73599/78cb3949540b4b7da711f301650caa06/ISO-IEC-14443-4-2018.pdf>, <https://cdn.standards.iteh.ai/samples/70172/7dcbdfa8016446c1b389951d798cbb2f/ISO-IEC-14443-4-2016.pdf>
- ISO/IEC JTC1/SC17 WG8 committee draft of 14443-3 (Type B slots, AFI). <https://wg8.de/wg8n1454_17n3497_Ballot_3rdCD14443-3.3.pdf>
- NXP AN10927, "MIFARE product and handling of UIDs": cascade levels, CT 0x88, BCC, RID 0x08. <https://www.nxp.com/docs/en/application-note/AN10927.pdf>
- NXP AN10833, "MIFARE type identification procedure": SAK bit meanings. <https://www.nxp.com/docs/en/application-note/AN10833.pdf>
- NXP MF0ICU1 (MIFARE Ultralight) and MF2DLHX0 (DESFire Light) datasheets: SELECT/NVB/SAK examples. <https://www.nxp.com/docs/en/data-sheet/MF0ICU1.pdf>, <https://www.nxp.com/docs/en/data-sheet/MF2DLHX0.pdf>
- ams AS3953A datasheet: RATS/ATS bytes, FWI example. <https://datasheet.octopart.com/AS3953A-BWLM-ams-datasheet-86726411.pdf>
- Analog Devices MAX66000 datasheet: Type B ATQB/PUPI/ATTRIB. <https://www.analog.com/media/en/technical-documentation/data-sheets/max66000.pdf>
- RF Wireless World, ASK active load modulation (sidebands; secondary). <https://www.rfwireless-world.com/terminology/ask-active-load-modulation-nfc>
- Microblink glossary, ISO/IEC 14443 (secondary summary). <https://microblink.com/resources/glossary/what-is-iso-14443/>

**ISO/IEC 7816-4**
- ISO/IEC 7816-4 status-word tables as quoted in public copies (1995/2005) and in EU Regulation 2016/799 (tachograph), annex IC appendix 2. <https://www.legislation.gov.uk/eur/2016/799/annex/1/appendix/2/division/1/2018-04-17>

**Android**
- IsoDep API reference. <https://developer.android.com/reference/kotlin/android/nfc/tech/IsoDep>
- Host-based card emulation overview. <https://developer.android.com/develop/connectivity/nfc/hce>
- HostApduService reference. <https://developer.android.com/reference/android/nfc/cardemulation/HostApduService>
- Android 10 behaviour changes (Android Beam deprecation). <https://developer.android.com/about/versions/10/behavior-changes-all>
- XDA Developers on Android Beam's removal in Android 14 (secondary). <https://www.xda-developers.com/android-beam-permanent-removal-android-14/>
- NFCGate paper (Android HCE AID routing, research toolkit). <https://arxiv.org/pdf/2008.03913>

**iOS**
- WWDC19 Session 715, "Core NFC Enhancements". <https://developer.apple.com/videos/play/wwdc2019/715/>
- WWDC20 Session 10209 (Core NFC updates). <https://developer.apple.com/videos/play/wwdc2020/10209/>
- Apple Developer Forums: Info.plist AIDs (thread 811459), `.pace` entitlement (thread 724845), eMRTD AID (thread 117329), APDU size reports (thread 120496). <https://developer.apple.com/forums/thread/811459>, <https://developer.apple.com/forums/thread/724845>
- Apple support: HCE-based contactless transactions in the EEA. <https://developer.apple.com/support/hce-transactions-in-apps/>
- Apple support: NFC & SE Platform. <https://developer.apple.com/support/nfc-se-platform/>
- NFCPassportReader issue #164 (PACE polling on iOS, developer report). <https://github.com/AndyQ/NFCPassportReader/issues/164>
- treastrain, "Demystify Core NFC" (polling options ↔ tag types). <https://speakerdeck.com/treastrain/demystify-core-nfc-a-guide-to-ios-app-dev-using-nfc>

**eMRTD (ICAO, BSI, research)**
- ICAO Doc 9303 Part 9 (deployment, ISO 14443 A/B + 7816-4). <https://www.icao.int/sites/default/files/publications/DocSeries/9303_p9_cons_en.pdf>
- ICAO Doc 9303 Part 10 (LDS, FIDs/SFIs, 32 kB, 424 kbit/s, random UIDs). <https://www.icao.int/sites/default/files/publications/DocSeries/9303_p10_cons_en.pdf>
- ICAO Doc 9303 Part 11 (security mechanisms; current BAC/PACE transition). <https://www.icao.int/sites/default/files/publications/DocSeries/9303_p11_cons_en.pdf>, plus the earlier text at <https://www2023.icao.int/publications/documents/9303_p11_cons_en.pdf>
- ICAO Doc 9303 Part 11, 7th edition (2015; PACE-only from 2018). <https://www.icao.int/sites/default/files/TRIP/Publications/Doc-9303-7th-Part11.pdf>
- ICAO TAG/TRIP/5 working paper (amended Part 10 text, 5 ms response rule). <https://www.icao.int/sites/default/files/Meetings/TAG-TRIP/TAG-TRIP5/TAGTRIP.5.WP_.7.en_.FINAL_.FULL_.pdf>
- Doc 9303 Part 12 (PKI): available from the ICAO Doc 9303 publications page.
- BSI TR-03110 (PACE, EAC, Terminal Authentication): available from the BSI website.
- Identity Week, "Deprecation of Basic Access Control (BAC)" (2027/2028/2038, 3DES phase-out). <https://identityweek.net/deprecation-of-basic-access-control-bac/>
- Symbolic Software, "The Electronic Passport, Modeled in Verifpal" (October 2026; February 2026 amendment). <https://symbolic.software/blog/2026-10-07-verifpal-epassport/>
- Juels, Molnar, Wagner, "Security and Privacy Issues in E-passports" (2005). <https://www.arijuels.com/wp-content/uploads/2013/09/JMW05.pdf>
- Avoine, Kalach, Quisquater, "ePassport: Securing International Contacts with Contactless Chips" (FC 2008). <https://sites.uclouvain.be/security/download/papers/AvoineKQ-2008-fc.pdf>
- "A Survey on the Evolution of Cryptographic Protocols in ePassports" (IACR ePrint 2009/200). <https://eprint.iacr.org/2009/200.pdf>
- Signicat (ReadID), "Privacy-related Security Mechanisms for ePassports" (vendor blog). <https://www.signicat.com/blog/privacy-related-security-mechanisms-for-epassports>
- S. Lepstra, thesis on post-quantum passive authentication (hosted by ICAO, 2024). <https://www.icao.int/sites/default/files/2025-06/Thesis-Post-quantum-solution-for-passive-authentication-Siebren-Lepstra-October-2024_0.pdf>
- US Department of State, e-passport media note (14 August 2006; anti-skimming cover). <https://2001-2009.state.gov/r/pa/prs/ps/2006/70433.htm>

**Caveats on sourcing.** Items marked [widely documented; verify against spec] were not re-checked against a primary text during this research. Items marked [Inference] are engineering judgement. Developer-forum and vendor-blog material is labelled where used. Before shipping security-relevant code, implement against the actual Doc 9303 Parts 10–12, BSI TR-03110 and ISO/IEC 7816-4/14443 texts.

## Sources

1. <span id="nfc-source-1"></span>[Inductive and Backscatter Coupling - How Passive RFID works](https://rfid4u.com/inductive-and-backscatter-coupling/)
2. <span id="nfc-source-2"></span>[IsoDep Class (Android.Nfc.Tech)](https://learn.microsoft.com/en-us/dotnet/api/android.nfc.tech.isodep?view=net-android-35.0)
3. <span id="nfc-source-3"></span>[iOS-SDKs/iPhoneOS13.0.sdk/System/Library/Frameworks/CoreNFC.framework/Headers/NFCNDEFReaderSession.h at master · xybp888/iOS-SDKs · GitHub](https://github.com/xybp888/iOS-SDKs/blob/master/iPhoneOS13.0.sdk/System/Library/Frameworks/CoreNFC.framework/Headers/NFCNDEFReaderSession.h)
4. <span id="nfc-source-4"></span>[Detect NFC Tags on iOS 13. This is a short guide to get you…](https://medium.com/@lrunhem/detect-nfc-tags-on-ios-13-bd43dcf68a4e)
5. <span id="nfc-source-5"></span>[Doc 9303 Machine Readable Travel Documents](https://www.icao.int/sites/default/files/publications/DocSeries/9303_p11_cons_en.pdf)
6. <span id="nfc-source-6"></span>[Deprecation of Basic Access Control (BAC)](https://identityweek.net/deprecation-of-basic-access-control-bac/)
7. <span id="nfc-source-7"></span>[Smart Identification Dagstuhl August 2002 Friedemann Mattern ETH Zürich ETH](https://vs.inf.ethz.ch/publ/slides/dag2002-mattern-2.pdf)
8. <span id="nfc-source-8"></span>[What Is ISO/IEC 14443? The Contactless Card Standard](https://microblink.com/resources/glossary/what-is-iso-14443/)
9. <span id="nfc-source-9"></span>[MIFARE Ultralight EV1](https://www.nxp.com/products/rfid-nfc/mifare-hf/mifare-ultralight/mifare-ultralight-ev1:MF0ULX1)
10. <span id="nfc-source-10"></span>[An NFC-Connected Coupler Using IPT-CPT-Combined ...](https://chrismi.sdsu.edu/publications/193.pdf)
11. <span id="nfc-source-11"></span>[What is ASK Active Load Modulation in NFC](https://www.rfwireless-world.com/terminology/ask-active-load-modulation-nfc)
12. <span id="nfc-source-12"></span>[Peer-to-Peer Mode — NFC Operating Mode — NFCFYI](https://nfcfyi.com/mode/peer-to-peer/)
13. <span id="nfc-source-13"></span>[Behavior changes: all apps | Android Developers](https://developer.android.com/about/versions/10/behavior-changes-all)
14. <span id="nfc-source-14"></span><https://www.nxp.com/docs/en/application-note/AN10927.pdf>
15. <span id="nfc-source-15"></span>[@capgo/capacitor-nfc - npm](https://www.npmjs.com/package/@capgo/capacitor-nfc)
16. <span id="nfc-source-16"></span>[NFCTagReaderSession.PollingOption.pace fails with "Missing required entitlement" error](https://developer.apple.com/forums/thread/724845)
17. <span id="nfc-source-17"></span>[Incorrect parameters P1-P2", 106, 134 · Issue #164 · AndyQ/NFCPassportReader · GitHub](https://github.com/AndyQ/NFCPassportReader/issues/164)
18. <span id="nfc-source-18"></span>[Doc 9303 Machine Readable Travel Documents](https://www.d-logic.com/wp-content/uploads/2019/10/9303_p10_cons_en.pdf)
19. <span id="nfc-source-19"></span>[Doc 9303 Machine Readable Travel Documents](https://www.icao.int/sites/default/files/publications/DocSeries/9303_p9_cons_en.pdf)
20. <span id="nfc-source-20"></span>[Doc 9303 Machine Readable Travel Documents](https://www.icao.int/sites/default/files/publications/DocSeries/9303_p10_cons_en.pdf)
21. <span id="nfc-source-21"></span>[BAC vs PACE (ePassport Access) — SmartCardFYI](https://smartcardfyi.com/compare/bac-vs-pace/)
22. <span id="nfc-source-22"></span>[Privacy-related Security Mechanisms for ePassports - Signicat](https://www.signicat.com/blog/privacy-related-security-mechanisms-for-epassports)
