import { describe, test, expect, beforeAll } from '@jest/globals';
import * as algokit from '@algorandfoundation/algokit-utils';
import { ClientManager } from '@algorandfoundation/algokit-utils/types/client-manager';
import { makePaymentTxnWithSuggestedParamsFromObject } from 'algosdk';
import { AccountManager } from '@algorandfoundation/algokit-utils/types/account-manager';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { SigningAccount } from '@algorandfoundation/algokit-utils/types/account';
import { AlgoDirectoryClient } from '../contracts/clients/AlgoDirectoryClient';

const CREATOR = 'CREATOR';
const CREATOR_SEGMENT_APPID = 576232891; // test.directory.algo
const DAVE = 'DAVE';
const DAVE_SEGEMENT_APPID = 673442367; // dave.directory.algo
const BETH = 'BETH';
const BETH_SEGMENT_APPID = 606016435; // beth.directory.algo

algokit.Config.configure({
  debug: true, // Only works in NodeJS environment!
  populateAppCallResources: true,
});

const algorand = algokit.AlgorandClient.testNet();

let creatorAccount: SigningAccount;
let daveAppClient: AlgoDirectoryClient;
let deployedAppID: number | bigint;
let deployedAppAddress: string;

describe('AlgoDirectory', () => {
  beforeAll(async () => {
    const accountManager = new AccountManager(new ClientManager({ algod: algorand.client.algod }));
    creatorAccount = (await accountManager.fromEnvironment(CREATOR, new AlgoAmount({ algos: 0 }))).account;
    algorand.setSignerFromAccount(creatorAccount);

    // TODO: Convert this to an idempotent deployment approach so it updates the app in place
    daveAppClient = new AlgoDirectoryClient(
      {
        sender: creatorAccount,
        resolveBy: 'creatorAndName',
        creatorAddress: creatorAccount.addr,
        findExistingUsing: algorand.client.indexer,
      },
      algorand.client.algod
    );

    const result = await daveAppClient.create.createApplication({});
    deployedAppID = result.appId;
    deployedAppAddress = result.appAddress;
    console.debug(`Deployed app at address: ${deployedAppAddress}`);

    // Fund the app MBR
    const payResult = await algorand.send.payment({
      sender: creatorAccount.addr,
      receiver: deployedAppAddress,
      amount: (0.1).algos(),
    });
    console.debug('Payment result: ', payResult.txIds);
  });

  /* ****************
  Positive test cases
  **************** */

  // Create a listing and confirm that the two boxes are created as we expect
  test('createListing', async () => {
    // Dave is going to create a listing for dave.directory.algo
    const accountManager = new AccountManager(new ClientManager({ algod: algorand.client.algod }));
    const daveAccount = (await accountManager.fromEnvironment(DAVE, new AlgoAmount({ algos: 0 }))).account;
    algorand.setSignerFromAccount(daveAccount);
    daveAppClient = new AlgoDirectoryClient(
      {
        sender: daveAccount,
        resolveBy: 'id',
        id: deployedAppID,
      },
      algorand.client.algod
    );

    const suggestedParams = await algorand.getSuggestedParams();
    const payTxn = makePaymentTxnWithSuggestedParamsFromObject({
      from: daveAccount.addr,
      to: deployedAppAddress,
      amount: new AlgoAmount({ microAlgos: 72200 }).microAlgos, // Each listing 72_200 uA
      suggestedParams,
    });

    const result = await daveAppClient.createListing(
      {
        collateralPayment: payTxn,
        nfdAppId: DAVE_SEGEMENT_APPID,
        listingTags: new Uint8Array(13),
      },
      {
        sendParams: { fee: new AlgoAmount({ microAlgos: 2000 }) },
      }
    );
    console.debug('Create txID: ', result.transaction.txID());
    console.debug('Result return value: ', result.return);

    expect(result.confirmations?.length).toBe(2);
    expect(result.confirmation?.confirmedRound).toBeGreaterThan(0);
  });

  // Refresh an existing listing and confirm that the timestamp has been updated
  test('refreshListing', async () => {
    // Dave is going to refresh his listing for dave.directory.algo
    const accountManager = new AccountManager(new ClientManager({ algod: algorand.client.algod }));
    const daveAccount = (await accountManager.fromEnvironment(DAVE, new AlgoAmount({ algos: 0 }))).account;
    algorand.setSignerFromAccount(daveAccount);
    daveAppClient = new AlgoDirectoryClient(
      {
        sender: daveAccount,
        resolveBy: 'id',
        id: deployedAppID,
      },
      algorand.client.algod
    );

    const result = await daveAppClient.refreshListing({
      nfdAppId: DAVE_SEGEMENT_APPID,
    });
    console.debug('Refresh txID: ', result.transaction.txID());
    console.debug('Refresh result: ', result.return);

    expect(result.confirmations?.length).toBe(1);
    expect(result.confirmation?.confirmedRound).toBeGreaterThan(0);
  });

  // Abandon a listing and confirm that the vouched collateral is returned
  test('abandonListing', async () => {
    // Dave is going to abandon his listing for dave.directory.algo
    const accountManager = new AccountManager(new ClientManager({ algod: algorand.client.algod }));
    const daveAccount = (await accountManager.fromEnvironment(DAVE, new AlgoAmount({ algos: 0 }))).account;
    algorand.setSignerFromAccount(daveAccount);
    daveAppClient = new AlgoDirectoryClient(
      {
        sender: daveAccount,
        resolveBy: 'id',
        id: deployedAppID,
      },
      algorand.client.algod
    );

    const result = await daveAppClient.abandonListing(
      {
        nfdAppId: DAVE_SEGEMENT_APPID,
      },
      {
        sendParams: { fee: new AlgoAmount({ microAlgos: 2000 }) },
      }
    );
    console.debug('Abandon txID: ', result.transaction.txID());

    expect(result.confirmations?.length).toBe(1);
    expect(result.confirmation?.confirmedRound).toBeGreaterThan(0);
  });

  // Create a listing, then delete it and confirm that the collateral is sent to the fee sink

  /* ****************
  Negative test cases
  **************** */

  // Attempt to create a listing with insufficient payment; expect failure
  // test("Test description", () => {
  //   const t = () => {
  //     throw new TypeError();
  //   };
  //   expect(t).toThrow(TypeError);
  // });

  // Attempt to CREATE a listing that is not a segment of directory.algo; expect failure

  // Attempt to CREATE a listing for an NFD the caller doesn't own; expect failure (DAVE create for beth.directory.algo)

  // Attempt to CREATE a listing for an expired NFD; expect failure (TBD how to achieve this on testnet with V3 being so new and all NFDs having just been bought)

  // Attempt to REFRESH a listing for an NFD the caller doesn't own; expect failure (DAVE create listing and BETH attempt to refresh it)

  // Attempt to REFRESH a listing with expired NFD; expect failure (TBD how to achieve this on testnet with V3 being so new and all NFDs having just been bought)

  // Attempt to ABANDON a listing that the caller doesn't own; expect failure (DAVE create listing and BETH attempt to abandon it)
});
