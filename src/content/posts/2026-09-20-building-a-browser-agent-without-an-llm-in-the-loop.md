---
title:  "Building a Browser Agent Without an LLM in the Action Loop"
date:   2026-09-20 10:00:00 +0530
tags: [ai, agents, browser-automation, typesafe, jev, open-source]
---

Browser agents are impressive right up until you watch one spend a full reasoning turn deciding whether a button named **Search** is the button it should click.

The usual loop takes a browser snapshot, sends it to a general-purpose LLM, asks what to do next, executes the action, and repeats. It works, but every click becomes a miniature agent run: more latency, more tokens, more cost, and another chance for the model to invent something that is not on the page.

I wanted to see if the inner loop could work differently. The result is [Jev Agent Browser Skill](https://github.com/abhilashr1/jev-agent-browser-skill), an open-source Agent Skill where the main model sets direction, TypeSafe's Jev chooses page-level actions, and ordinary code stays in control.

### Most Browser Actions Are Closed-Set Decisions

A large model is useful when a task is ambiguous or needs real planning. An individual browser action usually does not.

Once the goal and page state are known, the next step is normally one of a small set:

- click one of these links,
- fill one of these fields with a supplied value,
- switch to an open tab,
- scroll or wait,
- finish,
- or stop because nothing safe is available.

That is a classification problem, not a text-generation problem. Asking an LLM to produce a plan and tool call for every step feels like starting a committee meeting whenever a state machine needs its next transition.

Jev is TypeSafe's System One model. It accepts application state and typed questions, then returns structured judgments and probabilities. It does not need to generate a selector, command, or explanation.

### How the Controller Works

The controller uses `agent-browser` to read a compact accessibility snapshot. From that snapshot, deterministic code builds a bounded list of actions that are actually executable: activate this exact ref, fill this exact field with this supplied value, switch to this known tab, wait, scroll, finish, or stop.

Jev receives a TypeSafe `Choice` over those actions and a `Noul` asking whether the visible page proves the goal is complete.

```text
semantic goal + values
        ↓
agent-browser accessibility snapshot
        ↓
deterministic action candidates
        ↓
Jev Choice + completion Noul
        ↓
policy, confidence and freshness checks
        ↓
execute one stored action and repeat
```

Jev cannot invent a CSS selector or browser tool. Its answer must match an action record created by the controller. The model supplies judgment; code supplies authority.

The supervising model still has a job. It turns the user's request into a narrow outcome, provides relevant values, and can split a long workflow into phases. What it does not do is inspect the page and choose which element to click. If Jev is uncertain, the controller stops instead of quietly falling back to the larger model.

### The Engineering Boundaries

The interesting work is not just connecting two APIs. It is deciding what the model is allowed to influence.

Before executing a choice, the controller re-observes the browser and compares the complete page and tab state. If the page changed while Jev was deciding, the old action is discarded. TypeSafe responses are validated for model identity, answer type, probabilities, confidence, and membership in the current action set.

The controller also applies exact domain allowlists, iteration limits, repeated-action detection, and explicit completion thresholds. A task finishes only when Jev chooses `finish`, its confidence passes the configured threshold, and the separate completion judgment says the visible evidence is strong enough.

Page activations and fills are default-deny. They need a narrow user authorization for that run. Environment-backed secrets are hidden from Jev, restricted to an exact HTTPS host, removed from the browser child process environment, and sent over stdin instead of command-line arguments.

None of this proves that a page is safe. Page content is still untrusted input and models can still make wrong judgments. But the failure modes are easier to reason about when the model selects from stored actions instead of generating executable instructions.

### Why This Is Useful

The inner loop no longer needs a large context full of tool schemas and a general-purpose model producing prose for every click.

That gives the design a few useful properties:

- **Fast, focused decisions:** Jev handles a narrow System One judgment.
- **Lower cost:** each step is a small typed evaluation rather than a full LLM agent turn.
- **No hallucinated tools:** only actions enumerated by code can execute.
- **Explicit uncertainty:** confidence is available to application logic instead of being hidden inside fluent text.
- **Better observability:** each step records the selected option and completion probability.

This does not mean the entire system has "no AI." It means there is no general-purpose generative LLM inside the page-action loop. That distinction is important.

### Limits and the Bigger Idea

This approach works best on sites with useful accessibility labels and tasks that can advance one bounded action at a time. Canvas-heavy interfaces, visual puzzles, unlabeled controls, complex iframes, and CAPTCHA remain difficult. The correct behavior there is to fail closed or request legitimate human input, not pretend the controller found a clever bypass.

The broader idea is more interesting than browser automation itself: models do not need to own entire workflows. Keep permissions, retries, thresholds, and state transitions in code. Insert a model only where normal code lacks semantic judgment, and make that judgment as small and typed as possible.

The project is available under MIT at [github.com/abhilashr1/jev-agent-browser-skill](https://github.com/abhilashr1/jev-agent-browser-skill). It includes the Agent Skill, a dependency-free Node.js controller, prerequisite diagnostics, architecture notes, and 36 mocked tests.
