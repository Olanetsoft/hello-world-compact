import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import * as api from './api.js';

const BANNER = `
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║              Midnight Hello World                            ║
║              ────────────────────                            ║
║              Store messages on the blockchain                ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`;

const formatBalance = (balance: bigint) => balance.toLocaleString();

async function main() {
  console.log(BANNER);
  const rl = createInterface({ input, output, terminal: true });

  try {
    // 1. Wallet Setup
    console.log('─── Wallet Setup ───────────────────────────────────────────────\n');
    const choice = await rl.question('  [1] Create new wallet\n  [2] Restore from seed\n  > ');

    const seed = choice.trim() === '2'
      ? await rl.question('\n  Enter seed: ')
      : api.generateNewSeed();

    console.log('\n  Creating wallet...');
    const walletCtx = await api.createWallet(seed);

    console.log('  Syncing with network...');
    const state = await api.waitForSync(walletCtx.wallet);
    const addresses = api.getWalletAddresses(state, walletCtx.unshieldedKeystore);

    console.log(`
─── Wallet Ready ───────────────────────────────────────────────
  Seed: ${seed}

  Unshielded Address: ${addresses.unshielded}
  Balance: ${formatBalance(addresses.balance)} tNight

  Faucet: https://faucet.preprod.midnight.network/
────────────────────────────────────────────────────────────────
`);

    // 2. Wait for funds if needed
    if (addresses.balance === 0n) {
      console.log('  Waiting for funds from faucet...');
      const balance = await api.waitForFunds(walletCtx.wallet);
      console.log(`  Received ${formatBalance(balance)} tNight\n`);
    }

    // 3. Register for DUST
    await api.registerForDust(walletCtx.wallet, walletCtx.unshieldedKeystore);

    // 4. Create providers
    console.log('  Setting up providers...');
    const providers = await api.createProviders(walletCtx);
    console.log('  Ready!\n');

    // 5. Contract Menu
    while (true) {
      const dust = await api.getDustBalance(walletCtx.wallet);
      console.log(`─── Menu ─────────────────────────────────── DUST: ${formatBalance(dust)}`);
      const action = await rl.question('  [1] Deploy new contract\n  [2] Join existing contract\n  [3] Exit\n  > ');

      if (action.trim() === '3') break;

      let contract;
      try {
        if (action.trim() === '1') {
          contract = await api.deployHelloContract(providers);
        } else if (action.trim() === '2') {
          const addr = await rl.question('  Contract address: ');
          contract = await api.joinHelloContract(providers, addr.trim());
        } else {
          continue;
        }
      } catch (e) {
        console.log(`  Error: ${e instanceof Error ? e.message : e}\n`);
        continue;
      }

      // 6. Message Menu
      while (true) {
        const dust = await api.getDustBalance(walletCtx.wallet);
        console.log(`\n─── Contract: ${contract.deployTxData.public.contractAddress.slice(0, 16)}... ─── DUST: ${formatBalance(dust)}`);
        const msgAction = await rl.question('  [1] Store message\n  [2] Read message\n  [3] Back\n  > ');

        if (msgAction.trim() === '3') break;

        try {
          if (msgAction.trim() === '1') {
            const msg = await rl.question('  Message: ');
            await api.storeMessage(contract, msg);
            console.log('  Message stored!\n');
          } else if (msgAction.trim() === '2') {
            const msg = await api.readMessage(providers, contract.deployTxData.public.contractAddress);
            console.log(`  Current message: "${msg ?? '(empty)'}"\n`);
          }
        } catch (e) {
          console.log(`  Error: ${e instanceof Error ? e.message : e}\n`);
        }
      }
    }

    await walletCtx.wallet.stop();
    console.log('\n  Goodbye!\n');
  } finally {
    rl.close();
  }
}

main().catch(console.error);
