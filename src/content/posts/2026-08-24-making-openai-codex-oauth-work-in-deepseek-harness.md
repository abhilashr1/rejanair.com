---
title:  "Making OpenAI Codex OAuth Work in DeepSeek Harness"
date:   2026-08-24
tags: [engineering, openai, codex, oauth, ai-agents]
---

I wanted to try out the brand new DeepSeek Harness as the control plane for a few agents while letting them call OpenAI Codex through the ChatGPT login I already had on this machine. The Luna max model is an insane value on the codex sub, and I didn't want to pay the increased Deepseek Peak hour pricing to test out a new harness.

The goal was use the native OAuth login instead of an API key, in order to use the codex sub, without resorting to a hacky and risky sub2api method.

OpenAI's supported Codex CLI flow is to run `codex` and choose **Sign in with ChatGPT**. I already had that working. The missing piece was making Deepseek's Harness understand that the login lived in a local OAuth credential store, not in an `OPENAI_API_KEY` environment variable.

The setup looked like it should be one provider entry. It wasn't.

### The first attempt

In the Deepseek Harness settings, I added `openai-codex` as a provider and left the API key blank on purpose. I then made it the default model route:

```yaml
llm-pi-ai:
  providers:
    openai-codex: {}

agent-default-model:
  provider: openai-codex
  model: gpt-5.6-sol
```

The UI accepted the configuration and showed the model. That made it feel configured.

Then the first real prompt failed:

```text
PI_AI_ERROR: Provider is not configured: openai-codex
```

This was an useful error. It told me that model selection and authentication were not the same thing.

The adapter still needed a native OAuth grant in the credential store instead of an api key.

The existing Codex login was in the Codex auth file. Harness uses its own file-backed credentials service under `~/.dsh/`.

The fix was a small, local bridge between the two formats. The important mapping was:

| Existing Codex auth file  | Harness OAuth grant file       |
| --- | --- |
| `tokens.access_token` | `payload.access` |
| `tokens.refresh_token` | `payload.refresh` |
| `tokens.account_id` | `payload.accountId` |
| JWT `exp` claim | `payload.expires` |

The resulting Harness record has this shape, with the actual values intentionally omitted:

```yaml
version: 1

records:
  llm-pi-ai/openai-codex:
    kind: grant
    payload:
      type: oauth
      access: <access token>
      refresh: <refresh token>
      expires: <expiry in milliseconds>
      accountId: <ChatGPT account id>
```

Just FYI, a generic OpenAI API-key record is not interchangeable with this OAuth grant. All I needed to do was create a new chat session and try out a new chat, I was able to get response from OpenAI and it was able to correctly recognize Deepseek Harness too (not against ToS as of 24 Aug 2026).

### To Summarize

The working setup is four separate pieces:

- Select `openai-codex` as the native provider adapter.
- Update `~/.dsh/.credentials.yaml` with Open AI credentials

Once these pieces were connected, the local Deepseek Harness UI could use the same OAuth-backed route for the parent and its subagents.
