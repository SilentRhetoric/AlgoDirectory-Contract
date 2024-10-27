# AlgoDirectory Contract

This is the smart contract and associated deployment and testing scripts for the AlgoDirectory.

To learn more about AlgoDirectory, how it works, and its history, visit <https://algodirectory.app/about>.

This work has been performed with support from the Algorand Foundation xGov Grants Program.

## Documentation

For TEALScript documentation, go to https://tealscript.algo.xyz

## Usage

### Environment Setup

NOTE: This contract integrates with NFD, which means that it can only be tested against public networks as there is no NFD registry on Localnet. In order to configure the project for testing against Testnet, update .env.template with account mnemonics and Testnet NFD segment App IDs for three accounts, CREATOR, DAVE, and BETH.

If CREATOR is deploying the contract for the first time, CREATOR may not have an admin token, so let the test run and create an admin asset. Note this ID and add it to the .env file so that it is automatically picked up for subsequent tests.

### Algokit

This template assumes you have a local network running on your machine. The easiet way to setup a local network is with [algokit](https://github.com/algorandfoundation/algokit-cli). If you don't have Algokit or its dependencies installed locally you can open this repository in a GitHub codespace via https://codespaces.new and choosing this repo.

### Build Contract

`npm run build` will compile the contract to TEAL and generate an ABI and appspec JSON in [./contracts/artifacts](./contracts/artifacts/) and a algokit TypeScript client in [./contracts/clients](./contracts/clients/).

`npm run compile-contract` or `npm run generate-client` can be used to compile the contract or generate the contract seperately.

### Run Tests

`npm run test` will execute the tests defined in [./\_\_test\_\_](./__test__)

### Lint

`npm run lint` will lint the contracts and tests with ESLint.

## Contributing

The AlgoDirectory project consists of three repositories:

1. [AlgoDirectory](https://github.com/SilentRhetoric/AlgoDirectory): The web interface for interacting with the Directory
2. [AlgoDirectory-Contract](https://github.com/SilentRhetoric/AlgoDirectory-Contract): This smart contract and associated deployment and testing scripts
3. [AlgoDirectory-Subscriber](https://github.com/SilentRhetoric/AlgoDirectory-Subscriber): A subsriber process that watches the chain for transactions to post on Twitter

We welcome pull requests from community contributors, although we recommend reaching out to us first given the complexity of the project.
