class LYRAApp {
  constructor() {
    this.defaultAvatarSrc = './glass-user-icon.jpg';
    this.lyraAvatarSrc = './lyra-logo-robot.png';
    this.autoReconnect = Boolean(window.LYRA_AUTO_RECONNECT);
    this.userAddress = null;
    this.currentSnapshot = null;
    this.currentWalletAnalysis = null;
    this.walletProviderName = null;
    this.activeProvider = null;
    this.providerListeners = null;
    this.walletModal = null;
    this.walletModalReady = null;
    this.walletAccountUnsubscribe = null;
    this.walletConnectRequested = false;
    this.enterAfterConnectRequested = false;
    this.walletModalOpening = false;
    this.pendingOpenProfileAfterWallet = false;
    this.heroCanEnter = false;
    this.googleProfile = null;
    this.googleTokenClient = null;
    this.profileState = this.loadProfileState();
    this.resumeAddress = window.localStorage.getItem('lyraLastWalletAddress') || '';
    this.heroVideo = document.getElementById('hero-video');
    this.heroLoopTimeout = null;
    this.heroHoldActive = false;
    this.heroLoopSeeking = false;
    this.heroPausedForLanding = false;
    this.heroLoopStartTime = 0.52;
    this.navItems = Array.from(document.querySelectorAll('.nav-item'));
    this.panels = Array.from(document.querySelectorAll('.panel'));
    this.heroStartBtn = document.getElementById('hero-start-btn');
    this.backBtn = document.getElementById('back-btn');
    this.navAvatarBtn = document.getElementById('nav-avatar-btn');
    this.navLoginBtn = document.getElementById('nav-login-btn');
    this.navLoginAvatar = document.getElementById('nav-login-avatar');
    this.navLoginLabel = document.getElementById('nav-login-label');
    this.loginOverlay = document.getElementById('login-overlay');
    this.loginWalletBtn = document.getElementById('login-wallet-btn');
    this.loginGoogleBtn = document.getElementById('login-google-btn');
    this.loginCloseBtn = document.getElementById('login-close-btn');
    this.loginWalletState = document.getElementById('login-wallet-state');
    this.loginWalletAddress = document.getElementById('login-wallet-address');
    this.loginWalletChoices = document.getElementById('login-wallet-choices');
    this.loginWalletChoiceList = document.getElementById('login-wallet-choice-list');
    this.loginWalletChoiceStatus = document.getElementById('login-wallet-choice-status');
    this.walletChoiceBackBtn = document.getElementById('wallet-choice-back-btn');
    this.switchWalletBtn = document.getElementById('switch-wallet-btn');
    this.disconnectWalletBtn = document.getElementById('disconnect-wallet-btn');
    this.profileOverlay = document.getElementById('profile-overlay');
    this.profileCloseBtn = document.getElementById('profile-close-btn');
    this.profileNameInput = document.getElementById('profile-name-input');
    this.profileEmailValue = document.getElementById('profile-email-value');
    this.profileWalletValue = document.getElementById('profile-wallet-value');
    this.profileAvatarPreview = document.getElementById('profile-avatar-preview');
    this.profileAvatarInput = document.getElementById('profile-avatar-input');
    this.profileSaveBtn = document.getElementById('profile-save-btn');
    this.profileConnectWalletBtn = document.getElementById('profile-connect-wallet-btn');
    this.profileRemoveWalletBtn = document.getElementById('profile-remove-wallet-btn');
    this.profileConnectGoogleBtn = document.getElementById('profile-connect-google-btn');
    this.profileRemoveGoogleBtn = document.getElementById('profile-remove-google-btn');
    this.profileLogoutBtn = document.getElementById('profile-logout-btn');
    this.chatInput = document.getElementById('chat-input');
    this.sendChatBtn = document.getElementById('send-chat-btn');
    this.chatImageInput = document.getElementById('chat-image-input');
    this.chatAttachBtn = document.getElementById('chat-attach-btn');
    this.chatThread = document.getElementById('chat-thread');
    this.pendingChatImage = null;
    this.strategyLabRoot = document.querySelector('[data-strategy-lab]');
    this.strategyLabState = this.getInitialStrategyLabState();
    this.scanTimer = null;
    this.scanStepIndex = 0;
    this.scanRequest = null;

    this.bindEvents();
    this.setHeaderTime();
    this.seedChat();
    this.setupHeroVideoLoop();
    this.walletModalReady = this.initWalletModal();
    this.loadMarketTape();
    this.marketTapeInterval = window.setInterval(() => this.loadMarketTape(), 60_000);
    this.updateWalletDisplays();
    this.syncProfilePanel();
    try {
      this.renderStrategyLabState();
    } catch (error) {
      console.error('LYRA Strategy Lab init failed', error);
    }
    document.body.classList.add('entry-locked');
  }

  bindEvents() {
    if (this.backBtn) this.backBtn.addEventListener('click', () => this.exitApp());
    if (this.navLoginBtn) this.navLoginBtn.addEventListener('click', () => this.openLoginEntry());
    if (this.loginWalletBtn) this.loginWalletBtn.addEventListener('click', async () => this.startWalletSelectionFromLogin());
    if (this.loginGoogleBtn) this.loginGoogleBtn.addEventListener('click', async () => this.startGoogleLogin());
    if (this.loginCloseBtn) this.loginCloseBtn.addEventListener('click', () => this.closeLogin());
    if (this.walletChoiceBackBtn) this.walletChoiceBackBtn.addEventListener('click', () => this.closeWalletChooser());
    if (this.switchWalletBtn) this.switchWalletBtn.addEventListener('click', async () => this.startFreshWalletFlow());
    if (this.disconnectWalletBtn) this.disconnectWalletBtn.addEventListener('click', async () => this.disconnectWallet());
    if (this.loginOverlay) {
      this.loginOverlay.addEventListener('click', (event) => {
        if (event.target === this.loginOverlay) this.closeLogin();
      });
    }
    if (this.profileAvatarInput) {
      this.profileAvatarInput.addEventListener('change', (event) => this.handleAvatarUpload(event));
    }
    if (this.profileNameInput) {
      this.profileNameInput.addEventListener('input', () => {
        this.profileState.preferredName = this.profileNameInput.value.trim();
        this.markProfileDirty();
        this.updateWalletDisplays();
        this.syncProfilePanel();
      });
    }
    if (this.profileSaveBtn) this.profileSaveBtn.addEventListener('click', () => this.saveProfileStateFromInputs());
    if (this.profileOverlay) {
      this.profileOverlay.addEventListener('click', (event) => {
        if (event.target === this.profileOverlay) this.closeProfile();
      });
    }

    this.navItems.forEach((item) => {
      item.addEventListener('click', () => this.showPanel(item.dataset.panel));
    });

    document.querySelectorAll('[data-wallet-action="connect"]').forEach((btn) => {
      if (btn === this.heroStartBtn) return;
      btn.addEventListener('click', () => this.openLoginEntry());
    });
    if (this.chatThread) {
      this.chatThread.addEventListener('click', (event) => {
        const starter = event.target.closest('[data-starter-prompt]');
        if (starter) {
          this.handleStarterPrompt(starter.dataset.starterPrompt || starter.textContent.trim());
          return;
        }
        const action = event.target.closest('[data-lyra-action]');
        if (action) {
          this.handleLyraAction(action.dataset.lyraAction || '', action);
          return;
        }
      });
      this.chatThread.addEventListener('submit', (event) => {
        const form = event.target.closest('[data-execution-form]');
        if (!form) return;
        event.preventDefault();
        this.submitExecutionForm(form);
      });
      this.chatThread.addEventListener('change', (event) => {
        const field = event.target.closest('.lyra-exec-select');
        const form = event.target.closest('[data-execution-form]');
        if (!field || !form) return;
        this.handleExecutionFormChange(form, field);
      });
    }

    if (this.sendChatBtn) this.sendChatBtn.addEventListener('click', () => this.sendMessage());
    if (this.chatAttachBtn) this.chatAttachBtn.addEventListener('click', () => this.chatImageInput?.click());
    if (this.chatImageInput) {
      this.chatImageInput.addEventListener('change', (event) => this.handleChatImageSelected(event));
    }
    if (this.chatInput) {
      this.chatInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          this.sendMessage();
        }
      });
    }

    if (this.strategyLabRoot) {
      this.strategyLabRoot.addEventListener('click', (event) => {
        const refreshBtn = event.target.closest('[data-strategy-generate], [data-opportunity-refresh]');
        if (refreshBtn) {
          this.generateStrategyLabResult(true).catch((error) => {
            console.error('LYRA opportunities refresh failed', error);
            this.setSurfaceStatus('Live Opportunities could not refresh right now.');
          });
          return;
        }

        const promptBtn = event.target.closest('[data-opportunity-prompt]');
        if (promptBtn) {
          const prompt = promptBtn.dataset.opportunityPrompt || '';
          if (prompt) {
            this.showPanel('overview');
            this.handleStarterPrompt(prompt);
          }
          return;
        }

        const actionBtn = event.target.closest('[data-opportunity-action]');
        if (actionBtn) {
          const action = actionBtn.dataset.opportunityAction || '';
          if (action) {
            this.showPanel('overview');
            this.handleLyraAction(action, actionBtn);
          }
        }
      });
    }
  }

  renderMarketTape(items = []) {
    const track = document.getElementById('market-tape-track');
    this.marketTapeItems = items;
    if (!track || !items.length) return;

    const repeated = [...items, ...items, ...items];
    track.innerHTML = repeated.map((item) => {
      const tone = item.tone || 'neutral';
      return `<span class="tape-item ${tone}"><span class="tape-dot"></span>${item.label}</span>`;
    }).join('');
  }

  normalizeOpportunitySignals(items = []) {
    const allowedSignals = [
      'Mantle TVL',
      'Top Stable APY',
      'Top Lending APY',
      'Top LP APY',
      'Merchant Moe Liquidity',
      'Aave V3 TVL',
      'Clearpool Pool Size',
      'New Opportunity Detected'
    ];

    const normalized = [];
    const seen = new Set();

    (items || []).forEach((item) => {
      const title = String(item?.title || '').trim();
      const label = String(item?.label || '').trim();
      const matched = allowedSignals.find((signal) =>
        title.toLowerCase() === signal.toLowerCase() || label.toLowerCase().includes(signal.toLowerCase())
      );
      if (!matched || seen.has(matched)) return;
      seen.add(matched);
      normalized.push({
        label: matched,
        tone: item?.tone || 'neutral',
        value: item?.value || '',
        detail: item?.detail || label.replace(new RegExp(`^${matched}\\s*`, 'i'), '').trim()
      });
    });

    allowedSignals.forEach((label, index) => {
      if (seen.has(label) || normalized.length >= 6) return;
      normalized.push({
        label,
        tone: index === 0 ? 'positive' : 'neutral',
        value: '--',
        detail: 'Signal syncing'
      });
    });

    return normalized.slice(0, 6);
  }

  async loadMarketTape() {
    try {
      const response = await fetch('/api/market-tape');
      const data = await response.json();
      if (data?.items?.length) {
        this.renderMarketTape(data.items);
      }
    } catch {
      this.renderMarketTape([
        { label: 'Mantle TVL', tone: 'positive' },
        { label: 'Top Stable APY', tone: 'neutral' },
        { label: 'Top Lending APY', tone: 'neutral' },
        { label: 'Top LP APY', tone: 'neutral' },
        { label: 'Merchant Moe Liquidity', tone: 'neutral' },
        { label: 'Aave V3 TVL', tone: 'neutral' }
      ]);
    }
  }

  loadProfileState() {
    try {
      const raw = window.localStorage.getItem('lyraProfileState');
      const state = raw ? JSON.parse(raw) : { preferredName: '', avatarDataUrl: '' };
      return state;
    } catch {
      return { preferredName: '', avatarDataUrl: '' };
    }
  }

  persistProfileState() {
    window.localStorage.setItem('lyraProfileState', JSON.stringify(this.profileState));
  }

  async initWalletModal() {
    const projectId = window.LYRA_REOWN_PROJECT_ID;
    if (!projectId) {
      this.pushSystemMessage?.('Wallet modal is not configured. Missing Reown project ID.');
      return null;
    }

    try {
      const metadata = {
        name: 'LYRA',
        description: 'LYRA autonomous Mantle intelligence agent',
        url: window.location.origin,
        icons: [`${window.location.origin}/lyra-favicon-circle.png`]
      };
      const { createLyraWalletModal } = await import('./wallet-modal-bundle.js');

      this.walletModal = createLyraWalletModal({
        projectId,
        metadata,
        themeVariables: {
          '--w3m-accent': '#14e6a4',
          '--w3m-color-mix': '#081017',
          '--w3m-color-mix-strength': 28,
          '--w3m-border-radius-master': '18px',
          '--w3m-font-family': 'Space Grotesk, sans-serif'
        }
      });

      this.walletAccountUnsubscribe = this.walletModal.subscribeAccount((accountState) => {
        this.handleWalletModalAccountState(accountState);
      }, 'eip155');

      return this.walletModal;
    } catch (error) {
      console.error('LYRA wallet modal init failed', error);
      this.walletModal = null;
      return null;
    }
  }

  async openWalletModal(options = {}) {
    if (this.walletModalOpening) {
      if (this.loginWalletChoiceStatus) {
        this.loginWalletChoiceStatus.textContent = 'Wallet request already open. Approve or close it in your wallet first.';
      }
      return;
    }

    this.walletModalOpening = true;
    const shouldOpenProfileAfterWallet = Boolean(options.openProfile);
    this.walletConnectRequested = true;
    this.enterAfterConnectRequested = true;
    this.pendingOpenProfileAfterWallet = shouldOpenProfileAfterWallet;
    const shouldResetSession = Boolean(this.userAddress || this.walletModal?.getIsConnectedState?.());
    if (shouldResetSession) {
      await this.resetWalletSessionForReconnect();
    } else {
      this.clearWalletConnectionStorage();
      this.currentSnapshot = null;
      this.currentWalletAnalysis = null;
      if (this.chatThread) this.chatThread.dataset.briefRendered = 'false';
    }
    this.walletConnectRequested = true;
    this.enterAfterConnectRequested = true;
    this.pendingOpenProfileAfterWallet = shouldOpenProfileAfterWallet;
    this.closeProfile();

    let modal = null;
    try {
      modal = await this.walletModalReady;
    } catch (error) {
      console.error('LYRA wallet modal load failed', error);
    }
    if (!modal) {
      this.walletModalOpening = false;
      this.openLogin();
      if (this.loginWalletChoiceStatus) {
        this.loginWalletChoiceStatus.textContent = 'Wallet modal failed to load. Choose an injected wallet below.';
      }
      this.openWalletChooser(options);
      this.pushSystemMessage('Wallet modal could not load. Falling back to injected wallet connection.');
      return;
    }

    try {
      if (this.loginWalletChoiceStatus) {
        this.loginWalletChoiceStatus.textContent = 'Choose a wallet in the modal, then approve the request in your wallet.';
      }
      if (typeof modal.close === 'function') {
        try {
          await modal.close();
        } catch (_) {}
      }
      await this.sleep(40);
      this.closeLogin();
      await modal.open({
        view: 'Connect',
        namespace: 'eip155'
      });
      this.walletModalOpening = false;
    } catch (error) {
      this.walletConnectRequested = false;
      this.enterAfterConnectRequested = false;
      this.pendingOpenProfileAfterWallet = false;
      this.walletModalOpening = false;
      this.openLogin();
      if (this.loginWalletChoiceStatus) {
        this.loginWalletChoiceStatus.textContent = 'Could not open wallet modal. Choose an injected wallet below.';
      }
      this.openWalletChooser(options);
      this.pushSystemMessage(`Could not open wallet modal: ${error.message}`);
    }
  }

  async handleWalletModalAccountState(accountState) {
    const isConnected = Boolean(accountState?.isConnected);
    const address = accountState?.address || null;
    const modalError = accountState?.error;
    const normalizedCurrentAddress = this.userAddress ? String(this.userAddress).toLowerCase() : '';
    const normalizedNextAddress = address ? String(address).toLowerCase() : '';

    if (modalError) {
      this.walletModalOpening = false;
      if (this.loginWalletChoiceStatus) {
        this.loginWalletChoiceStatus.textContent = `Wallet connection failed: ${modalError.message || modalError}`;
      }
    }

    if (!isConnected || !address) {
      if (this.enterAfterConnectRequested && !this.userAddress && !modalError) {
        return;
      }
      if (!this.walletConnectRequested && !this.userAddress) return;
      if (this.userAddress) {
        await this.disconnectWallet({ silent: true, skipProviderRevoke: true });
      }
      this.walletConnectRequested = false;
      this.enterAfterConnectRequested = false;
      this.walletModalOpening = false;
      this.pendingOpenProfileAfterWallet = false;
      return;
    }

    if (!this.walletConnectRequested && !this.userAddress && !this.pendingOpenProfileAfterWallet) {
      this.walletModalOpening = false;
      return;
    }

    if (!this.walletConnectRequested && normalizedCurrentAddress && normalizedCurrentAddress === normalizedNextAddress && !this.pendingOpenProfileAfterWallet) {
      this.resumeAddress = address;
      this.heroCanEnter = true;
      this.walletProviderName = this.walletModal?.getWalletProviderType?.() || this.walletProviderName || 'Wallet';
      this.activeProvider = this.walletModal?.getWalletProvider?.() || this.activeProvider || null;
      this.walletModalOpening = false;
      this.closeWalletChooser();
      this.closeLogin();
      this.updateWalletDisplays();
      return;
    }

    const shouldEnterApp = this.enterAfterConnectRequested;

    this.userAddress = address;
    this.resumeAddress = address;
    window.localStorage.setItem('lyraLastWalletAddress', address);
    this.walletProviderName = this.walletModal?.getWalletProviderType?.() || 'Wallet';
    this.activeProvider = this.walletModal?.getWalletProvider?.() || null;
    if (this.chatThread) this.chatThread.dataset.briefRendered = 'false';
    this.currentSnapshot = null;
    this.currentWalletAnalysis = null;
    this.closeWalletChooser();
    this.closeLogin();
    this.showPanel('overview');
    this.setSurfaceStatus('Wallet connected. Loading wallet context...');
    if (shouldEnterApp) {
      this.heroCanEnter = true;
      this.enterApp();
    } else {
      this.exitApp();
    }
    this.updateWalletDisplays();
    this.seedChat();
    this.resetPortfolioView();
    this.fetchPortfolio().then(() => {
      this.setSurfaceStatus('Wallet intelligence ready.');
    }).catch(() => {});
    this.runWalletScan({ silent: true }).catch(() => {});

    if (this.pendingOpenProfileAfterWallet) {
      this.openProfile();
    }

    this.walletConnectRequested = false;
    this.enterAfterConnectRequested = false;
    this.walletModalOpening = false;
    this.pendingOpenProfileAfterWallet = false;
  }

  enterApp() {
    document.body.classList.remove('entry-locked');
    document.body.classList.add('app-entered');
    document.getElementById('app')?.scrollTo({ top: 0, behavior: 'auto' });
  }

  startScanSequence() {
    const app = document.getElementById('app');
    const steps = Array.from(document.querySelectorAll('[data-scan-step]'));
    app?.classList.add('scan-active');
    this.scanStepIndex = 0;
    if (this.scanTimer) window.clearInterval(this.scanTimer);
    const render = () => {
      steps.forEach((step, index) => {
        step.classList.toggle('done', index < this.scanStepIndex);
        step.classList.toggle('active', index === this.scanStepIndex);
      });
      if (this.scanStepIndex < steps.length - 1) {
        this.scanStepIndex += 1;
      }
    };
    render();
    this.scanTimer = window.setInterval(render, 260);
  }

  finishScanSequence() {
    const steps = Array.from(document.querySelectorAll('[data-scan-step]'));
    if (this.scanTimer) window.clearInterval(this.scanTimer);
    this.scanTimer = null;
    steps.forEach((step) => {
      step.classList.add('done');
      step.classList.remove('active');
    });
    window.setTimeout(() => {
      document.getElementById('app')?.classList.remove('scan-active');
    }, 180);
  }

  setAgentAnalyzingState(label = 'Analyzing wallet') {
    const composerHint = document.querySelector('.agent-composer-hint');
    const connectText = document.querySelector('.agent-connect-strip span');
    const intelligenceTitle = document.querySelector('.agent-card h3');
    const intelligenceBody = document.querySelector('.agent-card p');
    if (composerHint) composerHint.textContent = 'Scanning wallet intelligence...';
    if (connectText) connectText.textContent = `${label}: balances, activity, exposure.`;
    if (intelligenceTitle) intelligenceTitle.textContent = 'Analyzing portfolio';
    if (intelligenceBody) intelligenceBody.textContent = 'LYRA is building a wallet intelligence brief from live portfolio context.';
  }

  renderAgentIntelligence(snapshot, mode = 'live') {
    const balances = snapshot?.balances || [];
    const positiveBalances = balances.filter((asset) => Number(asset.value) > 0 || Number(asset.formatted) > 0);
    const totalValue = Number(snapshot?.totalValue || 0);
    const network = snapshot?.summary?.networkLabel || (mode === 'demo' ? 'Demo Portfolio' : 'Mantle');
    const recentActivity = snapshot?.summary?.recentActivity || 'No recent activity';
    const confidence = positiveBalances.length >= 3 ? 'Medium' : 'Low';
    const nextStep = confidence === 'Low'
      ? 'Additional wallet history recommended'
      : (snapshot?.summary?.riskSignal || snapshot?.summary?.nextStep || snapshot?.recommendation?.title || 'Ready for next move');

    const title = document.querySelector('.agent-card h3');
    const body = document.querySelector('.agent-card p');
    const signals = document.querySelectorAll('.agent-signal span:last-child');
    const sideStatus = document.querySelector('.agent-wallet-status');
    const connectText = document.querySelector('.agent-connect-strip span');
    const composerHint = document.querySelector('.agent-composer-hint');
    const intelValue = document.querySelector('[data-intel-value]');
    const intelTop = document.querySelector('[data-intel-top]');
    const intelAssets = document.querySelector('[data-intel-assets]');

    if (title) title.textContent = 'Wallet visibility assessed';
    if (body) body.textContent = totalValue > 0
      ? `Current scan can see ${positiveBalances.length} valued asset${positiveBalances.length === 1 ? '' : 's'} worth about $${totalValue.toFixed(2)} on ${network}. Cross-chain portfolio confidence is ${confidence.toLowerCase()}. ${recentActivity}.`
      : `LYRA connected to ${network}, but visible funded balances are limited. Cross-chain portfolio confidence is low.`;
    if (signals[0]) signals[0].textContent = confidence;
    if (signals[1]) signals[1].textContent = String(snapshot?.summary?.trackedAssets ?? positiveBalances.length);
    if (signals[2]) signals[2].textContent = recentActivity;
    if (signals[3]) signals[3].textContent = nextStep;
    if (intelValue) intelValue.textContent = totalValue > 0 ? `$${totalValue.toFixed(2)}` : '$0.00';
    if (intelTop) intelTop.textContent = confidence;
    if (intelAssets) intelAssets.textContent = String(snapshot?.summary?.trackedAssets ?? positiveBalances.length);
    if (sideStatus) {
      sideStatus.innerHTML = `<strong>${mode === 'demo' ? 'Sample session active' : 'Wallet connected'}</strong>${mode === 'demo' ? 'Sample portfolio loaded.' : this.userAddress ? `${this.userAddress.slice(0, 6)}...${this.userAddress.slice(-4)}` : 'Ready.'}`;
    }
    if (connectText) connectText.textContent = `Visibility confidence: ${confidence}. Ask LYRA to deepen the analysis.`;
    if (composerHint) composerHint.textContent = 'Wallet context loaded with visible-scope limits.';
    this.showWalletBriefMessage(snapshot, positiveBalances, totalValue);
  }

  showWalletBriefMessage(snapshot, balances, totalValue) {
    if (!this.chatThread || this.chatThread.dataset.briefRendered === 'true') return;

    const confidence = balances.length >= 3 ? 'Medium' : 'Low';
    const trackedAssets = snapshot?.summary?.trackedAssets ?? balances.length;
    const recentActivity = snapshot?.summary?.recentActivity || '--';
    const compactActivity = recentActivity.length > 34 ? `${recentActivity.slice(0, 31)}...` : recentActivity;
    const riskSignal = confidence === 'Low' ? 'Insufficient evidence' : (snapshot?.summary?.riskSignal || 'Pending review');
    const nextMove = confidence === 'Low'
      ? 'Run deeper wallet analysis before trusting a route.'
      : (snapshot?.summary?.nextStep || snapshot?.recommendation?.title || 'Ask LYRA for a recommendation');
    const limitNote = confidence === 'Low'
      ? 'Current scan visibility is limited. LYRA will avoid full-portfolio claims until more wallet history is visible.'
      : 'LYRA has enough visible context to explain directional risk and possible next moves.';
    const topAssets = balances.slice(0, 3).map((asset) => {
      const value = Number(asset.value || 0);
      return `${asset.symbol} $${value.toFixed(value >= 1 ? 2 : 4)}`;
    });
    const interactions = snapshot?.history?.interactions || snapshot?.summary?.topInteractions || [];
    const activityLine = interactions.length
      ? interactions.slice(0, 3).map((item) => `${item.name} (${item.count})`).join(', ')
      : recentActivity;

    this.chatThread.dataset.briefRendered = 'true';
    this.chatThread.innerHTML = `
        <div class="analysis-brief">
          <div class="analysis-brief-head">
            <strong>Wallet intelligence loaded.</strong>
            <span>Live wallet scan</span>
          </div>
        <div class="analysis-grid">
          <div class="analysis-cell"><span>Value</span><strong>$${Number(totalValue || 0).toFixed(2)}</strong></div>
          <div class="analysis-cell"><span>Confidence</span><strong>${confidence}</strong></div>
          <div class="analysis-cell"><span>Assets</span><strong>${trackedAssets}</strong></div>
          <div class="analysis-cell"><span>Activity</span><strong>${compactActivity}</strong></div>
          <div class="analysis-cell"><span>Risk</span><strong>${riskSignal}</strong></div>
          <div class="analysis-cell"><span>Recommendation</span><strong>${nextMove}</strong></div>
        </div>
        <div class="analysis-line">Detected: ${topAssets.length ? topAssets.join(' / ') : 'no funded assets'}.</div>
        <div class="analysis-line">Activity: ${activityLine}.</div>
        <div class="analysis-line">Note: ${limitNote}</div>
      </div>
    `;
  }

  openLoginEntry() {
    if (this.userAddress) {
      this.enterApp();
      this.showPanel('overview');
      this.setSurfaceStatus('Wallet already connected. Ask LYRA to analyze, bridge, swap, or send.');
      return;
    }
    this.openLogin();
  }

  async startWalletSelectionFromLogin(options = {}) {
    this.openLogin();
    await this.openWalletModal(options);
  }

  async startFreshWalletFlow() {
    this.openLogin();
    await this.openWalletModal({ freshStart: true, forceAccountSelection: true });
  }

  openProfileEntry() {
    if (this.googleProfile || this.profileState?.preferredName || this.userAddress) {
      this.enterApp();
      this.openProfile();
      return;
    }
    this.openLogin();
  }

  openAccountEntry() {
    if (this.userAddress && this.heroCanEnter) {
      this.enterApp();
      this.showPanel('overview');
      this.setSurfaceStatus('Wallet already connected. Re-entering Ask LYRA.');
      return;
    }
    this.openLogin();
  }

  openLogin() {
    this.closeWalletChooser();
    this.updateWalletDisplays();
    this.closeProfile();
    this.loginOverlay?.classList.add('open');
  }

  closeLogin() {
    this.loginOverlay?.classList.remove('open');
  }

  openProfile() {
    if (this.profileNameInput) {
      this.profileNameInput.value = this.profileState?.preferredName || this.googleProfile?.given_name || this.googleProfile?.name || '';
    }
    if (this.profileEmailValue) {
      this.profileEmailValue.textContent = this.googleProfile?.email || this.profileState?.googleEmail || 'Connect Google';
    }
    if (this.profileWalletValue) {
      this.profileWalletValue.textContent = this.userAddress
        ? this.userAddress
        : 'No wallet connected';
    }
    this.renderProfileAvatar();
    this.updateProfileActionButtons();
    this.profileOverlay?.classList.add('open');
  }

  closeProfile() {
    this.profileOverlay?.classList.remove('open');
  }

  async connectWalletFromProfile() {
    this.closeProfile();
    this.openLogin();
    await this.openWalletModal({ openProfile: true });
  }

  getInjectedProviders() {
    const ethereum = window.ethereum;
    if (!ethereum) return [];
    if (Array.isArray(ethereum.providers) && ethereum.providers.length) {
      return ethereum.providers;
    }
    return [ethereum];
  }

  getWalletOptionLabel(provider) {
    if (provider?.isMetaMask) return 'MetaMask';
    if (provider?.isRabby) return 'Rabby';
    if (provider?.isZerion) return 'Zerion';
    if (provider?.isPhantom) return 'Phantom';
    return 'Injected Wallet';
  }

  getWalletOptionDescription(provider) {
    if (provider?.isMetaMask) return 'Popular EVM wallet with signing and network switching.';
    if (provider?.isRabby) return 'EVM wallet with explicit transaction and chain routing.';
    if (provider?.isZerion) return 'Wallet extension with portfolio and multi-chain support.';
    if (provider?.isPhantom) return 'Use Phantom in EVM mode to connect and sign.';
    return 'Use the injected wallet available in this browser.';
  }

  getAvailableWalletOptions() {
    const providers = this.getInjectedProviders();
    const seen = new Set();
    return providers.reduce((options, provider, index) => {
      const name = this.getWalletOptionLabel(provider);
      if (seen.has(name)) return options;
      seen.add(name);
      options.push({
        id: `${name.toLowerCase().replace(/\s+/g, '-')}-${index}`,
        name,
        description: this.getWalletOptionDescription(provider),
        provider
      });
      return options;
    }, []);
  }

  renderWalletChoices() {
    if (!this.loginWalletChoiceList) return;
    const options = this.getAvailableWalletOptions();
    this.loginWalletChoiceList.innerHTML = '';

    if (!options.length) {
      this.loginWalletChoiceStatus.textContent = 'No injected wallet found. Install MetaMask, Rabby, Zerion, or Phantom EVM mode.';
      this.loginWalletChoiceList.innerHTML = '<div class="wallet-choice-empty">No wallet extension detected in this browser.</div>';
      return;
    }

    this.loginWalletChoiceStatus.textContent = 'Choose a wallet, then approve the connection and signature request.';
    options.forEach((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wallet-choice';
      button.dataset.walletId = option.id;
      button.innerHTML = `
        <span class="wallet-choice-name">${option.name}</span>
        <span class="wallet-choice-copy">${option.description}</span>
      `;
      button.addEventListener('click', () => this.connectWallet({
        ...this.pendingWalletConnectOptions,
        provider: option.provider,
        providerLabel: option.name
      }));
      this.loginWalletChoiceList.appendChild(button);
    });
  }

  openWalletChooser(options = {}) {
    this.pendingWalletConnectOptions = options;
    this.renderWalletChoices();
    if (this.loginWalletChoiceStatus && options.freshStart) {
      this.loginWalletChoiceStatus.textContent = 'Choose a wallet to start a new connection session.';
    }
    this.loginWalletChoices?.classList.add('open');
  }

  closeWalletChooser() {
    this.pendingWalletConnectOptions = {};
    this.loginWalletChoices?.classList.remove('open');
  }

  renderProfileAvatar() {
    if (!this.profileAvatarPreview) return;
    const avatarDataUrl = this.profileState?.avatarDataUrl;
    const name = this.profileState?.preferredName || this.googleProfile?.given_name || this.googleProfile?.name || 'L';
    if (avatarDataUrl) {
      this.profileAvatarPreview.innerHTML = `<img src="${avatarDataUrl}" alt="Profile avatar">`;
      return;
    }
    this.profileAvatarPreview.innerHTML = `<img src="${this.defaultAvatarSrc}" alt="Default profile avatar">`;
  }

  handleAvatarUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      this.profileState.avatarDataUrl = reader.result;
      this.renderProfileAvatar();
      this.syncProfilePanel();
      this.updateWalletDisplays();
      this.markProfileDirty();
    };
    reader.readAsDataURL(file);
  }

  markProfileDirty() {}

  saveProfileStateFromInputs() {
    if (this.profileNameInput) {
      this.profileState.preferredName = this.profileNameInput.value.trim();
    }
    this.persistProfileState();
    this.updateWalletDisplays();
    this.syncProfilePanel();
    this.updateProfileActionButtons();
    this.closeProfile();
  }

  async startGoogleLogin() {
    if (!window.google?.accounts?.oauth2) {
      this.pushSystemMessage('Google sign-in is still loading. Refresh and try again.');
      return;
    }

    if (!this.googleTokenClient) {
      this.googleTokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: window.LYRA_GOOGLE_CLIENT_ID,
        scope: 'openid email profile',
        callback: async (response) => {
          if (response.error) {
            this.pushSystemMessage(`Google sign-in failed: ${response.error}`);
            return;
          }

          try {
            const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: {
                Authorization: `Bearer ${response.access_token}`
              }
            });

            if (!profileResponse.ok) {
              throw new Error('Could not load Google profile');
            }

            this.googleProfile = await profileResponse.json();
            this.profileState.googleEmail = this.googleProfile.email || '';
            this.persistProfileState();
            this.updateWalletDisplays();
            this.updateProfileActionButtons();
            this.closeLogin();
            this.openProfile();
            this.pushSystemMessage(`Google connected: ${this.googleProfile.name || this.googleProfile.email}`);
          } catch (error) {
            this.pushSystemMessage(`Google sign-in failed: ${error.message}`);
          }
        }
      });
    }

    this.googleTokenClient.requestAccessToken({
      prompt: 'select_account'
    });
  }

  exitApp() {
    document.body.classList.remove('app-entered');
    document.body.classList.add('entry-locked');
    this.resetHeroVideo();
  }

  resetHeroVideo() {
    if (!this.heroVideo) return;

    clearTimeout(this.heroLoopTimeout);
    this.heroHoldActive = false;
    this.heroLoopSeeking = false;
    this.heroPausedForLanding = false;

    try {
      this.heroVideo.pause();
      this.heroVideo.currentTime = this.heroLoopStartTime;
      this.resumeHeroVideoPlayback();
    } catch {
      // If the browser blocks playback momentarily, the video will still be reset.
    }
  }

  resumeHeroVideoPlayback() {
    if (!this.heroVideo) return;

    const attemptPlay = () => {
      this.heroVideo.muted = true;
      if (this.heroVideo.currentTime < this.heroLoopStartTime) {
        this.heroVideo.currentTime = this.heroLoopStartTime;
      }
      const playPromise = this.heroVideo.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          window.setTimeout(() => {
            try {
              this.heroVideo.play().catch(() => {});
            } catch (_) {}
          }, 180);
        });
      }
    };

    if (this.heroVideo.readyState >= 2) {
      attemptPlay();
      return;
    }

    this.heroVideo.addEventListener('canplay', attemptPlay, { once: true });
    try {
      this.heroVideo.load();
    } catch (_) {}
  }

  sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  formatUsdCompact(value) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount) || amount <= 0) return '--';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: amount >= 1000 ? 'compact' : 'standard',
      maximumFractionDigits: amount >= 1000 ? 1 : 2
    }).format(amount);
  }

  formatOpportunitiesCheckedAt(value) {
    if (!value) return 'Unknown';
    return new Date(value).toLocaleString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: 'short'
    });
  }

  getInitialStrategyLabState() {
    return {
      generated: false,
      loading: false,
      data: null,
      error: ''
    };
  }

  getStrategyLabElements() {
    const root = this.strategyLabRoot || document.querySelector('[data-strategy-lab]');
    if (!root) return null;
    return {
      root,
      panelView: root.closest('.console-panel-view'),
      panelCard: root.closest('.console-panel-card'),
      resultCard: root.querySelector('[data-strategy-result-card]'),
      resultTitle: root.querySelector('[data-strategy-result-title]'),
      resultSummary: root.querySelector('[data-strategy-result-summary]'),
      storyboard: root.querySelector('[data-strategy-storyboard]'),
      resultConfidence: root.querySelector('[data-strategy-result-confidence]'),
      resultSources: root.querySelector('[data-strategy-result-sources]'),
    };
  }

  buildStrategyLabPrompt() {
    return 'What are the strongest live opportunities on Mantle right now?';
  }

  buildOpportunityActionMarkup(action) {
    if (!action?.label) return '';
    const label = this.escapeHtml(action.label);
    const variant = action.variant === 'primary' ? 'primary' : 'secondary';
    if (action.type === 'link' && action.url) {
      return `<a class="lyra-chip-link ${variant}" href="${this.escapeHtml(action.url)}" target="_blank" rel="noreferrer">${label}</a>`;
    }
    if (action.type === 'action' && action.action) {
      return `<button class="lyra-chip-link ${variant}" type="button" data-opportunity-action="${this.escapeHtml(action.action)}">${label}</button>`;
    }
    if (action.type === 'prompt' && action.prompt) {
      return `<button class="lyra-chip-link ${variant}" type="button" data-opportunity-prompt="${this.escapeHtml(action.prompt)}">${label}</button>`;
    }
    return '';
  }

  buildLiveSignalRailMarkup() {
    const items = this.normalizeOpportunitySignals(this.marketTapeItems || []).slice(0, 6);
    if (!items.length) {
      return `
        <div class="opportunity-signal-empty">
          <span class="strategy-section-label">Live signals</span>
          <strong>Signal feed syncing</strong>
          <p>Market and ecosystem signals will appear here as the board refreshes.</p>
        </div>
      `;
    }

    return items.map((item, index) => `
      <article class="opportunity-signal-card ${index === 0 ? 'primary' : ''} ${String(item.label || '').toLowerCase() === 'mantle tvl' ? 'value-primary' : ''}">
        <span class="opportunity-signal-dot ${this.escapeHtml(item.tone || 'neutral')}"></span>
        <div class="opportunity-signal-copy">
          <span class="strategy-section-label">${this.escapeHtml(item.label || '')}</span>
          <strong>${this.escapeHtml(item.detail || '')}</strong>
        </div>
        <div class="opportunity-signal-value">
          <span>${this.escapeHtml(item.value || '--')}</span>
        </div>
      </article>
    `).join('');
  }

  buildOpportunityRoutesMarkup(data) {
    if (!data?.cards?.length) {
      return `
        <div class="opportunity-empty-state">
          <strong>No ranked Mantle routes are visible right now.</strong>
          <p>Refresh the board in a moment. LYRA only publishes this board when the live Mantle data is strong enough to support a real recommendation instead of filler.</p>
        </div>
      `;
    }

    const topRoutes = (data.cards || []).slice(0, 4);
    const renderRouteCard = (item, variant = 'primary') => {
      const rank = Number(item.rank || 0);
      const title = this.escapeHtml(item.protocol || 'Unknown route');
      const symbol = this.escapeHtml(item.symbol || '');
      const placement = this.escapeHtml(item.placementLabel || 'Available on Mantle');
      const category = this.escapeHtml(item.category || 'Route');
      const network = this.escapeHtml(item.network || 'Mantle');
      const apy = Number(item.apy || 0).toFixed(2);
      const tvl = this.formatUsdCompact(item.tvlUsd);
      const fit = this.escapeHtml(item.fit || 'Visible route');
      const reason = this.escapeHtml(item.reason || 'This route is visible on the current Mantle board.');
      const riskLevel = this.escapeHtml(item.riskLevel || 'Unknown');
      const riskExplanation = this.escapeHtml(item.riskExplanation || 'Risk context unavailable.');
      const readinessLabel = this.escapeHtml(item.readiness?.label || 'Research only');
      const readinessDetail = this.escapeHtml(item.readiness?.detail || 'LYRA is only exposing research context for this route right now.');
      const placementExplanation = this.escapeHtml(item.placementExplanation || 'This route is available on Mantle.');
      const sourceUrl = this.escapeHtml(item.links?.[0]?.url || '#');
      const sourceLabel = this.escapeHtml(item.links?.[0]?.label || 'Protocol');
      const secondaryClass = variant === 'secondary' ? ' route-list-row-secondary' : '';

      return `
        <div class="route-list-row${secondaryClass}">
          <div class="route-list-head">
            <div class="route-list-title">
              <span class="strategy-section-label">Route ${rank}</span>
              <strong>${title}${symbol ? ` <span>${symbol}</span>` : ''}</strong>
            </div>
            <div class="route-list-metrics">
              <span>APY ${apy}%</span>
              <span>TVL ${tvl}</span>
            </div>
          </div>
          <div class="route-list-tags">
            <span>${placement}</span>
            <span>${category}</span>
            <span>${network}</span>
            <span>APY annualized</span>
          </div>
          <div class="route-list-grid">
            <div class="route-list-cell">
              <span class="strategy-section-label">Best fit</span>
              <strong>${fit}</strong>
              <p>${reason}</p>
            </div>
            <div class="route-list-cell">
              <span class="strategy-section-label">Risk</span>
              <strong>${riskLevel}</strong>
              <p>${riskExplanation}</p>
            </div>
            <div class="route-list-cell">
              <span class="strategy-section-label">Action readiness</span>
              <strong>${readinessLabel}</strong>
              <p>${readinessDetail}</p>
            </div>
          </div>
          <div class="route-list-foot">
            <div class="route-list-cell">
              <span class="strategy-section-label">Mantle fit</span>
              <p>${placementExplanation}</p>
            </div>
            <a class="route-list-link" href="${sourceUrl}" target="_blank" rel="noreferrer">${sourceLabel}</a>
          </div>
        </div>
      `;
    };

    const leadRouteMarkup = topRoutes[0] ? renderRouteCard(topRoutes[0], 'primary') : '';
    const supportingRoutesMarkup = topRoutes.slice(1).map((item) => renderRouteCard(item, 'secondary')).join('');

    return `
      <section class="route-list-shell">
        <div class="route-list-headline">
          <span class="strategy-section-label">Ranked Routes</span>
          <strong>Live Mantle route board</strong>
        </div>
        <div class="opportunity-route-intro">Showing the top ${topRoutes.length} featured routes from ${Number(data?.stats?.visibleRoutes || topRoutes.length)} scanned Mantle routes.</div>
        <div class="route-list-wrap">
          ${leadRouteMarkup}
          <div class="route-list-secondary-grid">
            ${supportingRoutesMarkup}
          </div>
        </div>
      </section>
    `;
  }

  buildOpportunitiesMarkup(data) {
    if (!data?.cards?.length) {
      return `
        <div class="opportunity-empty-state">
          <strong>No ranked Mantle routes are visible right now.</strong>
          <p>Refresh the board in a moment. LYRA only publishes this board when the live Mantle data is strong enough to support a real recommendation instead of filler.</p>
        </div>
      `;
    }

    const stats = data.stats || {};

    const methodology = (data.methodology || []).map((item) => `<li>${this.escapeHtml(item)}</li>`).join('');
    const recommendation = data.recommendation ? `
      <div class="opportunity-footer-card opportunity-verdict-card">
        <span class="strategy-section-label">LYRA take</span>
        <strong>${this.escapeHtml(data.recommendation.title)}</strong>
        <p>${this.escapeHtml(data.recommendation.copy)}</p>
      </div>
    ` : '';

    const statsMarkup = `
      <div class="opportunity-board-stats">
        <div class="opportunity-board-stat">
          <span class="strategy-section-label">Routes scanned</span>
          <strong>${Number(stats.visibleRoutes || 0)}</strong>
        </div>
        <div class="opportunity-board-stat">
          <span class="strategy-section-label">Mantle-native</span>
          <strong>${Number(stats.mantleNativeRoutes || 0)}</strong>
        </div>
        <div class="opportunity-board-stat">
          <span class="strategy-section-label">Available on Mantle</span>
          <strong>${Number(stats.availableRoutes || 0)}</strong>
        </div>
        <div class="opportunity-board-stat">
          <span class="strategy-section-label">Featured below</span>
          <strong>${Math.min(4, Number(stats.visibleRoutes || 0))}</strong>
        </div>
      </div>
    `;

    const boardNotes = `
      <div class="opportunity-footer-strip">
        <div class="opportunity-footer-card opportunity-method-card">
          <span class="strategy-section-label">How LYRA ranks</span>
          <strong>Source-backed. Mantle-specific. Clearly labeled.</strong>
          <ul>${methodology}</ul>
        </div>
        ${recommendation}
        <div class="opportunity-footer-card opportunity-method-card">
          <span class="strategy-section-label">Checked</span>
          <strong>${this.escapeHtml(this.formatOpportunitiesCheckedAt(data.checkedAt))}</strong>
          <p>APY is annualized. Use this board to compare route quality, durability, and readiness before moving capital.</p>
        </div>
      </div>
    `;

    return `
      <div class="opportunities-shell">
        <div class="opportunities-main">
          ${statsMarkup}
          ${boardNotes}
        </div>
        <aside class="opportunity-side-stack">
          <div class="opportunity-signal-rail">
            <div class="opportunity-signal-head">
              <span class="strategy-section-label">Live board pulse</span>
              <strong>Mantle ecosystem signals</strong>
            </div>
            ${this.buildLiveSignalRailMarkup()}
          </div>
        </aside>
        <div class="opportunities-route-span">
          ${this.buildOpportunityRoutesMarkup(data)}
        </div>
      </div>
    `;
  }

  renderStrategyLabState() {
    const elements = this.getStrategyLabElements();
    if (!elements) return;

    const { generated, loading, data, error } = this.strategyLabState;
    if (elements.resultCard) {
      elements.resultCard.dataset.state = loading ? 'loading' : generated ? 'ready' : 'idle';
    }

    if (elements.resultTitle) {
      elements.resultTitle.textContent = loading
        ? 'Refreshing live opportunities...'
        : 'Live Opportunities';
    }
    if (elements.resultSummary) {
      elements.resultSummary.textContent = loading
        ? 'Pulling the latest Mantle routes, sources, and action-readiness states.'
        : generated
          ? (data?.summary || 'Ranked Mantle routes using live source-backed signals.')
          : 'Load the board to see ranked Mantle routes, fit, risk explanation, and what LYRA can help prepare next.';
    }
    if (elements.storyboard) {
      elements.storyboard.innerHTML = generated && !loading
        ? this.buildOpportunitiesMarkup(data)
        : error
          ? `<div class="opportunity-empty-state"><strong>${this.escapeHtml(error)}</strong></div>`
          : '';
    }
    if (generated && !loading) {
      window.requestAnimationFrame(() => {
        const scrollers = [
          document.getElementById('app'),
          elements.panelView,
          elements.panelCard,
          elements.root,
          elements.resultCard,
          elements.storyboard
        ].filter(Boolean);

        scrollers.forEach((node) => {
          if (typeof node.scrollTo === 'function') {
            node.scrollTo({ top: 0, behavior: 'auto' });
          } else {
            node.scrollTop = 0;
          }
        });

        const routeSection = elements.storyboard?.querySelector('.route-list-shell');
        const firstRoute = elements.storyboard?.querySelector('.route-list-row');
        const target = routeSection || firstRoute || elements.storyboard;
        if (target && typeof target.scrollIntoView === 'function') {
          target.scrollIntoView({ block: 'start', behavior: 'auto' });
        }
      });
    }
    if (elements.resultConfidence) elements.resultConfidence.textContent = data?.confidence || 'Confidence: Live route board';
    if (elements.resultSources) elements.resultSources.textContent = data?.sources || 'Sources: DefiLlama, protocol sources';
  }

  async generateStrategyLabResult(force = false) {
    if (this.strategyLabState.loading) return;
    if (this.strategyLabState.generated && this.strategyLabState.data && !force) {
      this.renderStrategyLabState();
      return;
    }
    this.strategyLabState.loading = true;
    this.strategyLabState.error = '';
    this.renderStrategyLabState();
    this.setSurfaceStatus('Refreshing live Mantle opportunities...');
    try {
      const response = await fetch('/api/opportunities');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load live opportunities.');
      this.strategyLabState.data = data;
      this.strategyLabState.generated = true;
      this.setSurfaceStatus('Live opportunities board ready.');
    } catch (error) {
      this.strategyLabState.data = null;
      this.strategyLabState.generated = true;
      this.strategyLabState.error = error?.message || 'Could not load live opportunities.';
      this.setSurfaceStatus(this.strategyLabState.error);
    } finally {
      this.strategyLabState.loading = false;
      this.renderStrategyLabState();
    }
  }

  showPanel(panelId) {
    this.navItems.forEach((item) => item.classList.toggle('active', item.dataset.panel === panelId));
    this.panels.forEach((panel) => panel.classList.toggle('active', panel.id === `panel-${panelId}`));
    const consoleEl = document.querySelector('.lyra-main-console');
    const titleEl = document.getElementById('console-title');
    const subtitleEl = document.getElementById('console-subtitle');
    const titles = {
      overview: 'Ask LYRA',
      opportunities: 'Live Opportunities',
      decisions: 'Agent Decisions',
      reputation: 'Agent Reputation',
      settings: 'Settings'
    };
    const subtitles = {
      overview: 'YOUR AI DEFI INTELLIGENCE PARTNER',
      opportunities: 'LIVE MANTLE OPPORTUNITY BOARD',
      decisions: 'TRACKED DECISION HISTORY',
      reputation: 'TRUST AND OUTCOME LAYER',
      settings: 'PROFILE AND SYSTEM CONTROLS'
    };
    if (consoleEl) consoleEl.dataset.view = panelId || 'overview';
    if (titleEl) titleEl.textContent = titles[panelId] || 'Ask LYRA';
    if (subtitleEl) subtitleEl.textContent = subtitles[panelId] || 'YOUR AI DEFI INTELLIGENCE PARTNER';
    if (panelId === 'opportunities' && this.strategyLabRoot && !this.strategyLabState.generated && !this.strategyLabState.loading) {
      this.generateStrategyLabResult().catch((error) => {
        console.error('LYRA opportunities autoload failed', error);
        this.setSurfaceStatus('Live Opportunities could not load right now.');
      });
    }
    document.getElementById('app')?.scrollTo({ top: 0, behavior: 'auto' });
    if (panelId === 'opportunities') {
      window.requestAnimationFrame(() => {
        const routeSection = this.strategyLabRoot?.querySelector('.opportunity-route-section');
        const panelView = this.strategyLabRoot?.closest('.console-panel-view');
        const panelCard = this.strategyLabRoot?.closest('.console-panel-card');
        [panelView, panelCard, this.strategyLabRoot].filter(Boolean).forEach((node) => {
          if (typeof node.scrollTo === 'function') {
            node.scrollTo({ top: 0, behavior: 'auto' });
          } else {
            node.scrollTop = 0;
          }
        });
        routeSection?.scrollIntoView({ block: 'start', behavior: 'auto' });
      });
    }
  }

  async connectWallet(options = {}) {
    const provider = options.provider || this.getInjectedProvider();
    if (!provider) {
      this.openLogin();
      this.closeWalletChooser();
      if (this.loginWalletChoiceStatus) {
        this.loginWalletChoiceStatus.textContent = 'No injected EVM wallet found. Install MetaMask, Rabby, Zerion, or Phantom EVM mode.';
      }
      this.pushSystemMessage('No injected EVM wallet found. Install MetaMask, Rabby, Zerion, or Phantom Ethereum mode.');
      return;
    }

    try {
      this.detachProviderListeners();
      if (options.forceAccountSelection) {
        try {
          await provider.request({
            method: 'wallet_revokePermissions',
            params: [{ eth_accounts: {} }]
          });
        } catch (_) {}
        try {
          await provider.request({
            method: 'wallet_requestPermissions',
            params: [{ eth_accounts: {} }]
          });
        } catch (_) {}
      }

      if (this.chatThread) this.chatThread.dataset.briefRendered = 'false';
      if (this.loginWalletChoiceStatus) {
        this.loginWalletChoiceStatus.textContent = `Opening ${options.providerLabel || this.getWalletProviderNameFromProvider(provider)}... approve the request in your wallet.`;
      }
      this.pushSystemMessage('Opening wallet connection...');
      const [address] = await provider.request({ method: 'eth_requestAccounts' });
      if (!address) {
        throw new Error('No wallet address returned by provider');
      }

      try {
        await this.ensureMantleNetwork(provider);
      } catch (networkError) {
        this.pushSystemMessage(`Wallet connected. Network switch skipped: ${networkError.message}`);
      }

      try {
        const message = `Sign in to LYRA\n\nWallet: ${address}\nTime: ${new Date().toISOString()}`;
        await provider.request({
          method: 'personal_sign',
          params: [message, address]
        });
      } catch (signatureError) {
        this.pushSystemMessage('Wallet connected without signature. You can still scan visible wallet data.');
      }

      this.userAddress = address;
      this.resumeAddress = address;
      window.localStorage.setItem('lyraLastWalletAddress', address);
      this.walletProviderName = options.providerLabel || this.getWalletProviderNameFromProvider(provider);
      this.activeProvider = provider;
      this.attachProviderListeners(provider);
      this.heroCanEnter = true;
      this.closeWalletChooser();
      this.closeLogin();
      this.setSurfaceStatus('Wallet connected. Loading wallet context...');
      this.enterApp();
      this.showPanel('overview');
      this.seedChat();
      this.resetPortfolioView();
      this.updateWalletDisplays();
      this.syncProfilePanel();
      this.updateProfileActionButtons();
      this.fetchPortfolio().then(() => {
        this.setSurfaceStatus('Wallet intelligence ready.');
      }).catch(() => {});
      this.runWalletScan({ silent: true }).catch(() => {});
      if (options.openProfile) {
        this.openProfile();
      }
    } catch (error) {
      document.getElementById('app')?.classList.remove('scan-active');
      this.openLogin();
      this.closeWalletChooser();
      if (this.loginWalletChoiceStatus) {
        this.loginWalletChoiceStatus.textContent = error?.message?.includes('rejected')
          ? 'Connection request rejected. Try Continue with Wallet again.'
          : `Could not connect wallet: ${error.message}`;
      }
      this.pushSystemMessage(`Wallet connection failed: ${error.message}`);
    }
  }

  getInjectedProvider() {
    const ethereum = window.ethereum;
    if (!ethereum) return null;
    if (Array.isArray(ethereum.providers) && ethereum.providers.length) {
      return ethereum.providers.find((provider) => provider.isMetaMask)
        || ethereum.providers.find((provider) => provider.isRabby)
        || ethereum.providers.find((provider) => provider.isZerion)
        || ethereum.providers.find((provider) => provider.isPhantom)
        || ethereum.providers[0];
    }
    return ethereum;
  }

  clearWalletConnectionStorage() {
    const shouldClear = (key) => {
      if (!key || key === 'lyraProfileState') return false;
      return /wallet|wagmi|rabby|metamask|zerion|phantom|walletconnect|wc@2|web3modal|coinbase/i.test(key);
    };

    [window.localStorage, window.sessionStorage].forEach((store) => {
      const keysToRemove = [];
      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index);
        if (shouldClear(key)) keysToRemove.push(key);
      }
      keysToRemove.forEach((key) => store.removeItem(key));
    });
  }

  async disconnectWallet(options = {}) {
    const { silent = false, skipProviderRevoke = false, preserveAppState = false } = options;
    const provider = this.activeProvider || this.getInjectedProvider();
    this.detachProviderListeners();
    if (!skipProviderRevoke && this.walletModal?.getIsConnectedState?.()) {
      try {
        await this.walletModal.disconnect('eip155');
      } catch (_) {}
    }
    if (!skipProviderRevoke && provider?.request) {
      try {
        await provider.request({
          method: 'wallet_revokePermissions',
          params: [{ eth_accounts: {} }]
        });
      } catch (_) {}
    }
    this.clearWalletConnectionStorage();
    this.userAddress = null;
    this.resumeAddress = '';
    this.heroCanEnter = false;
    this.currentSnapshot = null;
    this.currentWalletAnalysis = null;
    this.walletProviderName = null;
    this.activeProvider = null;
    this.walletConnectRequested = false;
    this.enterAfterConnectRequested = false;
    this.pendingOpenProfileAfterWallet = false;
    window.localStorage.removeItem('lyraLastWalletAddress');
    if (this.chatThread) this.chatThread.dataset.briefRendered = 'false';
    this.updateWalletDisplays();
    this.seedChat();
    this.resetPortfolioView();
    this.syncProfilePanel();
    this.updateProfileActionButtons();
    this.closeWalletChooser();
    this.closeLogin();
    if (!preserveAppState) {
      this.exitApp();
    }
    if (!silent) {
      this.pushSystemMessage('Wallet disconnected from LYRA.');
    }
  }

  async resetWalletSessionForReconnect() {
    this.closeProfile();
    this.closeWalletChooser();
    await this.disconnectWallet({ silent: true, preserveAppState: true });
  }

  removeWalletConnection() {
    this.disconnectWallet();
    this.closeProfile();
    this.closeLogin();
    this.exitApp();
  }

  removeGoogleConnection() {
    this.googleProfile = null;
    this.profileState.googleEmail = '';
    this.persistProfileState();
    this.updateWalletDisplays();
    this.syncProfilePanel();
    this.updateProfileActionButtons();
    this.openProfile();
    this.pushSystemMessage('Google account removed from LYRA profile.');
  }

  logoutProfile() {
    this.googleProfile = null;
    this.profileState = {
      preferredName: '',
      avatarDataUrl: ''
    };
    window.localStorage.removeItem('lyraProfileState');
    this.disconnectWallet();
    this.closeProfile();
    this.closeLogin();
    this.updateWalletDisplays();
    this.syncProfilePanel();
    this.updateProfileActionButtons();
    this.pushSystemMessage('Logged out of LYRA profile.');
  }

  attachProviderListeners(provider) {
    if (!provider?.on) return;
    this.detachProviderListeners();

    const accountsChanged = (accounts) => this.handleProviderAccountsChanged(provider, accounts);
    const chainChanged = () => this.handleProviderChainChanged(provider);
    const disconnected = () => this.handleProviderDisconnect();

    provider.on('accountsChanged', accountsChanged);
    provider.on('chainChanged', chainChanged);
    provider.on('disconnect', disconnected);

    this.providerListeners = {
      provider,
      accountsChanged,
      chainChanged,
      disconnected
    };
  }

  detachProviderListeners() {
    if (!this.providerListeners?.provider?.removeListener) return;
    const { provider, accountsChanged, chainChanged, disconnected } = this.providerListeners;
    provider.removeListener('accountsChanged', accountsChanged);
    provider.removeListener('chainChanged', chainChanged);
    provider.removeListener('disconnect', disconnected);
    this.providerListeners = null;
  }

  async handleProviderAccountsChanged(provider, accounts) {
    const nextAddress = accounts?.[0] || null;
    const previousAddress = this.userAddress;
    if (!nextAddress) {
      await this.disconnectWallet({ silent: true });
      this.openLogin();
      this.pushSystemMessage('Wallet session cleared. Choose a wallet to reconnect.');
      return;
    }

    this.userAddress = nextAddress;
    this.walletProviderName = this.getWalletProviderNameFromProvider(provider);
    this.activeProvider = provider;
    this.currentSnapshot = null;
    this.currentWalletAnalysis = null;
    this.updateWalletDisplays();
    this.resetPortfolioView();
    if (!previousAddress || previousAddress.toLowerCase() !== nextAddress.toLowerCase()) {
      this.pushSystemMessage(`Wallet switched to ${nextAddress.slice(0, 6)}...${nextAddress.slice(-4)}.`);
    }
    this.setSurfaceStatus('Wallet changed. Refreshing wallet context...');
    await this.fetchPortfolio();
  }

  async handleProviderChainChanged(provider) {
    if (!this.userAddress) return;
    this.walletProviderName = this.getWalletProviderNameFromProvider(provider);
    this.currentSnapshot = null;
    this.currentWalletAnalysis = null;
    this.resetPortfolioView();
    this.setSurfaceStatus('Network changed. Refreshing wallet context...');
    await this.fetchPortfolio();
  }

  async handleProviderDisconnect() {
    await this.disconnectWallet({ silent: true });
    this.openLogin();
    this.pushSystemMessage('Wallet provider disconnected. Choose a wallet to reconnect.');
  }

  getWalletProviderNameFromProvider(provider) {
    if (!provider) return 'Wallet';
    if (provider.isMetaMask) return 'MetaMask';
    if (provider.isRabby) return 'Rabby';
    if (provider.isZerion) return 'Zerion';
    if (provider.isPhantom) return 'Phantom';
    return 'Wallet';
  }

  async ensureMantleNetwork(provider) {
    const mantleChainId = '0x138b';
    const currentChainId = await provider.request({ method: 'eth_chainId' });
    if (currentChainId === mantleChainId) return;

    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: mantleChainId }]
      });
    } catch (error) {
      if (error.code !== 4902) {
        throw new Error(`Switch ${this.getWalletProviderNameFromProvider(provider)} to Mantle Sepolia to continue.`);
      }

      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: mantleChainId,
          chainName: 'Mantle Sepolia Testnet',
          rpcUrls: ['https://rpc.sepolia.mantle.xyz'],
          nativeCurrency: {
            name: 'Mantle',
            symbol: 'MNT',
            decimals: 18
          },
          blockExplorerUrls: ['https://sepolia.mantlescan.xyz']
        }]
      });
    }
  }

  setupHeroVideoLoop() {
    if (!this.heroVideo) return;

    this.heroVideo.addEventListener('loadedmetadata', () => {
      this.heroHoldActive = false;
      this.heroLoopSeeking = false;
      this.heroPausedForLanding = false;
    });

    this.heroVideo.addEventListener('seeked', () => {
      this.heroLoopSeeking = false;
    });

    this.heroVideo.addEventListener('timeupdate', () => {
      if (
        this.heroHoldActive
        || this.heroLoopSeeking
        || this.heroPausedForLanding
        || !this.heroVideo.duration
        || document.body.classList.contains('app-entered')
      ) return;

      const safeLoopPoint = this.heroVideo.duration > 2.6
        ? Math.min(2.22, this.heroVideo.duration - 0.52)
        : Math.max(0.1, this.heroVideo.duration * 0.58);
      if (this.heroVideo.currentTime < safeLoopPoint) return;

      this.heroHoldActive = true;
      this.heroVideo.pause();
      clearTimeout(this.heroLoopTimeout);
      this.heroLoopTimeout = window.setTimeout(() => {
        this.heroPausedForLanding = true;
        this.heroHoldActive = false;
      }, 3000);
    });

    this.heroVideo.addEventListener('ended', () => {
      this.heroVideo.pause();
      this.heroPausedForLanding = true;
      this.heroHoldActive = false;
      this.heroLoopSeeking = false;
    });
  }

  async fetchPortfolio() {
    if (!this.userAddress) return;

    try {
      const response = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: this.userAddress })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Failed to load portfolio');
      }

      this.currentSnapshot = data.snapshot;
      this.renderSnapshot();
      this.renderAgentIntelligence(this.currentSnapshot, 'live');
      this.renderConsolePanels();
    } catch (error) {
      this.setSurfaceStatus('Wallet context is temporarily unavailable. Try again.');
    }
  }

  async runWalletScan(options = {}) {
    const { silent = false } = options;
    if (!this.userAddress || this.scanRequest) return;

    this.currentWalletAnalysis = null;
    this.renderConsolePanels();
    if (!silent) {
      this.renderScanFeedStart();
    }

    const steps = [
      'Reading wallet...',
      'Fetching balances...',
      'Analyzing transactions...',
      'Detecting chain activity...',
      'Generating intelligence...'
    ];

    this.scanRequest = fetch('/api/scan-wallet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: this.userAddress })
    });

    try {
      for (const step of steps) {
        if (!silent) {
          this.appendScanFeedLine(step);
          await this.sleep(280);
        }
      }

      const response = await this.scanRequest;
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Wallet scan failed');
      }

      this.currentWalletAnalysis = data;
      this.renderWalletAnalysis();
      this.renderConsolePanels();
      if (!silent) {
        this.renderScanResultsInChat();
      } else {
        this.setSurfaceStatus('Wallet intelligence ready.');
      }
    } catch (error) {
      this.setSurfaceStatus('Wallet scan is temporarily unavailable. Try again.');
    } finally {
      this.scanRequest = null;
    }
  }

  renderScanFeedStart() {
    if (!this.chatThread || !this.userAddress) return;
    this.chatThread.innerHTML = '';
    this.chatThread.dataset.briefRendered = 'false';
    this.addChatMessage(
      'assistant',
      `Starting analysis for ${this.userAddress.slice(0, 6)}...${this.userAddress.slice(-4)}. LYRA will only report what the visible wallet data supports.`
    );
  }

  appendScanFeedLine(text) {
    if (!this.chatThread) return;

    let feed = document.querySelector('.scan-feed');
    if (!feed) {
      feed = document.createElement('div');
      feed.className = 'analysis-brief scan-feed';
      feed.innerHTML = `
        <div class="analysis-brief-head">
          <strong>Live scan feed</strong>
          <span>Evidence-first</span>
        </div>
      `;
      this.chatThread.appendChild(feed);
    }

    const line = document.createElement('div');
    line.className = 'analysis-line';
    line.textContent = text;
    feed.appendChild(line);
    this.chatThread.scrollTo({ top: this.chatThread.scrollHeight, behavior: 'smooth' });
  }

  renderScanResultsInChat() {
    if (!this.chatThread || !this.currentWalletAnalysis) return;

    const analysis = this.currentWalletAnalysis;
    const holdings = analysis.topHoldings || [];
    const holdingsLabel = holdings.length
      ? holdings.slice(0, 3).map((asset) => {
        const value = Number(asset.valueUsd || 0);
        return value > 0
          ? `${asset.symbol} $${value.toFixed(2)}`
          : `${asset.symbol}${asset.amount ? ` ${asset.amount}` : ''}`;
      }).join(' / ')
      : 'No valued holdings detected yet';

    this.addChatMessage(
      'assistant',
      `Observed wallet activity is now recorded. Dominant chain: ${analysis.dominantChain || 'Not enough evidence yet'}. Transactions observed: ${analysis.transactionCount}. Confidence: ${analysis.walletConfidence?.level || 'LOW'}. ${analysis.walletConfidence?.message || 'Additional wallet history required.'}`
    );
    this.appendDecisionCard(analysis, holdingsLabel);
    this.chatThread.dataset.briefRendered = 'true';
  }

  renderSnapshot() {
    const snapshot = this.currentSnapshot;
    if (!snapshot) return;

    const positiveBalances = snapshot.balances.filter((asset) => Number(asset.value) > 0 || Number(asset.formatted) > 0);
    const largestHolding = positiveBalances[0] || null;

    this.setMetricValue(0, this.userAddress ? 'Connected' : 'Not Connected', this.userAddress ? `${positiveBalances.length} tracked assets` : 'Connect wallet to load real positions');
    this.setMetricValue(1, `$${snapshot.totalValue.toFixed(2)}`, largestHolding ? `${largestHolding.symbol} is largest holding` : 'No funded positions detected');
    this.setMetricValue(2, snapshot.summary.networkLabel, this.userAddress ? 'Live wallet connected' : 'Not connected');
    this.setMetricValue(3, snapshot.summary.nextStep, this.userAddress ? 'Ready for analysis' : 'Connect wallet first');

    const portfolioLabel = document.querySelector('.chart-card .section-label');
    if (portfolioLabel) portfolioLabel.textContent = 'Live Portfolio';
    const modePill = document.getElementById('mode-pill');
    if (modePill && !modePill.textContent.trim()) modePill.textContent = 'Mantle Network';

    const positions = document.querySelector('.positions');
    if (positions) {
      positions.innerHTML = '';
      const heroPositions = positiveBalances.slice(0, 3);
      if (!heroPositions.length) {
        const row = document.createElement('div');
        row.className = 'position-row';
        row.innerHTML = '<div><strong>No funded positions detected</strong><span>LYRA connected successfully, but this wallet has no valued balances yet.</span></div><div class="position-metric">--</div>';
        positions.appendChild(row);
      }
      heroPositions.forEach((asset) => {
        const row = document.createElement('div');
        row.className = 'position-row';
        row.innerHTML = `<div><strong>${asset.symbol}</strong><span>${asset.formatted} tokens - ${asset.allocationPercent.toFixed(1)}% allocation</span></div><div class="position-metric">$${asset.value.toFixed(2)}</div>`;
        positions.appendChild(row);
      });
    }

    const recommendationCard = document.querySelector('#panel-overview .recommend-card');
    if (recommendationCard) {
      const headerLabel = recommendationCard.querySelector('.signal-head .section-label');
      const badge = recommendationCard.querySelector('.signal-head .badge');
      const title = recommendationCard.querySelector('h3');
      const body = recommendationCard.querySelector('p');
      if (headerLabel) headerLabel.textContent = 'Recommendation';
      if (badge) badge.textContent = this.currentWalletAnalysis ? 'Evidence only' : 'Awaiting scan';
      if (title) title.textContent = this.currentWalletAnalysis ? 'Analysis must complete before LYRA suggests actions' : 'Run Analyze Wallet first';
      if (body) body.textContent = this.currentWalletAnalysis
        ? (this.currentWalletAnalysis.walletConfidence?.message || 'LYRA is withholding unsupported conclusions until more wallet evidence is visible.')
        : 'Connect a wallet and run Analyze Wallet to build the evidence layer.';
      const statValues = recommendationCard.querySelectorAll('.stat-value');
      if (statValues[0]) statValues[0].textContent = '--';
      if (statValues[1]) statValues[1].textContent = this.currentWalletAnalysis?.walletConfidence?.level || snapshot.summary?.visibilityConfidence || 'Low';
      if (statValues[2]) statValues[2].textContent = '0 action';
    }

    const positionsPanel = document.querySelector('#panel-positions .list-table');
    if (positionsPanel) {
      positionsPanel.innerHTML = '';
      const tableBalances = positiveBalances.length ? positiveBalances : snapshot.balances;
      tableBalances.forEach((asset) => {
        const row = document.createElement('div');
        row.className = 'table-row app-card';
        row.innerHTML = `
          <div><strong>${asset.symbol}</strong><span>${asset.name || 'Token balance'}</span></div>
          <div><strong>${asset.allocationPercent.toFixed(1)}%</strong><span>Allocation</span></div>
          <div><strong>$${asset.value.toFixed(2)}</strong><span>Value</span></div>
          <div><strong>${asset.price ? `$${asset.price.toFixed(2)}` : '--'}</strong><span>Price</span></div>
        `;
        positionsPanel.appendChild(row);
      });
    }
  }

  setMetricValue(index, value, note) {
    const metric = document.querySelectorAll('.metric-strip .metric')[index];
    if (!metric) return;
    const valueEl = metric.querySelector('.metric-value');
    const noteEl = metric.querySelector('.sidebar-copy');
    if (valueEl) valueEl.textContent = value;
    if (noteEl) noteEl.textContent = note;
  }

  updateWalletDisplays() {
    const sidebarStatus = document.querySelector('.sidebar-brand .sidebar-copy');
    const shortAddress = this.userAddress ? `${this.userAddress.slice(0, 6)}...${this.userAddress.slice(-4)}` : null;
    const preferredName = this.profileState?.preferredName?.trim();
    const identityLabel = preferredName || shortAddress || this.googleProfile?.given_name || this.googleProfile?.name || this.googleProfile?.email || 'Log in';
    const knownAddress = this.userAddress || this.resumeAddress || '';
    const hasConnectedWallet = Boolean(this.userAddress && this.heroCanEnter);
    const walletLabel = knownAddress || 'Connect Wallet';
    const isSignedIn = Boolean(this.userAddress || this.googleProfile);
    if (sidebarStatus) {
      sidebarStatus.textContent = this.userAddress
        ? shortAddress
        : 'Wallet not connected';
    }

    if (this.navLoginBtn) {
      this.navLoginBtn.title = identityLabel;
    }
    if (this.navAvatarBtn) {
      this.navAvatarBtn.title = identityLabel;
      this.navAvatarBtn.setAttribute('aria-label', identityLabel);
    }
    if (this.navLoginLabel) {
      this.navLoginLabel.textContent = identityLabel;
    }
    if (this.navLoginAvatar) {
      const avatarSrc = isSignedIn
        ? (this.profileState?.avatarDataUrl || this.defaultAvatarSrc)
        : this.defaultAvatarSrc;
      this.navLoginAvatar.innerHTML = `<img src="${avatarSrc}" alt="Account avatar">`;
    }

    document.querySelectorAll('.app-btn').forEach((btn) => {
      if (btn.dataset.walletAction === 'connect') {
        btn.textContent = this.userAddress ? shortAddress : 'Connect Wallet';
        btn.title = this.userAddress ? walletLabel : 'Connect Wallet';
      }
    });

    if (this.heroStartBtn) {
      const label = this.heroStartBtn.querySelector('span:last-child');
      if (label) label.textContent = hasConnectedWallet ? 'Enter' : 'Connect Wallet';
      this.heroStartBtn.title = hasConnectedWallet ? 'Enter LYRA' : 'Connect Wallet';
    }

    if (this.loginWalletAddress) {
      this.loginWalletAddress.textContent = this.userAddress ? shortAddress : 'No wallet connected';
    }
    if (!this.userAddress) {
      this.renderWalletChoices();
    }
    this.syncProfilePanel();
    this.updateProfileActionButtons();
  }

  renderConsolePanels() {
    this.updateWalletSummaryCard();
    this.renderStrategyLabState();
    this.renderAgentDecisionsPanel();
  }

  renderWalletAnalysis() {
    const analysis = this.currentWalletAnalysis;
    if (!analysis) return;

    const totalHoldings = (analysis.topHoldings || []).length;
    const visibleStablecoin = analysis.stablecoinExposure?.valueUsd || 0;

    this.setMetricValue(0, 'Scanned', `${analysis.transactionCount} visible transactions`);
    this.setMetricValue(1, analysis.dominantChain || 'Unknown', `${totalHoldings} visible holdings`);
    this.setMetricValue(2, analysis.walletConfidence?.level || 'Low', analysis.walletConfidence?.message || 'Additional wallet history required');
    this.setMetricValue(3, `$${Number(visibleStablecoin).toFixed(2)}`, 'Visible stablecoin exposure');
  }

  syncProfilePanel() {
    const profileTitle = document.querySelector('#panel-profile .topbar strong');
    const profileSubtitle = document.querySelector('#panel-profile .topbar span');
    const profileBadge = document.querySelector('#panel-profile .topbar .badge');
    const appAvatar = document.querySelector('#panel-profile .avatar');
    const walletRow = document.querySelector('#panel-profile .field-list .field-row:nth-child(1) span');
    const walletBadge = document.querySelector('#panel-profile .field-list .field-row:nth-child(1) .badge');

    if (profileTitle) {
      profileTitle.textContent = this.profileState?.preferredName?.trim() || this.googleProfile?.name || 'Profile Setup';
    }
    if (profileSubtitle) {
      profileSubtitle.textContent = this.googleProfile?.email || this.profileState?.googleEmail || 'Create identity after Google sign-in';
    }
    if (profileBadge) {
      profileBadge.textContent = this.googleProfile ? 'Live' : 'Pending';
    }
    if (appAvatar) {
      if (this.profileState?.avatarDataUrl) {
        appAvatar.innerHTML = `<img src="${this.profileState.avatarDataUrl}" alt="Profile avatar">`;
      } else {
        appAvatar.innerHTML = `<img src="${this.defaultAvatarSrc}" alt="Default profile avatar">`;
      }
    }
    if (walletRow) {
      walletRow.textContent = this.userAddress
        ? this.userAddress
        : 'No wallet connected yet';
    }
    if (walletBadge) {
      walletBadge.textContent = this.userAddress ? 'Connected' : 'Connect';
    }

    const settingsAvatar = document.getElementById('settings-profile-avatar');
    const settingsName = document.getElementById('settings-profile-name');
    const settingsMeta = document.getElementById('settings-profile-meta');
    const settingsWallet = document.getElementById('settings-wallet-value');
    const settingsGoogle = document.getElementById('settings-google-value');
    const settingsSwitchWalletBtn = document.getElementById('settings-switch-wallet-btn');
    const settingsDisconnectWalletBtn = document.getElementById('settings-disconnect-wallet-btn');
    const settingsConnectGoogleBtn = document.getElementById('settings-connect-google-btn');
    if (settingsAvatar) {
      const avatarSrc = this.profileState?.avatarDataUrl || this.defaultAvatarSrc;
      settingsAvatar.innerHTML = `<img src="${avatarSrc}" alt="Profile avatar">`;
    }
    if (settingsName) {
      settingsName.textContent = this.profileState?.preferredName?.trim()
        || this.googleProfile?.name
        || this.googleProfile?.email
        || 'Profile';
    }
    if (settingsMeta) {
      settingsMeta.textContent = this.googleProfile?.email
        || this.profileState?.googleEmail
        || 'Connect Google or set a preferred name.';
    }
    if (settingsWallet) {
      settingsWallet.textContent = this.userAddress
        ? `${this.userAddress.slice(0, 6)}...${this.userAddress.slice(-4)}`
        : 'No wallet connected';
    }
    if (settingsGoogle) {
      settingsGoogle.textContent = this.googleProfile?.email || this.profileState?.googleEmail || 'Not connected';
    }
    if (settingsSwitchWalletBtn) {
      settingsSwitchWalletBtn.textContent = this.userAddress ? 'Switch Wallet' : 'Connect Wallet';
    }
    if (settingsDisconnectWalletBtn) {
      settingsDisconnectWalletBtn.classList.toggle('hidden', !this.userAddress);
    }
    if (settingsConnectGoogleBtn) {
      const googleConnected = Boolean(this.googleProfile?.email || this.profileState?.googleEmail);
      settingsConnectGoogleBtn.textContent = googleConnected ? 'Google Connected' : 'Connect Google';
      settingsConnectGoogleBtn.disabled = googleConnected;
      settingsConnectGoogleBtn.style.opacity = googleConnected ? '0.6' : '1';
      settingsConnectGoogleBtn.style.cursor = googleConnected ? 'default' : 'pointer';
    }
  }

  updateProfileActionButtons() {
    const profileActions = document.querySelector('.profile-actions');
    if (profileActions) {
      const googleConnected = Boolean(this.googleProfile?.email || this.profileState?.googleEmail);
      profileActions.classList.toggle('connected-pair', Boolean(this.userAddress && googleConnected));
    }

    if (this.profileConnectWalletBtn) {
      const connected = Boolean(this.userAddress);
      this.profileConnectWalletBtn.textContent = connected ? 'Switch Wallet' : 'Connect Wallet';
      this.profileConnectWalletBtn.disabled = false;
      this.profileConnectWalletBtn.style.opacity = '1';
      this.profileConnectWalletBtn.style.cursor = 'pointer';
    }
    if (this.profileRemoveWalletBtn) {
      const connected = Boolean(this.userAddress);
      this.profileRemoveWalletBtn.classList.toggle('hidden', !connected);
    }

    if (this.profileConnectGoogleBtn) {
      const connected = Boolean(this.googleProfile?.email || this.profileState?.googleEmail);
      this.profileConnectGoogleBtn.textContent = connected ? 'Google Connected' : 'Connect Google';
      this.profileConnectGoogleBtn.disabled = connected;
      this.profileConnectGoogleBtn.style.opacity = connected ? '0.6' : '1';
      this.profileConnectGoogleBtn.style.cursor = connected ? 'default' : 'pointer';
    }
    if (this.profileRemoveGoogleBtn) {
      const connected = Boolean(this.googleProfile?.email || this.profileState?.googleEmail);
      this.profileRemoveGoogleBtn.classList.toggle('hidden', !connected);
    }
  }

  appendDecisionCard(analysis, holdingsLabel) {
    if (!this.chatThread || !analysis) return;
    const stableUsd = Number(analysis.stablecoinExposure?.valueUsd || 0);
    const decision = document.createElement('div');
    decision.className = 'decision-card';
    decision.innerHTML = `
      <div class="decision-card-head">
        <strong>Decision #21</strong>
        <span>Recorded</span>
      </div>
      <div class="decision-grid">
        <div class="decision-field">
          <span class="decision-field-label">Detected</span>
          <strong>${stableUsd > 0 ? 'Observed stablecoin exposure' : 'Observed wallet activity'}</strong>
          <p>${holdingsLabel}</p>
        </div>
        <div class="decision-field">
          <span class="decision-field-label">Action</span>
          <strong>${analysis.walletConfidence?.level === 'LOW' ? 'Investigate more history' : 'Review Mantle-native route'}</strong>
          <p>${analysis.dominantChain || 'Dominant chain still forming from visible activity.'}</p>
        </div>
        <div class="decision-field">
          <span class="decision-field-label">Reason</span>
          <strong>${analysis.walletConfidence?.message || 'Observable activity supports a limited evidence set.'}</strong>
        </div>
        <div class="decision-field">
          <span class="decision-field-label">Confidence</span>
          <strong>${analysis.walletConfidence?.level || 'LOW'}</strong>
          <p>LYRA only escalates confidence when the wallet evidence supports it.</p>
        </div>
      </div>
    `;
    this.chatThread.appendChild(decision);
  }

  getThinkingLabelForMessage(message) {
    const lower = String(message || '').toLowerCase();
    if (lower.includes('yield') || lower.includes('apy') || lower.includes('opportunit')) {
      return 'Checking Mantle opportunities...';
    }
    if (lower.includes('usdc') || lower.includes('stable')) {
      return 'Comparing stablecoin routes...';
    }
    if (lower.includes('wallet') || lower.includes('portfolio') || lower.includes('activity')) {
      return 'Reading wallet activity...';
    }
    return 'Reviewing wallet context...';
  }


  copyWalletAddress() {
    if (!this.userAddress) return;
    navigator.clipboard?.writeText(this.userAddress).then(() => {
      this.setSurfaceStatus('Wallet address copied.');
    }).catch(() => {
      this.setSurfaceStatus('Could not copy wallet address.');
    });
  }

  formatHistoryCoverage() {
    if (!this.userAddress) return 'Unknown';
    if (!this.currentWalletAnalysis) return 'Scanning...';
    if (this.currentWalletAnalysis?.observedSince && this.currentWalletAnalysis.observedSince !== 'Unknown') {
      return `Observed since ${this.currentWalletAnalysis.observedSince}`;
    }
    if (this.currentWalletAnalysis?.historyCoverage) return this.currentWalletAnalysis.historyCoverage;
    const chains = this.currentWalletAnalysis?.activeChains || [];
    if (!chains.length && this.currentSnapshot?.network === 'mainnet') return 'Mantle-only';
    if (!chains.length) return 'Pending';
    if (chains.length === 1) return `${chains[0]}-only`;
    return `${chains.length} chains visible`;
  }

  formatConfidenceLabel() {
    const percent = Number(this.currentWalletAnalysis?.walletConfidence?.percent || 0);
    if (percent >= 75) return 'High';
    if (percent >= 55) return 'Moderate';
    return this.userAddress ? 'Limited' : '--';
  }

  formatConfidenceDetail() {
    const txs = Number(this.currentWalletAnalysis?.transactionCount || 0);
    const chains = Number(this.currentWalletAnalysis?.activeChains?.length || 0);
    if (!this.userAddress) return 'Waiting for wallet connection.';
    if (!txs && !chains) {
      return this.currentWalletAnalysis?.walletConfidence?.reason
        || this.currentWalletAnalysis?.walletConfidence?.message
        || 'Visible history is still narrow.';
    }
    return `${txs} txs â€¢ ${chains} chain${chains === 1 ? '' : 's'}`;
  }

  formatLastAnalysis() {
    if (this.currentWalletAnalysis?.lastAnalysisLabel) return this.currentWalletAnalysis.lastAnalysisLabel;
    const stamp = this.currentWalletAnalysis?.scannedAt
      || this.currentWalletAnalysis?.previousScan?.createdAt
      || this.currentSnapshot?.timestamp
      || null;
    if (!stamp) return this.userAddress ? 'Analyzing...' : 'Unknown';
    const diffMs = Date.now() - new Date(stamp).getTime();
    const minutes = Math.max(1, Math.round(diffMs / 60000));
    if (minutes < 60) return `${minutes} minutes ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hours ago`;
    const days = Math.round(hours / 24);
    return `${days} days ago`;
  }

  formatDisplayNetworkLabel(label) {
    const value = String(label || '').trim();
    if (!value) return value;
    if (value === 'Mantle Sepolia' || value === 'Mantle' || value === 'Mantle Testnet') {
      return 'Mantle Network';
    }
    return value;
  }

  updateWalletSummaryCard() {
    const shortAddress = this.userAddress ? `${this.userAddress.slice(0, 6)}...${this.userAddress.slice(-4)}` : 'Not connected';
    const sidebarAddress = document.getElementById('sidebar-wallet-address');
    const sidebarState = document.getElementById('sidebar-wallet-state');
    const sidebarCopyBtn = document.getElementById('sidebar-copy-wallet-btn');
    const sidebarDisconnectBtn = document.getElementById('sidebar-disconnect-btn');
    const networkEl = document.getElementById('summary-primary-network');
    const confidenceEl = document.getElementById('summary-confidence');
    const confidenceReasonEl = document.getElementById('summary-confidence-reason');
    const ageEl = document.getElementById('summary-history-coverage');
    const lastEl = document.getElementById('summary-last-analysis');

    const network = this.formatDisplayNetworkLabel(
      document.getElementById('mode-pill')?.textContent?.trim()
      || (this.userAddress ? 'Mantle Sepolia' : '--')
    );
    const confidence = this.formatConfidenceLabel();
    const confidenceReason = this.formatConfidenceDetail();

    if (sidebarAddress) sidebarAddress.textContent = shortAddress;
    if (sidebarState) sidebarState.textContent = this.userAddress ? 'Wallet connected' : 'Wallet not connected';
    if (sidebarCopyBtn) sidebarCopyBtn.classList.toggle('hidden', !this.userAddress);
    if (sidebarDisconnectBtn) sidebarDisconnectBtn.classList.toggle('hidden', !this.userAddress);
    if (networkEl) networkEl.textContent = network;
    if (confidenceEl) confidenceEl.textContent = confidence;
    if (confidenceReasonEl) confidenceReasonEl.textContent = confidenceReason;
    if (confidenceEl) confidenceEl.title = confidenceReason;
    if (ageEl) ageEl.textContent = this.formatHistoryCoverage();
    if (lastEl) lastEl.textContent = this.userAddress ? this.formatLastAnalysis() : 'Unknown';
  }

  setExecutionFormStatus(form, message = '', tone = 'busy') {
    if (!form) return;
    const statusEl = form.querySelector('[data-execution-status]');
    if (!statusEl) return;
    const text = String(message || '').trim();
    statusEl.textContent = text;
    statusEl.classList.toggle('visible', Boolean(text));
    statusEl.classList.toggle('error', tone === 'error');
  }

  setExecutionFormBusy(form, busy, actionType = '') {
    if (!form) return;
    form.classList.toggle('is-submitting', Boolean(busy));
    const controls = form.querySelectorAll('input, select, button');
    controls.forEach((control) => {
      if (busy) control.setAttribute('disabled', 'disabled');
      else control.removeAttribute('disabled');
    });
    const submitBtn = form.querySelector('[type="submit"]');
    if (!submitBtn) return;
    if (!submitBtn.dataset.defaultLabel) {
      submitBtn.dataset.defaultLabel = submitBtn.textContent.trim();
    }
    submitBtn.textContent = busy
      ? (actionType === 'send'
        ? 'Preparing transfer...'
        : actionType === 'bridge'
          ? 'Preparing bridge...'
          : 'Preparing swap...')
      : submitBtn.dataset.defaultLabel;
  }

  renderSnapshot() {
    this.updateWalletSummaryCard();
  }

  renderWalletAnalysis() {
    this.updateWalletSummaryCard();
  }

  renderAgentIntelligence() {
    this.updateWalletSummaryCard();
  }

  renderConsolePanels() {
    this.updateWalletSummaryCard();
    this.renderAgentDecisionsPanel();
  }

  resetPortfolioView() {
    this.currentWalletAnalysis = null;
    this.currentSnapshot = null;
    this.updateWalletSummaryCard();
  }

  createMessageMeta(className, text) {
    const meta = document.createElement('div');
    meta.className = className;
    meta.textContent = text;
    return meta;
  }

  getCurrentTimeLabel() {
    return new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  addChatMessage(role, text, pending = false) {
    const el = document.createElement('div');
    el.className = `chat-msg ${role === 'user' ? 'user' : 'assistant'}`;

    const avatar = document.createElement('div');
    avatar.className = `chat-avatar ${role === 'user' ? 'user-avatar' : 'assistant-avatar'}`;
    if (role === 'assistant') {
      avatar.innerHTML = `<img src="${this.lyraAvatarSrc}" alt="LYRA">`;
    } else {
      const avatarSrc = this.profileState?.avatarDataUrl || this.defaultAvatarSrc;
      avatar.innerHTML = `<img src="${avatarSrc}" alt="User">`;
    }

    const wrap = document.createElement('div');
    const body = document.createElement('div');
    body.className = 'chat-bubble';
    body.style.opacity = pending ? '0.72' : '1';
    body.textContent = text;
    wrap.appendChild(body);
    wrap.appendChild(this.createMessageMeta(role === 'user' ? 'user-timestamp' : 'assistant-timestamp', this.getCurrentTimeLabel()));
    el.appendChild(avatar);
    el.appendChild(wrap);
    this.chatThread?.appendChild(el);
    this.chatThread?.scrollTo({ top: this.chatThread.scrollHeight, behavior: 'smooth' });
    return { el, body };
  }

  addRichAssistantMessage(html) {
    const assistant = this.addChatMessage('assistant', '', true);
    assistant.body.classList.add('lyra-rich-bubble');
    assistant.body.innerHTML = '<span class="assistant-thinking">Pulling the answer together<span class="thinking-dots"><span></span><span></span><span></span></span></span>';
    assistant.body.style.opacity = '1';
    window.setTimeout(() => {
      assistant.body.innerHTML = html;
      const parts = Array.from(assistant.body.querySelectorAll('.lyra-rich-response > *'));
      parts.forEach((part) => {
        part.style.opacity = '0';
        part.style.transform = 'translateY(6px)';
        part.style.transition = 'opacity 220ms ease, transform 220ms ease';
      });
      parts.forEach((part, index) => {
        window.setTimeout(() => {
          part.style.opacity = '1';
          part.style.transform = 'translateY(0)';
          this.chatThread?.scrollTo({ top: this.chatThread.scrollHeight, behavior: 'smooth' });
        }, 120 * index);
      });
      this.chatThread?.scrollTo({ top: this.chatThread.scrollHeight, behavior: 'smooth' });
    }, 420);
    this.chatThread?.scrollTo({ top: this.chatThread.scrollHeight, behavior: 'smooth' });
    return assistant;
  }

  buildExecutionPanelHtml(actionType, values = {}) {
    const action = String(actionType || '').toLowerCase();
    const title = action === 'bridge'
      ? 'Bridge with LYRA'
      : action === 'swap'
        ? 'Swap with LYRA'
        : 'Send with LYRA';
    const note = action === 'bridge'
      ? 'Choose the route and amount, then sign in your wallet.'
      : action === 'swap'
        ? 'Choose the network, pair, and amount, then sign in your wallet.'
        : 'Enter the recipient and amount, then sign in your wallet.';
    const sourceLabel = action === 'bridge' ? 'From' : 'Network';
    const showDestinationChain = action === 'bridge';
    const showToToken = action === 'swap';
    const networks = action === 'swap'
      ? ['Mantle Mainnet']
      : ['Sepolia', 'Mantle Sepolia'];
    const assets = ['MNT', 'ETH'];
    const defaultFrom = values.fromNetwork || (action === 'bridge' ? 'Sepolia' : action === 'swap' ? 'Mantle Mainnet' : 'Mantle Sepolia');
    const bridgeDestinations = defaultFrom === 'Mantle Sepolia'
      ? ['Sepolia']
      : ['Mantle Sepolia'];
    const defaultTo = action === 'bridge'
      ? (bridgeDestinations.includes(values.toNetwork) ? values.toNetwork : bridgeDestinations[0])
      : '';
    const defaultToken = values.tokenSymbol || (defaultFrom === 'Sepolia' ? 'ETH' : 'MNT');
    const defaultToToken = values.toTokenSymbol || (defaultToken === 'MNT' ? 'ETH' : 'MNT');
    const amount = values.amount || '';
    const recipient = values.recipient || '';

    const selectHtml = (name, selected, options) => `
      <select name="${name}" class="lyra-exec-select">
        ${options.map((option) => `<option value="${option}"${option === selected ? ' selected' : ''}>${option}</option>`).join('')}
      </select>
    `;

    return `
      <div class="lyra-rich-response lyra-execution-response" data-execution-mode="${action}">
        <div class="lyra-exec-shell">
          <div class="lyra-exec-topline">
            <div class="lyra-rich-label">Action mode</div>
            <div class="lyra-exec-title">${title}</div>
          </div>
          <div class="lyra-exec-note">${note}</div>
          <form class="lyra-exec-form" data-execution-form="${action}" data-execution-mode="prepare">
            <input type="hidden" name="actionType" value="${action}">
            <div class="lyra-exec-grid ${action === 'send' ? 'send' : ''}">
              <label class="lyra-exec-field">
                <span class="lyra-rich-label">${sourceLabel}</span>
                ${selectHtml('fromNetwork', defaultFrom, networks)}
              </label>
              ${!showDestinationChain ? '' : `
                <label class="lyra-exec-field">
                  <span class="lyra-rich-label">To</span>
                  ${selectHtml('toNetwork', defaultTo, action === 'bridge' ? bridgeDestinations : networks)}
                </label>
              `}
              <label class="lyra-exec-field lyra-exec-amount-field">
                <span class="lyra-rich-label">Amount</span>
                <input class="lyra-exec-input" type="number" step="any" min="0" name="amount" placeholder="0.0" value="${amount}">
              </label>
              <label class="lyra-exec-field">
                <span class="lyra-rich-label">${showToToken ? 'From asset' : 'Asset'}</span>
                ${selectHtml('tokenSymbol', defaultToken, assets)}
              </label>
              ${!showToToken ? '' : `
                <label class="lyra-exec-field">
                  <span class="lyra-rich-label">To asset</span>
                  ${selectHtml('toTokenSymbol', defaultToToken, assets)}
                </label>
              `}
              ${action === 'send' ? `
                <label class="lyra-exec-field lyra-exec-recipient-field">
                  <span class="lyra-rich-label">Recipient</span>
                  <input class="lyra-exec-input" type="text" name="recipient" placeholder="0x..." value="${recipient}">
                </label>
              ` : ''}
            </div>
            <div class="lyra-exec-inline-status" data-execution-status></div>
            <div class="lyra-action-row lyra-exec-actions">
              <button class="lyra-chip-link primary" type="submit" data-execution-submit="true">${action === 'send' ? 'Send asset' : action === 'bridge' ? 'Bridge now' : 'Swap now'}</button>
              <button class="lyra-chip-link secondary" type="button" data-lyra-action="faucet">Get Gas</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  buildExecutionResultHtml(actionType, payload = {}) {
    const action = String(actionType || '').toLowerCase();
    const amount = payload.amount || payload.fromAmount || '--';
    const token = payload.tokenSymbol || payload.fromToken || 'MNT';
    const fromNetwork = payload.fromNetwork || 'Sepolia';
    const toNetwork = payload.toNetwork || (action === 'send' ? 'External wallet' : 'Mantle Sepolia');
    const recipient = payload.recipient || '';
    const actionUrl = payload.actionUrl || '';
    const actionLabel = payload.actionLabel || '';
    const summary = payload.summary
      || (action === 'send'
        ? `Transfer prepared for ${amount} ${token}.`
        : `${action === 'bridge' ? 'Bridge' : 'Swap'} prepared for ${amount} ${token}.`);
    return `
      <div class="lyra-rich-response lyra-execution-response">
        <div class="lyra-exec-shell">
          <div class="lyra-exec-topline">
            <div class="lyra-rich-label">Ready</div>
            <div class="lyra-exec-title">${summary}</div>
          </div>
          <div class="lyra-exec-summary-grid">
            <div class="lyra-exec-stat"><span class="lyra-rich-label">From</span><strong>${fromNetwork}</strong></div>
            <div class="lyra-exec-stat"><span class="lyra-rich-label">${action === 'send' ? 'Recipient' : 'To'}</span><strong>${action === 'send' ? recipient || 'Required' : toNetwork}</strong></div>
            <div class="lyra-exec-stat"><span class="lyra-rich-label">Amount</span><strong>${amount} ${token}</strong></div>
          </div>
          ${payload.nextStep ? `<div class="lyra-exec-note">${payload.nextStep}</div>` : ''}
          ${actionUrl && actionLabel ? `
            <div class="lyra-action-row lyra-exec-actions">
              <a class="lyra-chip-link primary" href="${actionUrl}" target="_blank" rel="noopener noreferrer">${actionLabel}</a>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  getExecutionNetworkMap() {
    return {
      'Mantle Mainnet': {
        chainId: '0x1388',
        chainName: 'Mantle Mainnet',
        rpcUrls: ['https://rpc.mantle.xyz'],
        nativeCurrency: { name: 'Mantle', symbol: 'MNT', decimals: 18 },
        blockExplorerUrls: ['https://explorer.mantle.xyz']
      },
      'Mantle Sepolia': {
        chainId: '0x138b',
        chainName: 'Mantle Sepolia Testnet',
        rpcUrls: ['https://rpc.sepolia.mantle.xyz'],
        nativeCurrency: { name: 'Mantle', symbol: 'MNT', decimals: 18 },
        blockExplorerUrls: ['https://sepolia.mantlescan.xyz']
      },
      'Sepolia': {
        chainId: '0xaa36a7',
        chainName: 'Sepolia',
        rpcUrls: ['https://rpc.sepolia.org'],
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        blockExplorerUrls: ['https://sepolia.etherscan.io']
      },
      'BSC Testnet': {
        chainId: '0x61',
        chainName: 'BSC Testnet',
        rpcUrls: ['https://data-seed-prebsc-1-s1.binance.org:8545'],
        nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
        blockExplorerUrls: ['https://testnet.bscscan.com']
      },
      'Hyperliquid Testnet': {
        chainId: '0x3e6',
        chainName: 'Hyperliquid Testnet',
        rpcUrls: ['https://rpc.hyperliquid-testnet.xyz/evm'],
        nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
        blockExplorerUrls: ['https://app.hyperliquid-testnet.xyz/explorer']
      }
    };
  }

  getExplorerTransactionUrl(networkLabel, txHash) {
    if (!txHash) return '';
    const target = this.getExecutionNetworkMap()[networkLabel || ''] || null;
    const explorerBase = Array.isArray(target?.blockExplorerUrls) ? target.blockExplorerUrls[0] : '';
    return explorerBase ? `${explorerBase.replace(/\/$/, '')}/tx/${txHash}` : '';
  }

  async renderAgentDecisionsPanel() {
    const panel = document.getElementById('history-panel-list');
    if (!panel || !this.userAddress) return;
    try {
      const response = await fetch(`/api/agent-decisions/${this.userAddress}`);
      const data = await response.json();
      if (!response.ok || !data.ok || !Array.isArray(data.decisions)) {
        return;
      }
      if (!data.decisions.length) {
        panel.innerHTML = '<div class="console-row"><div><strong>No decisions recorded</strong><span>Trigger a scan or ask LYRA to investigate a wallet behavior first.</span></div><code>empty</code></div>';
        return;
      }
      panel.innerHTML = data.decisions.slice(0, 8).map((decision) => `
        <div class="console-row">
          <div>
            <strong>${decision.prompt}</strong>
            <span>${decision.insight || decision.reasoning || 'Decision recorded.'}</span>
          </div>
          <code>${decision.confidenceLabel || 'saved'}</code>
        </div>
      `).join('');
    } catch (_) {}
  }

  async handleLyraAction(actionType, sourceEl = null) {
    if (!actionType) return;
    if (!this.userAddress) {
      this.setSurfaceStatus('Connect a wallet first before LYRA opens execution mode.');
      return;
    }
    if (actionType === 'faucet') {
      const networkLabel = sourceEl?.closest('[data-execution-form]')?.querySelector('[name="fromNetwork"]')?.value || '';
      if (networkLabel === 'Mantle Mainnet') {
        this.setSurfaceStatus('Faucet is only for Sepolia and Mantle Sepolia testnet gas. Mainnet actions need funded wallet gas.');
        return;
      }
      window.open('https://www.mantle.xyz/faucet', '_blank', 'noopener,noreferrer');
      this.setSurfaceStatus('Open the faucet, claim testnet gas, then return here.');
      return;
    }
    const defaults = actionType === 'bridge'
      ? { fromNetwork: 'Sepolia', toNetwork: 'Mantle Sepolia', tokenSymbol: 'ETH' }
      : actionType === 'swap'
        ? { fromNetwork: 'Mantle Mainnet', tokenSymbol: 'MNT', toTokenSymbol: 'ETH' }
        : { fromNetwork: 'Mantle Sepolia', tokenSymbol: 'MNT' };

    try {
      const response = await fetch('/api/action/panel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionType, values: defaults })
      });
      const data = await response.json();
      if (!response.ok || !data.ok || !data.html) {
        throw new Error(data.error || `Could not open ${actionType} panel.`);
      }
      this.addRichAssistantMessage(data.html);
      this.setSurfaceStatus(`${actionType.charAt(0).toUpperCase() + actionType.slice(1)} details ready.`);
    } catch (error) {
      this.setSurfaceStatus(error?.message || `Could not open ${actionType} right now.`);
    }
  }

  async handleExecutionFormChange(form, field) {
    const actionType = String(form?.dataset.executionForm || '').toLowerCase();
    if (!form || !actionType) return;
    if (!['bridge', 'swap', 'send'].includes(actionType)) return;

    if (actionType === 'bridge' && field.name === 'fromNetwork') {
      await this.refreshExecutionPanel(form);
    }
  }

  async refreshExecutionPanel(form) {
    const container = form.closest('.lyra-execution-response');
    if (!container) return;

    const formData = new FormData(form);
    const actionType = String(form.dataset.executionForm || '').toLowerCase();
    const values = {
      fromNetwork: String(formData.get('fromNetwork') || '').trim(),
      toNetwork: String(formData.get('toNetwork') || '').trim(),
      tokenSymbol: String(formData.get('tokenSymbol') || '').trim(),
      toTokenSymbol: String(formData.get('toTokenSymbol') || '').trim(),
      amount: String(formData.get('amount') || '').trim(),
      recipient: String(formData.get('recipient') || '').trim()
    };

    try {
      const response = await fetch('/api/action/panel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionType, values })
      });
      const data = await response.json();
      if (!response.ok || !data.ok || !data.html) {
        throw new Error(data.error || `Could not refresh ${actionType} details.`);
      }
      container.outerHTML = data.html;
    } catch (error) {
      this.setSurfaceStatus(error?.message || `Could not refresh ${actionType} details.`);
    }
  }

  async submitExecutionForm(form) {
    if (!form || !this.userAddress) return;
    const actionType = String(form.dataset.executionForm || '').toLowerCase();
    const formData = new FormData(form);
    const payload = {
      walletAddress: this.userAddress,
      actionType,
      fromNetwork: String(formData.get('fromNetwork') || '').trim(),
      toNetwork: String(formData.get('toNetwork') || '').trim(),
      tokenSymbol: String(formData.get('tokenSymbol') || '').trim(),
      toTokenSymbol: String(formData.get('toTokenSymbol') || '').trim(),
      amount: String(formData.get('amount') || '').trim(),
      recipient: String(formData.get('recipient') || '').trim()
    };

    if (!payload.amount) {
      this.setSurfaceStatus('Enter an amount first.');
      return;
    }
    if (actionType === 'send' && !payload.recipient) {
      this.setSurfaceStatus('Enter the recipient address first.');
      return;
    }

    try {
      this.setExecutionFormBusy(form, true, actionType);
      this.setExecutionFormStatus(
        form,
        actionType === 'send'
          ? 'Preparing transfer details...'
          : actionType === 'bridge'
            ? 'Preparing bridge route...'
            : 'Preparing swap route...'
      );
      const response = await fetch('/api/action/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Action request failed');
      }

      this.setExecutionFormStatus(
        form,
        actionType === 'send'
          ? 'Waiting for wallet signature...'
          : actionType === 'bridge'
            ? 'Bridge route prepared. Waiting for wallet signature...'
            : 'Swap route prepared. Waiting for wallet signature...'
      );
      const intent = data.intent || {};
      const execution = actionType === 'send'
        ? await this.executeDirectSend(payload, intent)
        : await this.executeDirectRoute(payload, intent);
      const txHash = execution?.txHash || execution;
      const confirmed = Boolean(execution?.confirmed);
      const explorerUrl = this.getExplorerTransactionUrl(intent.fromNetwork || payload.fromNetwork, txHash);
      this.addRichAssistantMessage(this.buildExecutionResultHtml(actionType, {
        ...payload,
        ...intent,
        summary: actionType === 'send'
          ? (confirmed ? 'Transfer confirmed.' : 'Transfer submitted.')
          : actionType === 'bridge'
            ? (confirmed ? 'Bridge confirmed.' : 'Bridge submitted.')
            : (confirmed ? 'Swap confirmed.' : 'Swap submitted.'),
        nextStep: confirmed
          ? `Transaction confirmed: ${txHash}`
          : `Transaction submitted: ${txHash}`,
        actionUrl: explorerUrl,
        actionLabel: explorerUrl ? 'View on explorer' : ''
      }));
      this.setExecutionFormStatus(form, '');
      this.setExecutionFormBusy(form, false, actionType);
      this.setSurfaceStatus(`${actionType.charAt(0).toUpperCase() + actionType.slice(1)} ${confirmed ? 'confirmed' : 'submitted'}.`);
    } catch (error) {
      this.setExecutionFormBusy(form, false, actionType);
      this.setExecutionFormStatus(form, error?.message || `Could not execute ${actionType} right now.`, 'error');
      this.setSurfaceStatus(error?.message || `Could not execute ${actionType} right now.`);
      this.addChatMessage('assistant', error?.message || `Could not execute ${actionType} right now.`);
    }
  }

  async ensureExecutionNetwork(provider, networkLabel) {
    const networkMap = this.getExecutionNetworkMap();
    const target = networkMap[networkLabel] || networkMap['Mantle Sepolia'];
    const currentChainId = await provider.request({ method: 'eth_chainId' });
    if (currentChainId === target.chainId) return;
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: target.chainId }]
      });
    } catch (error) {
      const errorMessage = String(error?.message || '').toLowerCase();
      const shouldAddChain = error?.code === 4902
        || errorMessage.includes('unrecognized chain id')
        || errorMessage.includes('unknown chain')
        || errorMessage.includes('wallet_addethereumchain')
        || errorMessage.includes('chain has not been added');
      if (!shouldAddChain) throw error;
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [target]
      });
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: target.chainId }]
      });
    }
  }

  padHexValue(value, bytes = 32) {
    const hex = BigInt(value).toString(16);
    return hex.padStart(bytes * 2, '0');
  }

  padHexAddress(address) {
    return String(address || '').replace(/^0x/i, '').padStart(64, '0');
  }

  buildErc20ApproveData(spender, amount) {
    return `0x095ea7b3${this.padHexAddress(spender)}${this.padHexValue(amount)}`;
  }

  buildErc20TransferData(recipient, amount) {
    return `0xa9059cbb${this.padHexAddress(recipient)}${this.padHexValue(amount)}`;
  }

  buildErc20AllowanceData(owner, spender) {
    return `0xdd62ed3e${this.padHexAddress(owner)}${this.padHexAddress(spender)}`;
  }

  amountToUnits(amount, decimals = 18) {
    const [wholePart, fractionalPart = ''] = String(amount || '0').trim().split('.');
    const whole = wholePart && /^\d+$/.test(wholePart) ? wholePart : '0';
    const normalizedFraction = `${fractionalPart.replace(/\D/g, '')}${'0'.repeat(decimals)}`.slice(0, decimals);
    return (BigInt(whole) * (10n ** BigInt(decimals))) + BigInt(normalizedFraction || '0');
  }

  async waitForTransactionReceipt(provider, txHash, timeoutMs = 180000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const receipt = await provider.request({
        method: 'eth_getTransactionReceipt',
        params: [txHash]
      });
      if (receipt?.blockHash) return receipt;
      await this.sleep(2500);
    }
    throw new Error('Transaction confirmation timed out.');
  }

  async maybeApproveRouteToken(intent, payload) {
    const approvalAddress = intent?.approvalAddress;
    const tokenAddress = String(intent?.fromTokenAddress || '');
    if (!approvalAddress || !tokenAddress || /^0x0{40}$/i.test(tokenAddress)) {
      return null;
    }

    const allowanceHex = await this.activeProvider.request({
      method: 'eth_call',
      params: [{
        to: tokenAddress,
        data: this.buildErc20AllowanceData(this.userAddress, approvalAddress)
      }, 'latest']
    });
    const currentAllowance = BigInt(allowanceHex || '0x0');
    const requiredAmount = this.amountToUnits(payload.amount, Number(intent?.fromTokenDecimals || 18));
    if (currentAllowance >= requiredAmount) {
      return null;
    }

    const approvalTxHash = await this.activeProvider.request({
      method: 'eth_sendTransaction',
      params: [{
        from: this.userAddress,
        to: tokenAddress,
        data: this.buildErc20ApproveData(approvalAddress, requiredAmount),
        value: '0x0'
      }]
    });
    await this.waitForTransactionReceipt(this.activeProvider, approvalTxHash);
    return approvalTxHash;
  }

  async executeDirectRoute(payload, intent) {
    if (!this.activeProvider || !this.userAddress) {
      throw new Error('Connect a wallet first.');
    }
    if (!intent?.transactionRequest?.to) {
      throw new Error('Route transaction data is unavailable for this action.');
    }

    await this.ensureExecutionNetwork(this.activeProvider, intent.fromNetwork || payload.fromNetwork || 'Mantle Sepolia');
    await this.maybeApproveRouteToken(intent, payload);

    const request = intent.transactionRequest;
    const txHash = await this.activeProvider.request({
      method: 'eth_sendTransaction',
      params: [{
        from: this.userAddress,
        to: request.to,
        data: request.data,
        value: request.value || '0x0',
        gas: request.gasLimit || undefined,
        gasPrice: request.gasPrice || undefined
      }]
    });
    try {
      await this.waitForTransactionReceipt(this.activeProvider, txHash);
      return { txHash, confirmed: true };
    } catch (_) {
      return { txHash, confirmed: false };
    }
  }

  async executeDirectSend(payload, intent = {}) {
    if (!this.activeProvider || !this.userAddress) {
      throw new Error('Connect a wallet first.');
    }
    await this.ensureExecutionNetwork(this.activeProvider, intent.fromNetwork || payload.fromNetwork || 'Mantle Sepolia');
    const tokenAddress = String(intent.fromTokenAddress || '');
    const decimals = Number(intent.fromTokenDecimals || 18);
    const amountUnits = this.amountToUnits(payload.amount, decimals);
    if (amountUnits <= 0n) {
      throw new Error('Amount must be greater than zero.');
    }

    if (!payload.recipient || !/^0x[a-fA-F0-9]{40}$/.test(payload.recipient)) {
      throw new Error('Recipient address is invalid.');
    }

    if (!tokenAddress || /^0x0{40}$/i.test(tokenAddress)) {
      const txHash = await this.activeProvider.request({
        method: 'eth_sendTransaction',
        params: [{
          from: this.userAddress,
          to: payload.recipient,
          value: `0x${amountUnits.toString(16)}`
        }]
      });
      try {
        await this.waitForTransactionReceipt(this.activeProvider, txHash);
        return { txHash, confirmed: true };
      } catch (_) {
        return { txHash, confirmed: false };
      }
    }

    const txHash = await this.activeProvider.request({
      method: 'eth_sendTransaction',
      params: [{
        from: this.userAddress,
        to: tokenAddress,
        data: this.buildErc20TransferData(payload.recipient, amountUnits),
        value: '0x0'
      }]
    });
    try {
      await this.waitForTransactionReceipt(this.activeProvider, txHash);
      return { txHash, confirmed: true };
    } catch (_) {
      return { txHash, confirmed: false };
    }
  }

  createThinkingMessage(label = 'Thinking...') {
    const el = document.createElement('div');
    el.className = 'chat-msg assistant';

    const avatar = document.createElement('div');
    avatar.className = 'chat-avatar assistant-avatar';
    avatar.innerHTML = `<img src="${this.lyraAvatarSrc}" alt="LYRA">`;

    const wrap = document.createElement('div');
    const body = document.createElement('div');
    body.className = 'chat-bubble';
    body.innerHTML = `<span class="assistant-thinking">${label}<span class="thinking-dots"><span></span><span></span><span></span></span></span>`;
    wrap.appendChild(body);
    wrap.appendChild(this.createMessageMeta('assistant-timestamp', this.getCurrentTimeLabel()));
    el.appendChild(avatar);
    el.appendChild(wrap);
    this.chatThread?.appendChild(el);
    this.chatThread?.scrollTo({ top: this.chatThread.scrollHeight, behavior: 'smooth' });
    return { el, body };
  }

  async streamBubbleText(body, text) {
    const tokens = String(text || '').split(/(\s+)/).filter((token) => token.length);
    body.textContent = '';
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      body.textContent += token;
      this.chatThread?.scrollTo({ top: this.chatThread.scrollHeight, behavior: 'smooth' });
      if (/\n/.test(token)) {
        await this.sleep(48);
      } else if (token.trim()) {
        await this.sleep(i < 40 ? 18 : 10);
      } else {
        await this.sleep(6);
      }
    }
  }

  handleChatImageSelected(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      this.pendingChatImage = {
        name: file.name,
        dataUrl: String(reader.result || '')
      };
      this.renderComposerAttachmentState();
      this.setSurfaceStatus(`Image attached: ${file.name}. Add a message or send it directly.`);
    };
    reader.readAsDataURL(file);
  }

  renderComposerAttachmentState() {
    if (!this.chatAttachBtn) return;
    this.chatAttachBtn.classList.toggle('attached', Boolean(this.pendingChatImage));
    this.chatAttachBtn.title = this.pendingChatImage ? `Attached: ${this.pendingChatImage.name}` : 'Upload image';
  }

  clearPendingChatImage() {
    this.pendingChatImage = null;
    if (this.chatImageInput) this.chatImageInput.value = '';
    this.renderComposerAttachmentState();
  }

  addUserImageAttachment(image) {
    if (!this.chatThread || !image?.dataUrl) return;
    const el = document.createElement('div');
    el.className = 'chat-msg user';
    const avatar = document.createElement('div');
    avatar.className = 'chat-avatar user-avatar';
    const avatarSrc = this.profileState?.avatarDataUrl || this.defaultAvatarSrc;
    avatar.innerHTML = `<img src="${avatarSrc}" alt="User">`;
    const wrap = document.createElement('div');
    const body = document.createElement('div');
    body.className = 'chat-bubble chat-image-bubble';
    body.innerHTML = `<div class="chat-image-shell"><img src="${image.dataUrl}" alt="${this.escapeHtml(image.name || 'Attached image')}"><div class="chat-image-meta">${this.escapeHtml(image.name || 'Attached image')}</div></div>`;
    wrap.appendChild(body);
    wrap.appendChild(this.createMessageMeta('user-timestamp', this.getCurrentTimeLabel()));
    el.appendChild(avatar);
    el.appendChild(wrap);
    this.chatThread.appendChild(el);
    this.chatThread.scrollTo({ top: this.chatThread.scrollHeight, behavior: 'smooth' });
  }

  normalizeAssistantResponse(text) {
    return String(text || '')
      .replace(/^#{1,6}\s*Insight\s*$/gim, '')
      .replace(/^#{1,6}\s*Reasoning\s*$/gim, '')
      .replace(/^#{1,6}\s*Bottom Line\s*$/gim, 'Bottom line')
      .replace(/^#{1,6}\s*Sources\s*$/gim, 'Sources')
      .replace(/^\s*[-*]\s+\*\*(.*?)\*\*:\s*/gm, '$1: ')
      .replace(/^\s*[-*]\s+/gm, '• ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  pushSystemMessage(text) {
    this.setSurfaceStatus(text);
  }

  setSurfaceStatus(text) {
    const normalized = String(text || '').trim();
    if (!normalized) return;
    const sanitized = normalized
      .replace(/^Portfolio load failed:\s*/i, 'Wallet context unavailable. ')
      .replace(/^Wallet scan failed:\s*/i, 'Wallet scan unavailable. ')
      .replace(/^Chat failed:\s*/i, 'Message failed. ')
      .replace(/^Could not open wallet modal:\s*/i, 'Wallet modal unavailable. ')
      .replace(/\s+/g, ' ')
      .trim();

    const composerHint = document.querySelector('.agent-composer-hint');
    if (composerHint) composerHint.textContent = sanitized;
  }

  async sendMessage(options = {}) {
    const overrideMessage = typeof options.messageOverride === 'string' ? options.messageOverride.trim() : '';
    const message = overrideMessage || this.chatInput?.value.trim();
    const attachedImage = this.pendingChatImage ? { ...this.pendingChatImage } : null;
    if (!message && !attachedImage) return;

    if (this.chatInput) this.chatInput.value = '';
    if (attachedImage) this.clearPendingChatImage();
    if (!options.skipUserEcho) {
      if (message) this.addChatMessage('user', message);
      if (attachedImage) this.addUserImageAttachment(attachedImage);
    }

    const effectiveMessage = message || 'Please review the attached image in context.';
    const thinking = this.createThinkingMessage(this.getThinkingLabelForMessage(effectiveMessage));

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: this.userAddress || null, message: effectiveMessage })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Chat request failed');
      }

      thinking.el.remove();
      if (data.html) {
        this.addRichAssistantMessage(data.html);
      } else {
        const responseText = this.normalizeAssistantResponse(data.response);
        const instantReply = responseText.length <= 180;
        if (instantReply) {
          this.addChatMessage('assistant', responseText, false);
        } else {
          const assistant = this.addChatMessage('assistant', '', true);
          await this.streamBubbleText(assistant.body, responseText);
          assistant.body.style.opacity = '1';
        }
      }

      if (data.snapshot) {
        this.currentSnapshot = data.snapshot;
        this.renderSnapshot();
        this.renderConsolePanels();
      }
      this.setSurfaceStatus('LYRA response ready.');
    } catch (error) {
      thinking.el.remove();
      this.addChatMessage('assistant', 'LYRA could not answer that just now. Try again.', true);
      this.setSurfaceStatus('LYRA could not answer that just now. Try again.');
    }
  }

  handleStarterPrompt(prompt) {
    if (!prompt) return;

    const normalized = prompt.toLowerCase();

    if (!this.userAddress && (normalized.includes('bridge') || normalized.includes('swap') || normalized.includes('send') || normalized.includes('transfer') || normalized.includes('wallet') || normalized.includes('portfolio') || normalized.includes('activity'))) {
      this.setSurfaceStatus('Connect a wallet first for wallet analysis or action preparation.');
      return;
    }

    if (
      normalized.includes('portfolio recently')
    ) {
      this.addChatMessage('user', prompt);
      this.runWalletScan();
      return;
    }

    this.sendMessage({ messageOverride: prompt });
  }

  renderScanFeedStart() {
    if (!this.chatThread || !this.userAddress) return;
    this.chatThread.innerHTML = '';
    this.chatThread.dataset.briefRendered = 'false';
  }

  appendScanFeedLine(text) {
    if (!this.chatThread) return;
    let feed = document.querySelector('.chat-msg.assistant.scan-message');
    if (!feed) {
      const thinking = this.createThinkingMessage(text);
      thinking.el.classList.add('scan-message');
      return;
    }
    const bubble = feed.querySelector('.chat-bubble');
    if (bubble) {
      bubble.innerHTML = `<span class="assistant-thinking">${text}<span class="thinking-dots"><span></span><span></span><span></span></span></span>`;
    }
  }

  renderScanResultsInChat() {
    if (!this.chatThread || !this.currentWalletAnalysis) return;

    const existingScan = document.querySelector('.chat-msg.assistant.scan-message');
    if (existingScan) existingScan.remove();

    const analysis = this.currentWalletAnalysis;
    const holdings = analysis.topHoldings || [];
    const holdingsLabel = holdings.length
      ? holdings.slice(0, 3).map((asset) => `${asset.symbol}${asset.valueUsd ? ` $${Number(asset.valueUsd).toFixed(2)}` : ''}`).join(' / ')
      : 'No visible funded holdings detected yet.';

    const summary = `I’ve finished reading the visible wallet activity.\n\n${analysis.dominantChain || 'Limited chain coverage'} is the strongest network signal right now. I can see ${analysis.transactionCount} transactions across ${analysis.activeChains?.length || 0} chain views, and the clearest holdings are ${holdingsLabel}.\n\nConfidence is ${analysis.walletConfidence?.percent ? `${analysis.walletConfidence.percent}%` : (analysis.walletConfidence?.level || 'limited')}. ${analysis.walletConfidence?.reason || analysis.walletConfidence?.message || 'Additional wallet history would make the read stronger.'}`;
    const assistant = this.addChatMessage('assistant', '', true);
    this.streamBubbleText(assistant.body, summary).then(() => {
      assistant.body.style.opacity = '1';
    });
    this.updateWalletSummaryCard();
    this.setSurfaceStatus('Analysis complete. Ask a follow-up question.');
  }

  seedChat() {
    if (!this.chatThread) return;
    this.chatThread.innerHTML = '';
    this.chatThread.dataset.briefRendered = 'false';
    const greeting = document.createElement('div');
    greeting.className = 'workspace-intro';
    greeting.innerHTML = `
      <div class="workspace-intro-head">
        <div class="workspace-intro-meta">
          <h3>Ask about Mantle routes, strategy, or execution<span class="workspace-cursor"></span></h3>
        </div>
      </div>
      <p>LYRA can scan your wallet, compare Mantle positioning, and prepare supported actions without the usual clutter.</p>
      <div class="workspace-start-label">Suggested Start</div>
      <div class="workspace-prompt-grid">
        <button class="workspace-prompt" type="button" data-starter-prompt="Turn my current wallet into a 2-step Mantle strategy.">Turn my current wallet into a 2-step Mantle strategy.</button>
        <button class="workspace-prompt" type="button" data-starter-prompt="Compare mETH and USDY as a defensive allocation on Mantle.">Compare mETH and USDY as a defensive allocation on Mantle.</button>
        <button class="workspace-prompt" type="button" data-starter-prompt="Show me the top earning opportunities on Mantle right now.">Show me the top earning opportunities on Mantle right now.</button>
        <button class="workspace-prompt" type="button" data-starter-prompt="Bridge 0.01 ETH to Mantle Sepolia.">Bridge 0.01 ETH to Mantle Sepolia.</button>
        <button class="workspace-prompt" type="button" data-starter-prompt="Swap 1 MNT into ETH on Mantle mainnet.">Swap 1 MNT into ETH on Mantle mainnet.</button>
        <button class="workspace-prompt" type="button" data-starter-prompt="Send MNT to a wallet on Mantle Sepolia.">Send MNT to a wallet on Mantle Sepolia.</button>
      </div>
    `;
    this.chatThread.appendChild(greeting);
    this.setSurfaceStatus(this.userAddress ? 'Ask about Mantle opportunities, yields, or wallet activity.' : 'Connect a wallet to begin live analysis.');
  }

  setHeaderTime() {
    const timeEl = document.getElementById('header-time');
    if (!timeEl) return;
    const now = new Date();
    const text = now.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    timeEl.textContent = `Updated ${text}`;
  }
}

function bindLyraGlobals(app) {
  window.lyraApp = app;
  window.lyraOpenAccountEntry = () => window.lyraApp?.openAccountEntry?.();
  window.lyraConnectWallet = () => window.lyraApp?.startWalletSelectionFromLogin?.();
  window.lyraStartGoogleLogin = () => window.lyraApp?.startGoogleLogin?.();
  window.lyraCloseLogin = () => window.lyraApp?.closeLogin?.();
}

function initLyraApp() {
  const app = new LYRAApp();
  bindLyraGlobals(app);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initLyraApp();
  });
} else {
  initLyraApp();
}


