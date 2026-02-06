import path from 'node:path';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

export const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');

// Contract configuration
export const contractConfig = {
  privateStateStoreName: 'hello-private-state',
  zkConfigPath: path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'hello'),
};

// Preprod network configuration
export const config = {
  indexer: 'https://indexer.preprod.midnight.network/api/v3/graphql',
  indexerWS: 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
  node: 'https://rpc.preprod.midnight.network',
  proofServer: 'http://127.0.0.1:6300',
};

// Set network ID
setNetworkId('preprod');
