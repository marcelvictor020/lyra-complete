import { createAppKit } from '@reown/appkit';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { mainnet, mantle, mantleSepoliaTestnet } from '@reown/appkit/networks';

export function createLyraWalletModal({ projectId, metadata, themeVariables = {} }) {
  const networks = [mantle, mantleSepoliaTestnet, mainnet];
  const wagmiAdapter = new WagmiAdapter({
    projectId,
    networks,
    ssr: false
  });

  return createAppKit({
    projectId,
    adapters: [wagmiAdapter],
    networks,
    defaultNetwork: mantle,
    metadata,
    showWallets: true,
    features: {
      analytics: false,
      email: false,
      socials: false
    },
    themeMode: 'dark',
    themeVariables
  });
}
