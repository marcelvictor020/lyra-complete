# LYRA

## Live Demo

**Website:** [https://lyra-complete.vercel.app](https://lyra-complete.vercel.app)

LYRA is a Mantle-focused DeFi intelligence and execution agent. It combines live opportunity scanning, wallet-aware reasoning, and supported action flows inside one AI-native interface.

## What Problem LYRA Solves

Most DeFi users still move across too many disconnected tools before they can make a decision:

- dashboards show numbers but not clear action
- chat tools explain ideas but cannot prepare real execution
- protocol pages help after the user already knows where to go
- wallet activity is scattered across explorers and analytics tools

LYRA closes that gap by turning Mantle wallet context, live route intelligence, and action support into one product flow.

## What LYRA Does

- Ranks visible Mantle opportunities using source-backed signals
- Explains why a route is attractive, what risk posture it fits, and whether it is Mantle-native or simply available on Mantle
- Lets users ask plain-language questions instead of reading fragmented raw data
- Prepares supported bridge, swap, and send flows directly in the product
- Keeps research and action in the same experience

## Core Product Surfaces

### Ask LYRA

The main conversational surface for Mantle intelligence and action support.

Users can ask LYRA to:

- show the strongest Mantle opportunities right now
- compare defensive allocations such as mETH vs USDY
- explain what a wallet should do next
- prepare supported bridge, swap, and send flows

### Live Opportunities

A live Mantle opportunity board that scores visible routes using:

- APY annualized, not monthly
- TVL durability
- route clarity
- protocol context
- action readiness
- source and docs links

### Action Mode

LYRA prepares supported transactions inside the interface so the user can review details and sign in-wallet without leaving the product flow.

## Demo Flow

The fastest way to understand LYRA is:

1. Open the live site: [https://lyra-complete.vercel.app](https://lyra-complete.vercel.app)
2. Connect a wallet
3. Open `Ask LYRA`
4. Try one of the built-in prompts
5. Open `Live Opportunities`
6. Review the ranked Mantle routes and protocol links

## Suggested Prompts

Reviewers can try:

- `Show me the strongest Mantle opportunities right now.`
- `Compare mETH and USDY as a defensive allocation on Mantle.`
- `Turn my current wallet into a 2-step Mantle strategy.`
- `Bridge 0.01 ETH to Mantle Sepolia.`
- `Swap 1 MNT into ETH on Mantle.`
- `Send MNT to a wallet.`

## Why This Matters

LYRA is not just a dashboard and not just a chatbot.

It is built as an agent layer for Mantle users:

- research first
- explain clearly
- prepare the next action
- keep the user inside one decision flow

## Stack

- Frontend: HTML, CSS, JavaScript
- Backend: Node.js
- Storage: SQLite with serverless-safe fallback handling
- Deployment: Vercel

## Local Run

```bash
npm install
npm start
```

Then open:

`http://127.0.0.1:3000/lyra.html`

## Repository Notes

- This repo is focused on LYRA only
- The live production site is linked at the top of this README
- The GitHub repo is intended to help reviewers quickly understand the product and open the deployed app without needing a local setup
