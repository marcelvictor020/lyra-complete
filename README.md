# LYRA

LYRA is a Mantle-focused DeFi intelligence and execution agent. It helps users understand live opportunities on Mantle, compare routes with source-backed context, and prepare supported actions like bridge, swap, and send from a single conversational interface.

## What LYRA does

- Surfaces live Mantle opportunities with APY, TVL, route quality, and protocol links
- Explains wallet context and Mantle positioning in plain language
- Supports execution prep flows for bridge, swap, and send
- Keeps research, execution context, and decision support inside one interface

## Core product areas

### Ask LYRA

The main agent experience. Users can ask for:

- top Mantle opportunities right now
- defensive comparisons such as mETH vs USDY
- wallet-aware next-step guidance
- supported bridge, swap, and send flows

### Live Opportunities

A Mantle opportunity board that ranks visible routes using source-backed signals:

- APY annualized, not monthly
- TVL durability
- route clarity
- action readiness
- protocol and docs links

### Action Mode

LYRA can prepare supported transaction flows directly in the product UI so the user can review details and sign in-wallet.

## Stack

- Frontend: HTML, CSS, JavaScript
- Backend: Node.js
- Storage: SQLite
- Deployment target: Vercel

## Local run

```bash
npm install
npm start
```

Then open `http://127.0.0.1:3000/lyra.html`.

## Vision

Smart contracts may be deployed, but users still need a way to understand what to do next. LYRA gives Mantle users a clearer layer between raw onchain data and real action by turning wallet context, protocol signals, and execution support into one usable AI agent experience.
