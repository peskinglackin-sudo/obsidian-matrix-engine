# Obsidian UI Guidelines

This layer covers native Obsidian views, settings, status surfaces, interaction
state, safe preview, accessibility, and localization for Matrix Engine
(`matrix-engine`, Chinese display name `矩阵引擎`).

## Evidence status

The repository currently has no product UI source or tests. `prd.md` sections
18–19, 21, 23, and 24 define the reviewed UI contract. These guides document
that contract and explicitly mark choices that the first UI implementation
must prove with source paths and tests.

## Guides

| Guide | Use it when |
|---|---|
| [Directory and ownership](./directory-structure.md) | Adding views, UI services, resources, or UI tests |
| [View and component patterns](./component-guidelines.md) | Rendering views, results, settings, status, or preview |
| [Subscriptions and async effects](./hook-guidelines.md) | Managing listeners, debounce, cancellation, or cleanup |
| [State management](./state-management.md) | Deciding local, shared, persisted, or derived state |
| [Type safety and boundary validation](./type-safety.md) | Handling settings, service results, DOM events, or i18n |
| [UI quality](./quality-guidelines.md) | Reviewing accessibility, safety, performance, and tests |

## Pre-development checklist

1. Read `prd.md` sections 18–21 and the relevant guide(s) above.
2. Read `../backend/error-handling.md` and
   `../backend/logging-guidelines.md` for any async or diagnostic UI.
3. Confirm whether the requested surface is MVP, P1, or P2.
4. Map loading, empty, degraded, cancelled, failed, and stale-request states.
5. Map keyboard, focus, i18n, RTL text, theme, and safe-preview behavior.
6. After the first UI source exists, update these guides with real source and
   test paths rather than treating the bootstrap examples as implementation.

## Framework boundary

The MVP/P1 dependency contract explicitly excludes React, Vue, and Svelte
(`prd.md` section 23.3). Use Obsidian APIs and DOM primitives unless a later
reviewed PRD changes that decision.
