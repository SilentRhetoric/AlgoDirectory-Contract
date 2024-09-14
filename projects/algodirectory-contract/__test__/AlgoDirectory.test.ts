import { describe, test, expect, beforeAll } from '@jest/globals';
import * as algokit from '@algorandfoundation/algokit-utils';
import { ClientManager } from '@algorandfoundation/algokit-utils/types/client-manager';
import { makePaymentTxnWithSuggestedParamsFromObject } from 'algosdk';
import { AccountManager } from '@algorandfoundation/algokit-utils/types/account-manager';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { SigningAccount } from '@algorandfoundation/algokit-utils/types/account';
import { AlgoDirectoryClient } from '../contracts/clients/AlgoDirectoryClient';

const NAME = 'TESTER';

algokit.Config.configure({
  debug: true, // Only works in NodeJS environment!
  populateAppCallResources: true,
});

const algorand = algokit.AlgorandClient.testNet();

let testAccount: SigningAccount;
let generatedAppClient: AlgoDirectoryClient;
let deployedAppAddress: string;

describe('AlgoDirectory', () => {
  beforeAll(async () => {
    const accountManager = new AccountManager(new ClientManager({ algod: algorand.client.algod }));
    testAccount = (await accountManager.fromEnvironment(NAME, new AlgoAmount({ algos: 0 }))).account;
    algorand.setSignerFromAccount(testAccount);

    // TODO: Convert this to an idempotent deployment approach so it updates the app in place
    generatedAppClient = new AlgoDirectoryClient(
      {
        sender: testAccount,
        resolveBy: 'creatorAndName',
        creatorAddress: testAccount.addr,
        findExistingUsing: algorand.client.indexer,
      },
      algorand.client.algod
    );

    const result = await generatedAppClient.create.createApplication({});
    deployedAppAddress = result.appAddress;
    console.debug(`Deployed app at address: ${deployedAppAddress}`);

    // Fund the app MBR
    const payResult = await algorand.send.payment({
      sender: testAccount.addr,
      receiver: deployedAppAddress,
      amount: (0.1).algos(),
    });
    console.debug('Payment result: ', payResult.txIds);
  });

  /*
  Positive test cases
  */

  // Create a listing and confirm that the two boxes are created as we expect
  test('createListing', async () => {
    const suggestedParams = await algorand.getSuggestedParams();

    const payTxn = makePaymentTxnWithSuggestedParamsFromObject({
      from: testAccount.addr,
      to: deployedAppAddress,
      amount: new AlgoAmount({ microAlgos: 172200 }).microAlgos, // Each listing 57000
      suggestedParams,
    });

    const result = await generatedAppClient.createListing(
      {
        collateralPayment: payTxn,
        nfdAppId: 576232891,
        listingTags: new Uint8Array(13),
      },
      {
        sendParams: { fee: new AlgoAmount({ microAlgos: 2000 }) },
      }
    );

    console.debug('Result return value: ', result.return);

    expect(result.confirmations?.length).toBe(2);
    expect(result.confirmation?.confirmedRound).toBeGreaterThan(0);
  });

  // Refresh an existing listing and confirm that the timestamp has been updated
  test('refreshListing', async () => {
    const result = await generatedAppClient.refreshListing({
      nfdAppId: 576232891,
    });

    console.debug('Refresh txID: ', result.transaction.txID());
    console.debug('Refresh result: ', result.return);

    expect(result.confirmations?.length).toBe(1);
    expect(result.confirmation?.confirmedRound).toBeGreaterThan(0);
  });

  // Abandon a listing and confirm that the vouched collateral is returned
  test('abandonListing', async () => {
    const result = await generatedAppClient.abandonListing(
      {
        nfdAppId: 576232891,
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

  /*
  Negative test cases
  */

  // Attempt to create a listing with insufficient payment; expect failure
  // test("Test description", () => {
  //   const t = () => {
  //     throw new TypeError();
  //   };
  //   expect(t).toThrow(TypeError);
  // });

  // Attempt to create a listing that is not a segment of directory.algo; expect failure

  // Attempt to create a listing for an NFD caller doesn't own; expect failure

  // Attempt to create a listing with expired NFD; expect failure

  // Attempt to refresh a listing that the caller doesn't own; expect failure

  // Attempt to refresh a listing for an NFD that the caller doesn't own; expect failure

  // Attempt to refresh a listing with expired NFD; expect failure

  // Attempt to abandon a listing that the caller doesn't own; expect failure
});
