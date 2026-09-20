---
title:  "Building a Browser Agent Without an LLM in the Action Loop"
date:   2026-09-20 10:00:00 +0530
tags: [ai, agents, browser-automation, typesafe, jev, open-source]
---

Browser agents are impressive right up until you watch one spend a full reasoning turn deciding whether a button named **Search** is the button it should click.

The usual loop looks something like this: take a browser snapshot, send it to a general-purpose LLM, ask the model what to do next, execute the action, and repeat. It works, but every click becomes a miniature agent run. That means more latency, more tokens, more cost, and another opportunity for a generative model to invent a selector that was never there.

I wanted to see if the inner loop could work differently.

The result is [Jev Agent Browser Skill](https://github.com/abhilashr1/jev-agent-browser-skill), an open-source Agent Skill that uses TypeSafe's Jev model to choose browser actions from a bounded set. The main agent still sets the high-level direction. Jev handles the page-level decisions. Ordinary code owns everything in between.

### The Problem With Putting a Large Model Behind Every Click

A general-purpose LLM is useful when a task is ambiguous, open-ended, or needs real reasoning. Most individual browser actions are none of those things.

Once the goal is known and the page has been observed, the next action is usually a closed-set decision:

- click one of these links,
- fill one of these fields with one of these supplied values,
- switch to one of these tabs,
- scroll,
- wait,
- finish,
- or stop because there is no safe action.

Asking a large generative model to produce prose or tool calls for that decision feels wasteful. It is like starting a committee meeting every time a state machine needs to pick its next transition.

It also creates an awkward trust boundary. If the model generates a selector or command, the executor has to decide whether that generated output is valid. The browser page itself is untrusted, so now page content can influence a model that is also allowed to invent actions.

The better question was: what if the model could only choose from actions that code had already proved were executable?

### Jev as a Programming Primitive

Jev is TypeSafe's System One model. It is not trying to be a chatbot or a long-horizon reasoning engine. It takes application state plus typed questions and returns structured judgments and probabilities.

That changes the shape of the browser loop.

The controller asks `agent-browser` for a compact accessibility snapshot. It then converts the current page into a list of concrete candidates: activate this exact ref, fill that exact field with this supplied value, switch to this known tab, wait, scroll, finish, or stop.

Jev receives a TypeSafe `Choice` over those candidates and a `Noul` asking whether the visible page proves the goal is complete. It cannot make up a CSS selector, shell command, or browser tool. Its answer has to be one of the option IDs created by the controller.

```text
semantic goal + bounded values
        ↓
agent-browser accessibility snapshot
        ↓
deterministic executable action set
        ↓
Jev Choice + completion Noul
        ↓
confidence, authorization and freshness gates
        ↓
execute one stored action and repeat
```

The distinction matters. The model supplies judgment. Code supplies authority.

### What the Main Agent Still Does

This is not a claim that the whole workflow contains no AI or that Jev magically plans an entire browser session.

A supervising model can still translate a user's request into a narrow semantic outcome, decide which values are relevant, and split a long task into phases. What it does **not** do is inspect the page and decide that ref `e17` looks clickable.

For example, the supervisor might say:

> Find the requested role, open the matching listing, and stop when the external application page is visibly loaded. Do not fill or submit the form.

From that point onward, Jev chooses each page-level action. If confidence falls below the configured threshold, the controller stops. The supervising model does not quietly take over and click something itself.

That boundary is the whole point of the project.

### Why This Is Fast and Cheap

The inner loop does not need a large context window full of tool schemas and chain-of-thought-style planning. Jev gets bounded state and a typed question. The response is a choice, a probability distribution, and confidence.

That gives the design a few useful properties:

- **Fast decisions:** the model is solving a narrow System One judgment rather than producing a full agent response.
- **Small outputs:** there is no generated plan or prose for every click.
- **Lower cost:** the loop uses focused TypeSafe calls instead of repeatedly invoking a general-purpose LLM. Actual cost still depends on the number of steps and current TypeSafe pricing, but the unit of work is dramatically smaller.
- **No hallucinated tools:** Jev can only select an action that deterministic code enumerated.
- **Better observability:** every step records the selected option, completion probability, and confidence.
- **Explicit uncertainty:** low confidence is data the controller can gate on, not something buried inside persuasive prose.

I think this is the more interesting part than the browser demo itself. Models do not always need to own an entire workflow. A small typed judgment can be composed like any other programming primitive.

### Code Owns the Boring but Important Parts

The controller is intentionally strict.

It verifies prerequisites before doing anything: Node.js, a compatible `agent-browser`, browser setup, the TypeSafe key, and supported model configuration. It uses exact domain allowlists. It re-observes the page after inference so a stale ref cannot be executed against changed state. It detects repeated actions, validates TypeSafe's response shape, bounds page context, and requires both confidence and visible completion evidence before finishing.

Page activations and fills are default-deny. They require a narrow user authorization for the run. Environment-backed secrets are withheld from Jev, tied to an exact HTTPS host, removed from the browser child process environment, and transported over stdin rather than command-line arguments.

None of this makes browser automation perfectly safe. Pages are adversarial input, same-origin pages can still behave badly, and a typed model can still make the wrong judgment. But the failure modes are much easier to reason about when the model is choosing from stored actions rather than generating executable instructions.

### Where It Works, and Where It Does Not

The approach works best on conventional sites with useful accessibility labels and goals that can advance one bounded action at a time.

It is weaker on canvas-heavy applications, unlabeled controls, visual puzzles, complex cross-origin frames, and workflows that need long-horizon reasoning. CAPTCHA is still CAPTCHA. The correct behavior there is to fail closed or request a legitimate human handoff, not pretend the model has discovered a clever bypass.

Image selection has a similar limitation. Jev can judge accessible labels and surrounding text, but it is not a pixel-level safety classifier. The skill can save a Jev-selected element screenshot; it cannot guarantee what an image depicts without a separate vision or moderation system.

These limits are features of an honest architecture. The controller should know which decisions it can make and stop when the evidence is insufficient.

### A Different Agent Architecture

The dominant agent pattern right now gives one large model a goal, a collection of tools, and as much autonomy as we can safely tolerate. This project explores the opposite direction.

Keep the workflow in code. Keep permissions in code. Keep retries, thresholds, state transitions, and side-effect policy in code. Insert a model only where ordinary code lacks semantic judgment, and make that judgment as small and typed as possible.

That is a different paradigm from "LLM, please operate this computer." It is closer to building a normal program with a new kind of conditional:

```text
if Jev says this action best advances the goal with enough confidence:
    execute the already-validated action
else:
    stop
```

The first version is now open source under MIT at [github.com/abhilashr1/jev-agent-browser-skill](https://github.com/abhilashr1/jev-agent-browser-skill). It includes the Agent Skill, a dependency-free Node.js controller, prerequisite diagnostics, architecture notes, and a mocked test suite.

It is still an experiment, but I think the underlying idea has legs: use powerful models for direction, fast judgment models for decisions, and deterministic software for control.
