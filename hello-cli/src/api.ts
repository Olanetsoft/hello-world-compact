import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { Hello, type HelloPrivateState, witnesses } from 'hello-world-contract';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v7';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { assertIsContractAddress, toHex } from '@midnight-ntwrk/midnight-js-utils';
import { type FinalizedTxData, type MidnightProvider, type WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { HDWallet, Roles, generateRandomSeed } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { createKeystore, InMemoryTransactionHistoryStorage, PublicKey, UnshieldedWallet, type UnshieldedKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { MidnightBech32m, ShieldedAddress, ShieldedCoinPublicKey, ShieldedEncryptionPublicKey } from '@midnight-ntwrk/wallet-sdk-address-format';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { Buffer } from 'buffer';
import * as Rx from 'rxjs';
import { WebSocket } from 'ws';
import { type HelloCircuits, type HelloProviders, type DeployedHelloContract } from './common-types';
import { config, contractConfig } from './config';

// Enable WebSocket for GraphQL subscriptions
// @ts-expect-error: Required for wallet sync
globalThis.WebSocket = WebSocket;

// Compile the contract with ZK circuit assets
const helloCompiledContract = CompiledContract.make('hello', Hello.Contract).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(contractConfig.zkConfigPath),
);

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface WalletContext {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
}

// ─── Contract Operations ───────────────────────────────────────────────────────

export async function deployHelloContract(providers: HelloProviders): Promise<DeployedHelloContract> {
  console.log('  Deploying hello contract...');
  const contract = await deployContract(providers, {
    compiledContract: helloCompiledContract,
    privateStateId: 'helloPrivateState',
    initialPrivateState: {},
  });
  console.log(`  Contract deployed at: ${contract.deployTxData.public.contractAddress}`);
  return contract;
}

export async function joinHelloContract(providers: HelloProviders, contractAddress: string): Promise<DeployedHelloContract> {
  console.log(`  Joining contract at ${contractAddress}...`);
  const contract = await findDeployedContract(providers, {
    contractAddress,
    compiledContract: helloCompiledContract,
    privateStateId: 'helloPrivateState',
    initialPrivateState: {},
  });
  console.log(`  Joined contract successfully`);
  return contract;
}

export async function storeMessage(contract: DeployedHelloContract, message: string): Promise<FinalizedTxData> {
  console.log(`  Storing message: "${message}"...`);
  const result = await contract.callTx.storeMessage(message);
  console.log(`  Transaction ${result.public.txId} added in block ${result.public.blockHeight}`);
  return result.public;
}

export async function readMessage(providers: HelloProviders, contractAddress: ContractAddress): Promise<string | null> {
  assertIsContractAddress(contractAddress);
  const contractState = await providers.publicDataProvider.queryContractState(contractAddress);
  if (contractState) {
    const ledgerState = Hello.ledger(contractState.data);
    return ledgerState.message ? String(ledgerState.message) : null;
  }
  return null;
}

// ─── Wallet Operations ─────────────────────────────────────────────────────────

function deriveKeysFromSeed(seed: string) {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hdWallet.type !== 'seedOk') throw new Error('Invalid seed');

  const result = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);

  if (result.type !== 'keysDerived') throw new Error('Key derivation failed');
  hdWallet.hdWallet.clear();
  return result.keys;
}

function buildWalletConfig() {
  const networkId = getNetworkId();
  return {
    shielded: {
      networkId,
      indexerClientConnection: { indexerHttpUrl: config.indexer, indexerWsUrl: config.indexerWS },
      provingServerUrl: new URL(config.proofServer),
      relayURL: new URL(config.node.replace(/^http/, 'ws')),
    },
    unshielded: {
      networkId,
      indexerClientConnection: { indexerHttpUrl: config.indexer, indexerWsUrl: config.indexerWS },
      txHistoryStorage: new InMemoryTransactionHistoryStorage(),
    },
    dust: {
      networkId,
      costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
      indexerClientConnection: { indexerHttpUrl: config.indexer, indexerWsUrl: config.indexerWS },
      provingServerUrl: new URL(config.proofServer),
      relayURL: new URL(config.node.replace(/^http/, 'ws')),
    },
  };
}

export async function createWallet(seed: string): Promise<WalletContext> {
  const keys = deriveKeysFromSeed(seed);
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());

  const walletConfig = buildWalletConfig();
  const shieldedWallet = ShieldedWallet(walletConfig.shielded).startWithSecretKeys(shieldedSecretKeys);
  const unshieldedWallet = UnshieldedWallet(walletConfig.unshielded).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore));
  const dustWallet = DustWallet(walletConfig.dust).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust);

  const wallet = new WalletFacade(shieldedWallet, unshieldedWallet, dustWallet);
  await wallet.start(shieldedSecretKeys, dustSecretKey);

  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
}

export function generateNewSeed(): string {
  return toHex(Buffer.from(generateRandomSeed()));
}

export async function waitForSync(wallet: WalletFacade) {
  return Rx.firstValueFrom(wallet.state().pipe(Rx.throttleTime(5_000), Rx.filter((s) => s.isSynced)));
}

export async function waitForFunds(wallet: WalletFacade): Promise<bigint> {
  return Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(10_000),
      Rx.filter((s) => s.isSynced),
      Rx.map((s) => s.unshielded.balances[unshieldedToken().raw] ?? 0n),
      Rx.filter((balance) => balance > 0n),
    ),
  );
}

export async function getDustBalance(wallet: WalletFacade): Promise<bigint> {
  const state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  return state.dust.walletBalance(new Date());
}

export async function registerForDust(wallet: WalletFacade, keystore: UnshieldedKeystore): Promise<void> {
  const state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced)));

  if (state.dust.walletBalance(new Date()) > 0n) {
    console.log(`  DUST already available`);
    return;
  }

  const nightUtxos = state.unshielded.availableCoins.filter((coin: any) => !coin.meta?.registeredForDustGeneration);
  if (nightUtxos.length > 0) {
    console.log(`  Registering ${nightUtxos.length} NIGHT UTXO(s) for dust generation...`);
    const recipe = await wallet.registerNightUtxosForDustGeneration(
      nightUtxos,
      keystore.getPublicKey(),
      (payload) => keystore.signData(payload),
    );
    const finalized = await wallet.finalizeRecipe(recipe);
    await wallet.submitTransaction(finalized);
  }

  console.log('  Waiting for dust tokens...');
  await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.filter((s) => s.isSynced),
      Rx.filter((s) => s.dust.walletBalance(new Date()) > 0n),
    ),
  );
  console.log('  DUST tokens available');
}

export function getWalletAddresses(state: any, keystore: UnshieldedKeystore) {
  const networkId = getNetworkId();
  const coinPubKey = ShieldedCoinPublicKey.fromHexString(state.shielded.coinPublicKey.toHexString());
  const encPubKey = ShieldedEncryptionPublicKey.fromHexString(state.shielded.encryptionPublicKey.toHexString());

  return {
    shielded: MidnightBech32m.encode(networkId, new ShieldedAddress(coinPubKey, encPubKey)).toString(),
    unshielded: keystore.getBech32Address(),
    dust: state.dust.dustAddress,
    balance: state.unshielded.balances[unshieldedToken().raw] ?? 0n,
  };
}

// ─── Provider Setup ────────────────────────────────────────────────────────────

// Workaround for wallet SDK signRecipe bug
function signTransactionIntents(tx: { intents?: Map<number, any> }, signFn: (payload: Uint8Array) => ledger.Signature, proofMarker: 'proof' | 'pre-proof'): void {
  if (!tx.intents || tx.intents.size === 0) return;
  for (const segment of tx.intents.keys()) {
    const intent = tx.intents.get(segment);
    if (!intent) continue;
    const cloned = ledger.Intent.deserialize<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>('signature', proofMarker, 'pre-binding', intent.serialize());
    const sigData = cloned.signatureData(segment);
    const signature = signFn(sigData);
    if (cloned.fallibleUnshieldedOffer) {
      const sigs = cloned.fallibleUnshieldedOffer.inputs.map((_: ledger.UtxoSpend, i: number) => cloned.fallibleUnshieldedOffer!.signatures.at(i) ?? signature);
      cloned.fallibleUnshieldedOffer = cloned.fallibleUnshieldedOffer.addSignatures(sigs);
    }
    if (cloned.guaranteedUnshieldedOffer) {
      const sigs = cloned.guaranteedUnshieldedOffer.inputs.map((_: ledger.UtxoSpend, i: number) => cloned.guaranteedUnshieldedOffer!.signatures.at(i) ?? signature);
      cloned.guaranteedUnshieldedOffer = cloned.guaranteedUnshieldedOffer.addSignatures(sigs);
    }
    tx.intents.set(segment, cloned);
  }
}

async function createWalletAndMidnightProvider(ctx: WalletContext): Promise<WalletProvider & MidnightProvider> {
  const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  return {
    getCoinPublicKey: () => state.shielded.coinPublicKey.toHexString(),
    getEncryptionPublicKey: () => state.shielded.encryptionPublicKey.toHexString(),
    async balanceTx(tx, ttl?) {
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      const signFn = (payload: Uint8Array) => ctx.unshieldedKeystore.signData(payload);
      signTransactionIntents(recipe.baseTransaction, signFn, 'proof');
      if (recipe.balancingTransaction) signTransactionIntents(recipe.balancingTransaction, signFn, 'pre-proof');
      return ctx.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx) => ctx.wallet.submitTransaction(tx) as any,
  };
}

export async function createProviders(ctx: WalletContext): Promise<HelloProviders> {
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider<HelloCircuits>(contractConfig.zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider<'helloPrivateState'>({
      privateStateStoreName: contractConfig.privateStateStoreName,
      walletProvider: walletAndMidnightProvider,
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
}
