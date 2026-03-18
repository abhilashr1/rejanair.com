---
layout: post
title:  "The Bottleneck Is Not the Code"
date:   2026-03-17 10:00:00 +0530
tags: [engineering, code-review, teams, process, opinion]
---

I came across Avery Pennarun's piece ["Every layer of review makes you 10x slower"](https://apenwarr.ca/log/20260316) and it hit a nerve. His central argument is simple: every layer of approval in a software process multiplies wall-clock time by roughly 10x. A 30-minute bug fix becomes 5 hours with code review, a week with design doc approval, and 12 weeks once cross-team scheduling enters the picture. The bottleneck is waiting while not performing any meaningful work.

I think the irony is almost too perfect in 2026.

### AI Angle

We now have tools that can generate entire features in minutes. Claude, Copilot, Cursor, etc - whatever your preference is. The code generation problem is, for many practical purposes, solved for a large class of tasks. And yet, shipping hasn't gotten proportionally faster. Why?

Because the bottleneck was never the code.

If AI cuts your coding time from 30 minutes to 3 minutes, you've saved 27 minutes. Congratulations. Your PR will still sit in a review queue for hours or days. The design doc still needs sign-off from three people, two of whom are in different time zones. The deploy window is still Thursday afternoon. You've optimized the one part of the pipeline that was already the fastest.

This is what Pennarun nails perfectly: the slowest layer dominates. You can't overcome latency with brute force. It doesn't matter how fast you generate code if the human bureaucracy downstream hasn't changed at all.


### Reviews That Aren't Really Reviews

My pet peeve is code reviews that are really just opinion enforcement sessions. You know the ones - the PR is functionally correct, tests pass, the logic is sound, but someone blocks it because they'd prefer `userCount` over `numberOfUsers`. Or they want you to restructure a perfectly readable function into their preferred pattern.

These reviews aren't about code quality. They're about control. They're about enforcing a hierarchy where the reviewer's taste matters more than the author's. And they're incredibly expensive -- not because the change itself takes time, but because the round-trip kills momentum. You context-switch away, pick up something else, get the notification a day later, switch back, make a trivial rename, push, wait for re-review. For a variable name.

I've seen this pattern more times than I'd like to admit. The review process becomes about demonstrating authority rather than improving the code. And the worst part is that these reviews often miss the things that actually matter - race conditions, missing edge cases, etc, because the reviewer spent their attention budget on superficial cosmetic preferences.


### The Buddy System

The best review experience I've had was working with a buddy system. Instead of throwing PRs over the wall and waiting, you pair up with someone for a stretch of work. Your buddy has context on what you're building because you've been talking about it. Reviews become conversations, not inspections.

What changes with this model:

- Reviews happen fast because your buddy is already expecting the PR. No queue, no random assignment, no waiting for someone with zero context to ramp up on your change.
- The focus shifts to substance where questions like does this work, is it maintainable, are we missing edge cases?, etc are addressed. Nobody wastes time on style because you've already aligned on conventions through ongoing collaboration.
- When you work closely with someone, you develop a shared understanding of what "good" looks like. You stop second-guessing each other's naming choices because you know their judgment is sound.
- Feedback is two-way. Both people learn, both people catch things the other missed.

This maps directly to what Pennarun describes from the Toyota Production System: trust across levels, individual authority over quality, systems that prevent errors rather than catching them downstream.

I'm not arguing for no review. I'm arguing for review that earns its cost. A review layer that catches a critical bug every week is worth the slowdown. A review layer that mostly produces `nit: rename this variable` comments is pure drag.

Pennarun's blog ends with "it just takes trust." That's both completely right and frustratingly hard. Trust is built through repeated demonstrated competence, which requires giving people the autonomy to demonstrate it. You can't build trust through a system designed around the assumption that nobody can be trusted.