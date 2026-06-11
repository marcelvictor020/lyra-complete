# 🚀 CODEX - PROJECT READY TO BUILD

## Status
✅ All files are now properly in `/mnt/user-data/outputs/`
✅ Ready to download and integrate
✅ API key needs to be updated (old one leaked)

## What's Ready

**Core Files:**
- `package.json` - Dependencies
- `lyra.html` - Beautiful UI (your design, Marcel)
- `app.js` - Frontend integration layer
- `src/` - All backend modules:
  - `wallet.js` - Read Mantle balances
  - `prices.js` - CoinGecko price fetching
  - `ai.js` - Claude API integration
  - `portfolio.js` - Portfolio context builder
  - `config.js` - Contract addresses & ABIs
  - `index.js` - Demo app
  - `test-*.js` - Test files
  - `protocols/lendle.js` - Lendle reader

**Video:**
- `hf_20260503_154626_8ee11481-de33-4de5-a830-c5cb29cd6637.mp4` - Hero background

**Setup:**
- `SETUP.bat` - Auto-install script for Windows
- `.env.example` - Environment template

## What Needs to Happen Now

### 1. API Key Situation
**OLD KEY IS COMPROMISED** - do not use
- Marcel will get NEW key from https://console.anthropic.com
- Will provide it to you
- Add to .env file

### 2. Your Tasks (High Priority)

#### A. Fix Video Playback
- Video currently shows black (browser security issue)
- Need HTTP server to serve it
- Update SETUP.bat or add server startup script
- Verify video plays when served via HTTP

#### B. Wire Up Chat
- HTML has chat input: `#chat-input`
- HTML has send button: `#send-chat-btn`
- Connect to: `app.js` → `aiBrain.chat()`
- Make it actually send messages to Claude and display responses

#### C. Wire Up Wallet Connection
- HTML has wallet buttons with "Connect Wallet" text
- Connect to MetaMask via window.ethereum
- Store user address
- Fetch real balances from Mantle RPC

#### D. Display Real Portfolio Data
- Fetch from: `wallet.getAllBalances()`
- Display in portfolio panels
- Show real prices from CoinGecko
- Calculate real portfolio value in USD

#### E. Connect Everything End-to-End
- User connects wallet
- Portfolio loads with real data
- Chat asks Claude about portfolio
- Claude responds with actual portfolio context

### 3. Testing
- Test each module independently first
- Then test full flow:
  1. Open HTML
  2. Click "Start"
  3. Connect wallet
  4. Ask Claude something
  5. See real response based on real portfolio

### 4. Deliverable
- Working HTML file that:
  - ✅ Shows landing with animated video
  - ✅ Loads app interface
  - ✅ Connects wallet
  - ✅ Displays real portfolio
  - ✅ Chats with Claude using real portfolio context
  - ✅ No broken links, no "undefined" errors

## Files Structure (What Marcel Will Have)

```
C:\LYRA\
├── package.json
├── app.js
├── lyra.html
├── hf_20260503_154626_8ee11481-de33-4de5-a830-c5cb29cd6637.mp4
├── .env (with NEW API key)
├── SETUP.bat (or npm run dev)
└── src/
    └── (all backend modules)
```

## Current Issues to Fix

1. **Video Black Screen** - Browser security, needs HTTP
2. **Chat Doesn't Work** - Event listeners not wired
3. **Wallet Not Connected** - MetaMask integration missing
4. **Portfolio Empty** - No data fetching happening

## The Stack You're Working With

- **Frontend:** HTML + vanilla JS (no React, no frameworks)
- **Backend:** Node.js modules (ethers.js, axios, Anthropic SDK)
- **Data Sources:** 
  - Mantle RPC (free, for balances)
  - CoinGecko API (free, for prices)
  - Claude API (costs $, but they have free test credits)
- **Blockchain:** Mantle Network (mainnet for display, testnet for execution)

## Key Integration Points

### app.js needs:
```javascript
- connectWallet() → window.ethereum
- sendMessage() → aiBrain.chat()
- fetchPortfolio() → wallet.getAllBalances()
- displayPortfolio() → update HTML
- showPanel() → already works
```

### HTML provides:
```
- #hero-start-btn → enterApp()
- #chat-input → sendMessage()
- #send-chat-btn → sendMessage()
- .nav-item → showPanel()
- Various display areas for portfolio data
```

### Backend provides:
```
- wallet.getAllBalances(address)
- priceFetcher.calculatePortfolioValue(balances)
- aiBrain.chat(message, portfolioSnapshot)
- Everything is already built, just needs wiring
```

## Success Criteria

✅ Video plays as background
✅ Chat input sends messages
✅ Claude responds with real context
✅ Wallet connects to MetaMask
✅ Portfolio shows real data
✅ Everything works end-to-end
✅ No console errors

## API Key When Ready

Marcel will provide new API key in format:
```
sk-ant-xxxxx...
```

Add to `.env`:
```
ANTHROPIC_API_KEY=sk-ant-xxxxx...
MANTLE_RPC_MAINNET=https://rpc.mantle.xyz
NETWORK=mainnet
```

---

## Next Step

1. Acknowledge you have all files
2. Start with video playback (easiest win)
3. Then wire chat
4. Then wire wallet
5. Test end-to-end

Everything else is already built. You're just connecting the dots. 💪

---

**Marcel's Status:**
- On Windows (Alienware)
- Ready to download everything from `/mnt/user-data/outputs/`
- Getting new API key
- Waiting for you to make it work

**Codex: Make it work.** 🚀

