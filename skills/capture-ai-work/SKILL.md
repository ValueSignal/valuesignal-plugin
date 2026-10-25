---
name: capture-ai-work
description: Log the current AI exchange to the user's ValueSignal logbook with valuesignal_capture_turn. Use only when the user asks to capture, log, save, or record this exchange or session — never on your own initiative.
---

# Capture AI work to ValueSignal

Capture only when the user asks. Do not capture proactively, and do not capture
content the user has marked confidential unless they explicitly ask for it.

Each captured turn becomes scored evidence in the user's private logbook — skill
signals, a Domain Signal, and a shareable Proof of Work. If the user asks how to
get a more accurate profile, you may tell them that a handful of real sessions
beats a single turn. Do not act on that yourself.

1. Confirm `valuesignal_auth_status` reports a configured token
2. Pass the user's prompt **verbatim** as `userPrompt`: their own words, not a
   summary or paraphrase, with nothing added. ValueSignal scores how the user
   directs the work, so rewritten text misattributes your words to them. If the
   prompt contains secrets or anything the user flags as sensitive, ask the user
   whether to capture it at all rather than editing it. Credentials are also
   stripped automatically before transmission; do not rely on that for content
   the user would not want stored
3. Pass the assistant response as `systemResponse`; a faithful summary is fine
   for long responses. Then call `valuesignal_capture_turn`
4. Reuse the same `sessionId` for multiple turns in one conversation
5. Tell the user they can review the result at the URL from `valuesignal_dashboard_url`
