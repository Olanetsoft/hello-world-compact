import { Hello, type HelloPrivateState } from 'hello-world-contract';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { ImpureCircuitId } from '@midnight-ntwrk/compact-js';

export type HelloCircuits = ImpureCircuitId<Hello.Contract<HelloPrivateState>>;

export const HelloPrivateStateId = 'helloPrivateState';

export type HelloProviders = MidnightProviders<HelloCircuits, typeof HelloPrivateStateId, HelloPrivateState>;

export type HelloContract = Hello.Contract<HelloPrivateState>;

export type DeployedHelloContract = DeployedContract<HelloContract> | FoundContract<HelloContract>;
