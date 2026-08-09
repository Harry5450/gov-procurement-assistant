# AGENTS.md

## Product goal
Build a privacy-first, local-first procurement document assistant for Taiwan public-sector procurement workflows.

## Non-negotiable architecture rules
1. Never send a full `ProcurementCase` to an external LLM.
2. All external AI calls MUST pass through the privacy gateway.
3. `RESTRICTED` fields MUST never leave the client.
4. `SENSITIVE` cases default to no external AI.
5. PCC official templates are immutable once versioned.
6. A newly detected PCC template version must be `candidate` until reviewed.
7. `ProcurementCase` is the single source of truth for shared document fields.
8. Procurement/business rules belong in deterministic TypeScript modules, not prompts.
9. AI output is advisory/generated content until a human explicitly accepts it.
10. Every generated procurement document must eventually record its template id/version.

## Development priorities
1. Data correctness and cross-document consistency.
2. Privacy boundary and DLP enforcement.
3. Official template provenance/versioning.
4. Simple workflow for non-procurement specialists.
5. Mobile-friendly UI.
6. AI features only after deterministic workflows are reliable.

## MVP scope
Focus on an ordinary service procurement happy path first. Do not expand into complex construction, special tender exceptions, or automatic legal conclusions without explicit project scope.

## Coding conventions
- TypeScript strict mode.
- Small pure functions for rules.
- Avoid hidden side effects in validation.
- No API keys in frontend code or repository.
- No sensitive sample procurement data in fixtures/tests.
- Prefer local deterministic processing over LLM calls whenever feasible.
