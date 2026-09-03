---
format: 1920x1080
duration: 90s
message: "Drop a tender pack. Get an audited answer with physical-page evidence."
arc: "Demo Loop — price tension → scope boundary → live input → processing proof → findings → conflict → grounded Q&A → audit → bounded comparison"
audience: "procurement teams and Monid competition judges"
language: English
mode: autonomous
music: none
vo_mode: restructure
truth_gate: "Do not render until npm run evidence:check passes against campaign evidence."
---

## Video direction

Palette: use `frame.md` exactly — `#F2F5F7` canvas, `#17212B` headlines,
`#17425F` as the only accent, blue-tinted cards with no shadow, green/red only
for literal directional or status semantics. Arial display/body roles and the
bottom progress strip bind every frame. All load-bearing content stays in the
top 83% so the caption band remains clear.

Motion grammar: one paused, deterministic timeline per frame; smooth long-tail
settles, normally `power3`, never bounce for emphasis. Reveal each fact only
when its spoken cue arrives, including in the back half of the frame. No
wall-clock, randomness, infinite repeat, CSS transition, or autoplay motion.
Internal seams cut at matched velocity. The production UI remains the subject;
decorative atmosphere is limited to the cover and closing treatments.

Rhythm: Frames 1, 3, 4, 5, 6, 7, and 8 develop sequentially with the voice.
Frame 2 uses a fixed anchor while exclusions cycle. Frame 9 is the deliberate
breather: one reveal and a static final hold. Resolved content holds still; at
most a finite low-amplitude jitter may remain, never a breathing card or a
back-half camera drift.

Never show: invented customers, generated testimonials, unsupported metrics,
fake browser chrome, fake progress, simulated deletion, hidden retention,
unverified page numbers, or a full-platform replacement claim. Also forbid the
two motion failures: slideshow (front-load then freeze) and screensaver
(independent floating objects).

## Frame 1 — The price anchor

- scene: The official bidworx pricing capture yields to one large £190/month figure and “typical usage: one tender.”
- voiceover: "Bidworx Starter is listed at one hundred ninety pounds a month — for roughly one tender."
- duration: 6s
- transition_in: cut
- status: outline
- src: compositions/frames/01-price-anchor.html
- type: hook
- persuasion: Price contrast grounded in an official capture
- beat: tension
- blueprint: dataviz-countup (Adapt) — keep the count-up-to-hero signature; replace the chart field with the official source capture
- asset_candidates: assets/bidworx-pricing-2026-09-03.png — official bidworx pricing-page capture showing Starter at £190/month and typical usage of one tender
- focal: assets/bidworx-pricing-2026-09-03.png
- roles: bidworx-pricing-2026-09-03.png = supporting source evidence; £190 = focal verified statistic

narrativeRole: Establish the expensive incumbent anchor without implying feature parity.
keyMessage: The visible competitor price is £190/month; the source screenshot remains on screen long enough to verify.
sourceTruth: Official bidworx pricing capture, refreshed before submission.

Adapt: keep the verified number as the only hero metric and keep the source
capture continuously legible; omit trend charts, deltas, and decorative data.
Scene 1 (0.0–1.8s): the official capture seats as a large right-hand evidence panel while “OFFICIAL PRICE” and the source date reveal at upper-left; asymmetric 40/60, three depth layers, with a restrained panel settle (`spring-pop-entrance`).
Scene 2 (1.8–4.7s): as the voice says the price, a large tabular £0→£190 counter grows on the left (`counting-dynamic-scale`), then “/ month” and “typical usage: one tender” reveal on their exact cues; the capture remains unchanged and readable.
Scene 3 (4.7–6.0s): the £190 figure, qualifier, and source panel hold fully resolved; no camera drift or decorative count continues.

## Frame 2 — The boundary is the product

- scene: Search, bid writing, CRM, and approvals cycle out; “supplied-document analysis” remains fixed.
- voiceover: "Search? Bid writing? CRM? No. RFP X-Ray replaces one job: analyzing the documents you supply."
- duration: 6s
- transition_in: squeeze
- status: outline
- src: compositions/frames/02-scope-boundary.html
- type: product_intro
- persuasion: Scope precision and expectation control
- beat: clarity
- blueprint: fixed-anchor-cycle (Adapt) — pin the supported job while unsupported categories cycle in a separate slot
- asset_candidates:

narrativeRole: Prevent the price comparison from becoming a false full-platform replacement claim.
keyMessage: This is document-only analysis, not tender search or bid management.
sourceTruth: Product scope and public landing copy.

Adapt: keep the immovable anchor and discrete cycle signature, but cycle only
the four explicitly excluded product categories; finish on the supported job.
Scene 1 (0.0–1.4s): “RFP X-Ray replaces” reveals at upper-left and pins permanently; the camera is locked, rule-of-thirds, low density (`spring-pop-entrance`).
Scene 2 (1.4–4.2s): a separate large right-hand slot cycles Search → Bid writing → CRM → Approvals with hard-cut replacements (`discrete-text-sequence`); each state receives a small “NO” tag without touching or moving the anchor.
Scene 3 (4.2–5.2s): the cycle stops and clears; “SUPPLIED-DOCUMENT ANALYSIS” assembles beneath the anchor word by word (`dynamic-content-sequencing`) as the voice says “one job.”
Scene 4 (5.2–6.0s): the completed bounded claim holds static with “Document-only. No search.” as quiet source-aligned chrome.

## Frame 3 — Supply the whole package

- scene: The real production source form receives the CER base RFP plus Amendments 001, 002, and 003, deliberately shown in a noncanonical upload order.
- voiceover: "Add the CER RFP and amendments one, two, and three. Upload order does not control the version chain."
- duration: 10s
- transition_in: zoom-through
- status: outline
- src: compositions/frames/03-package-input.html
- type: feature_showcase
- persuasion: Show-don't-tell workflow proof
- beat: control
- blueprint: cursor-ui-demo (Adapt) — a locked production surface with one cursor actor and four evidence-backed document states
- asset_candidates: assets/og-image.png — captured RFP X-Ray product image
- focal: assets/og-image.png
- roles: og-image.png = supporting brand/product surface until replaced by the gated live production recording
- evidence_slot: PENDING_LIVE production browser recording of the four-document CER input

narrativeRole: Begin the continuous demo loop with the exact official package.
keyMessage: The product accepts a base document and three amendments and derives canonical order from evidence.
sourceTruth: Official CER package hashes plus the final live campaign request.

Adapt: keep the cursor-driven state changes and final action lock; use the real
production recording as the final surface and avoid reconstructed browser
chrome. This frame remains blocked by its live-capture gate.
Scene 1 (0.0–2.4s): the production source form fills the upper 83%; the cursor enters and adds the CER base document, with the base row receiving its verified role badge (`cursor-click-ripple`).
Scene 2 (2.4–7.6s): on the spoken amendment cues, three amendment rows arrive in deliberately noncanonical order; the cursor drives each add while row state changes remain discrete and readable (`dynamic-content-sequencing`).
Scene 3 (7.6–9.0s): a compact version-chain preview resolves as main → 001 → 002 → 003 independent of the visible upload order; a restrained highlight lands on “derived from document evidence.”
Scene 4 (9.0–10.0s): the cursor settles on the real Analyze pack control and holds; do not show a click unless it is part of the retained production recording.

## Frame 4 — Parse, purge, reconcile, verify

- scene: The production progress rail advances through Parse, Purge, Extract, Reconcile, and Verify; deletion and provider-cost receipts resolve beside it.
- voiceover: "Monid parses. App-controlled sources are purged. Then RFP X-Ray extracts, reconciles, verifies — and records the real cost."
- duration: 13s
- transition_in: push-slide LEFT
- status: outline
- src: compositions/frames/04-progress-proof.html
- type: feature_showcase
- persuasion: Operational transparency
- beat: trust
- blueprint: agent-progress-theater (Adapt) — production stages perform visibly, then resolve into cleanup and cost receipts
- asset_candidates: assets/og-image.png — captured RFP X-Ray product image
- focal: assets/og-image.png
- roles: og-image.png = supporting product surface until replaced by the gated live progress recording
- evidence_slot: PENDING_LIVE CER progress and cleanup recording

narrativeRole: Make the machine work and cleanup boundary visible instead of simulating instant output.
keyMessage: Parsing, app-controlled deletion, reconciliation, verification, and cost are separately auditable.
sourceTruth: Final live campaign timings, cleanup receipts, and cost ledger only.

Adapt: keep the working-state theater and mutating receipt rows; replace playful
status copy with the product's exact state machine and use no cursor after the
initial handoff. This frame remains blocked by its live-capture gate.
Scene 1 (0.0–2.0s): the real run enters `parsing`; a thin blue arc rotates finitely beside “Monid parse” and stops exactly when the stage changes (`svg-icon-enrichment`).
Scene 2 (2.0–7.7s): Purge → Extract → Reconcile → Verify replace one another only on their spoken cues (`discrete-text-sequence`); the active row changes state while completed rows receive a drawn check (`svg-path-draw`).
Scene 3 (7.7–11.3s): a blue-tinted receipt panel expands under the stages (`anchored-layout-expand`); app-controlled source deletion and provider-attempt rows arrive from the real ledger, never from estimates.
Scene 4 (11.3–13.0s): the run status and receipt stack hold fully resolved; the processing duration appears only if the live recording and verifier agree.

## Frame 5 — The award logic, intact

- scene: Four verified result rows land in sequence: mandatory gate; 50/94; 70% technical + 30% price; September 15, 2026 at 14:00 MDT.
- voiceover: "Mandatory gate. At least fifty of ninety-four. Seventy percent technical, thirty percent price. The current deadline is September fifteenth, two p.m. Mountain."
- duration: 17s
- transition_in: crossfade
- status: outline
- src: compositions/frames/05-evaluation-logic.html
- type: feature_showcase
- persuasion: Verifiable extraction proof
- beat: confidence
- blueprint: grid-card-assemble (Adapt) — four cited rules populate into an asymmetric evidence board
- asset_candidates:
- evidence_slot: PENDING_LIVE CER evaluation view with clickable physical-page citations

narrativeRole: Demonstrate that the system preserves gates, thresholds, weighting, and the amended deadline as distinct facts.
keyMessage: Mandatory pass, 50/94, 70/30, and the September 15 deadline remain correctly bound.
sourceTruth: CER final live analysis and official pages; no model-authored page numbers.

Adapt: keep the staggered assembly signature but use four semantically distinct
rows rather than a decorative equal-card grid; every row includes its verified
page control from the final live result.
Scene 1 (0.0–3.2s): “AWARD LOGIC” and an empty four-row evidence board establish on the left-heavy frame; only the mandatory-gate row fills when the voice names it (`center-outward-expansion`, short-path form).
Scene 2 (3.2–7.2s): the 50/94 threshold row arrives on cue; its numerator and denominator remain one bound phrase, followed by its real citation affordance (`dynamic-content-sequencing`).
Scene 3 (7.2–11.7s): 70% technical and 30% price arrive as one paired scoring rule; two cobalt bars fill together without implying a new metric (`stat-bars-and-fills`).
Scene 4 (11.7–15.2s): the amended September 15, 2026, 14:00 MDT deadline arrives last in the focal row, with the superseded predecessor visibly secondary rather than deleted.
Scene 5 (15.2–17.0s): the four-row board holds for citation inspection; no camera move and no status animation remain.

## Frame 6 — Replacement and contradiction

- scene: Amendment 003 supersedes the old 37-row M3 table; a document traversal highlights 2050 on page 2 and 2055 on pages 5 and 6, resolving to CONFLICTED.
- voiceover: "Amendment three replaces all thirty-seven M3 rows. But it says twenty-fifty on page two — and twenty-fifty-five on pages five and six. Clarification is required."
- duration: 16s
- transition_in: push-slide LEFT
- status: outline
- src: compositions/frames/06-amendment-conflict.html
- type: feature_showcase
- persuasion: High-risk exception proof
- beat: skepticism to trust
- blueprint: transcript-scroll-artifact-reveal (Adapt) — traverse the amendment lineage, hinge on the year mismatch, reveal the conflicted claim
- asset_candidates:
- evidence_slot: PENDING_LIVE CER amendment and conflict view with three citation clicks

narrativeRole: Show the distinctive amendment-reconciliation value, including refusal to invent a single answer.
keyMessage: Replacement is complete, while the internal 2050/2055 contradiction remains visibly unresolved.
sourceTruth: Amendment 003 physical pages 2, 5, and 6 plus the final materialized lineage.

Adapt: keep TRAVERSE → HINGE → ARTIFACT and the two-camera-move ceiling;
replace generic transcript content with the real amendment lineage and three
physical-page citations. This frame remains blocked by its live-result gate.
Scene 1 (0.0–5.5s): a full-bleed amendment lineage surface scrolls upward as the 37 prior M3 rows acquire superseded state and the replacement block enters in reading order (`3d-page-scroll`, flat element-scroll form).
Scene 2 (5.5–9.2s): traversal settles on “2050” from amendment page 2; as the voice contrasts it with “2055,” page 5 and page 6 evidence rows arrive and a precise highlight sweep marks only the conflicting year tokens (`css-marker-patterns`).
Scene 3 (9.2–13.5s): the highlighted evidence becomes the hinge; one controlled push frames the three citations while the conflict record expands below (`coordinate-target-zoom`, then `anchored-layout-expand`).
Scene 4 (13.5–16.0s): `CONFLICTED`, candidate values 2050/2055, and “clarification is required” hold together; the camera locks and all three page controls remain visible.

## Frame 7 — Ask inside the pack

- scene: A production question is typed; the answer streams with a page citation and no outside-search activity.
- voiceover: "Ask which deadline controls. The answer stays inside the supplied pack — and links back to the page."
- duration: 10s
- transition_in: crossfade
- status: outline
- src: compositions/frames/07-grounded-question.html
- type: feature_showcase
- persuasion: Bounded-answer risk reversal
- beat: relief
- blueprint: prompt-type-submit-generate (Adapt) — one real production question produces one cited closed-document answer
- asset_candidates:
- evidence_slot: PENDING_LIVE CER grounded Q&A recording

narrativeRole: Complete the demo loop with a closed-document question rather than web search.
keyMessage: Q&A is grounded in supplied sources and returns a verifiable page.
sourceTruth: Final campaign Q&A payload, citation verifier, and search_events=0.

Adapt: keep the type → submit → answer sequence; remove generic thinking
theater and show only the real production interaction. This frame remains
blocked by the live-Q&A gate.
Scene 1 (0.0–2.8s): the real Ask This RFP input establishes in the upper half and types “Which submission deadline controls?” character by character with a visible caret (`discrete-text-sequence`, `context-sensitive-cursor`).
Scene 2 (2.8–4.2s): the submit control receives one restrained press; the input locks and no outside-search chrome appears (`cursor-click-ripple`).
Scene 3 (4.2–8.2s): the verified answer arrives by phrase on its real production cadence, with the current deadline and its physical-page citation revealing only when the response supplies them (`dynamic-content-sequencing`).
Scene 4 (8.2–10.0s): `search_events=0`, the answer, and the clickable page control hold for inspection; no fabricated second query or streaming text is added.

## Frame 8 — The receipt, not a promise

- scene: Audit & Cost separates actual provider charges, estimated infrastructure, failed attempts, cleanup, and elapsed time.
- voiceover: "Every attempt, retry, cleanup receipt, and dollar is visible. Actual stays separate from estimated. This run cost {{LIVE_TOTAL_COST_USD}} and took {{LIVE_END_TO_END_DURATION}}."
- duration: 9s
- transition_in: squeeze
- status: outline
- src: compositions/frames/08-audit-cost.html
- type: benefit_highlight
- persuasion: Radical cost transparency
- beat: trust + control
- blueprint: dataviz-countup (Adapt) — measured campaign values land only after wallet reconciliation
- asset_candidates:
- evidence_slot: PENDING_LIVE Audit & Cost recording

narrativeRole: Convert the demo from a feature claim into an auditable operational record.
keyMessage: The final values must come from the sanitized live verifier report; unknown costs remain unknown.
sourceTruth: PENDING_LIVE campaign artifact and Monid wallet reconciliation.

Adapt: keep data as the argument but omit every metric until the sanitized live
artifact supplies it; actual and estimated values occupy visibly different
lanes. This frame must fail its own build gate while live metric tokens remain.
Scene 1 (0.0–2.0s): Audit & Cost establishes as a split 60/40 board; “ACTUAL” and “ESTIMATED” seat as separate headers with no zero-valued placeholders.
Scene 2 (2.0–5.1s): provider attempts, retries, and cleanup receipts populate row by row from the live ledger (`center-outward-expansion`, short-path form); a failed-attempt row appears only if one truly exists.
Scene 3 (5.1–7.6s): the reconciled total and end-to-end duration count to their exact final values (`counting-dynamic-scale`) while unavailable shared-plan costs remain explicitly unavailable, never zero.
Scene 4 (7.6–9.0s): the measured values and completeness disclosure hold static for reading; no decorative chart or trend is introduced.

## Frame 9 — Analysis, not the rest

- scene: A calm comparison end card holds bidworx Starter £190/month beside RFP X-Ray {{LIVE_TOTAL_COST_USD}} per audited run, then resolves to the product URL.
- voiceover: "Tender analysis — not the rest."
- duration: 3s
- transition_in: zoom-through
- status: outline
- src: compositions/frames/09-close.html
- type: cta
- persuasion: Honest bounded comparison
- beat: confidence
- blueprint: titlecard-reveal (Adapt) — one restrained comparison card and a held URL
- asset_candidates:

narrativeRole: End on the exact replacement boundary and measured per-run comparison.
keyMessage: bidworx Starter is £190/month; RFP X-Ray uses the final measured audited-run cost, without claiming platform parity.
sourceTruth: Official bidworx capture plus PENDING_LIVE campaign total.

Adapt: keep the single-card reveal and still hold; shorten the spoken line while
the verified comparison remains on screen. Rendering stays blocked until the
same reconciled cost token used in Frame 8 is inserted here.
Scene 1 (0.0–0.7s): a clean two-column comparison card is already legible on the warm canvas, with bidworx £190/month at left and RFP X-Ray `{{LIVE_TOTAL_COST_USD}} per audited run` at right.
Scene 2 (0.7–1.6s): one restrained slide-up crossfade replaces the divider label with “TENDER ANALYSIS — NOT THE REST” (`discrete-text-sequence`).
Scene 3 (1.6–3.0s): `rfp-xray.vercel.app` and the bounded comparison hold completely still through the final frame.
