# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

Developers and product teams building production agent-native applications. They need people and AI agents to work through the same meaningful application capabilities and state.

## Product Purpose

Agent-Native is a framework for building applications where the user interface and AI agent are equal partners. It helps teams start from working, customizable applications and evolve them into product-specific workflows. Success means users and agents can complete the same work through shared capabilities and state.

## Positioning

Application operations are defined once as shared actions and exposed across UI, agent, HTTP, MCP, A2A, and CLI surfaces. The agent is part of the application contract rather than a separate assistant layered on top.

## Operating Context

Developers work in a TypeScript monorepo with reusable packages, first-party application templates, a CLI scaffolder, web deployments, and desktop and mobile shells. They build SQL-backed workflows through agent chat and customize the framework's templates for their products.

## Capabilities and Constraints

- Shared actions are the source of truth across UI, agent, HTTP, MCP, A2A, and CLI surfaces.
- Application state is SQL-backed, with backend-agnostic hosting as a core constraint.
- Agent chat is the entry point for AI work.
- First-party templates are customizable and open source.
- The product spans web, desktop, and mobile surfaces under one adaptive framework.

## Brand Commitments

- The product name is Agent-Native.

## Evidence on Hand

- The root README documents the framework promise, shared action model, agent runtime, backend-agnostic database support, toolkits, templates, and quick start: `README.md`.
- The reusable framework package and CLI live under `packages/core`.
- First-party application templates live under `templates/`.
- Framework development guidance and runnable surfaces are documented in `DEVELOPMENT.md`.

## Product Principles

- UI and agents are equal product surfaces.
- Define capabilities once and make them reusable everywhere.
- Keep application state and operations shared and inspectable.
- Preserve the product contract across supported backends and device surfaces.
- Start from working applications and let teams customize them into focused products.
