# Hello World - Midnight Compact

A minimal Hello World smart contract for the Midnight blockchain. Deploy to Preprod and store/read messages on-chain.

## Prerequisites

- **Node.js v22+** (`nvm install 22`)
- **Docker** (for proof server)
- **Compact compiler** (`npm install -g @midnight-ntwrk/compact`)

## Quick Start

```bash
# Install dependencies
npm install

# Compile the contract
npm run compile

# Start proof server (runs in background)
npm run proof-server:start

# Deploy to Preprod
npm run deploy

# Interact with deployed contract
npm run cli

# Stop proof server when done
npm run proof-server:stop
```

## Project Structure

```
├── contracts/
│   └── hello-world.compact    # Smart contract source
├── src/
│   ├── deploy.ts              # Deployment script
│   └── cli.ts                 # Interactive CLI
├── docker-compose.yml         # Proof server config
└── package.json
```

## The Contract

```compact
pragma language_version >= 0.20;

import CompactStandardLibrary;

export ledger message: Opaque<"string">;

export circuit storeMessage(newMessage: Opaque<"string">): [] {
  message = disclose(newMessage);
}
```

- `ledger message` - Public on-chain storage for a string
- `storeMessage` - Circuit to update the message

## Commands

| Command | Description |
|---------|-------------|
| `npm run compile` | Compile the Compact contract |
| `npm run deploy` | Deploy contract to Preprod |
| `npm run cli` | Interact with deployed contract |
| `npm run proof-server:start` | Start proof server (Docker) |
| `npm run proof-server:stop` | Stop proof server |

## Deployment Flow

1. **Compile** - Generates ZK circuits in `contracts/managed/`
2. **Start proof server** - Required for generating ZK proofs
3. **Deploy** - Creates wallet, funds via faucet, deploys contract
4. **Interact** - Store and read messages via CLI

## Wallet & Funding

During deployment:
- Choose to create a new wallet or restore from seed
- New wallets generate a 64-character hex seed - **save this!**
- Fund your wallet at: https://faucet.preprod.midnight.network/
- DUST tokens are auto-generated from your tNight balance

## Deployment Output

After deployment, `deployment.json` is created:

```json
{
  "contractAddress": "abc123...",
  "seed": "your-wallet-seed",
  "network": "preprod",
  "deployedAt": "2024-..."
}
```

## Network

This project targets **Preprod** testnet:
- Indexer: `https://indexer.preprod.midnight.network`
- RPC: `https://rpc.preprod.midnight.network`
- Faucet: https://faucet.preprod.midnight.network/

## License

MIT
