import { describe, test, expect, beforeAll } from '@jest/globals';
// import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';
import { ClientManager } from '@algorandfoundation/algokit-utils/types/client-manager';
import { makePaymentTxnWithSuggestedParamsFromObject } from 'algosdk';
import { AccountManager } from '@algorandfoundation/algokit-utils/types/account-manager';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { SigningAccount } from '@algorandfoundation/algokit-utils/types/account';
import { AlgoDirectoryClient } from '../contracts/clients/AlgoDirectoryClient';

const NAME = 'TESTER';

// const fixture = algorandFixture({
//   algodConfig: ClientManager.getAlgoNodeConfig('testnet', 'algod'),
//   indexerConfig: ClientManager.getAlgoNodeConfig('testnet', 'indexer'),
//   // kmd: ClientManager.getKmdClient({
//   //   server: 'http://localhost',
//   //   port: '4002',
//   //   token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
//   // }),
//   testAccountFunding: new AlgoAmount({ algos: 0 }),
// });

algokit.Config.configure({
  debug: true, // Only works in NodeJS environment!
  populateAppCallResources: true,
});

const algorand = algokit.AlgorandClient.testNet();

let testAccount: SigningAccount;
let generatedAppClient: AlgoDirectoryClient;
// let deployedAppAddress: string;

describe('AlgoDirectory', () => {
  // beforeEach(fixture.beforeEach);

  beforeAll(async () => {
    // await fixture.beforeEach();
    // const { algorand } = fixture;
    const accountManager = new AccountManager(new ClientManager({ algod: algorand.client.algod }));
    testAccount = (await accountManager.fromEnvironment(NAME, new AlgoAmount({ algos: 0 }))).account;

    generatedAppClient = new AlgoDirectoryClient(
      {
        sender: testAccount,
        resolveBy: 'id',
        id: 720461229, // Now deployed on Testnet as App ID 720461229
      },
      algorand.client.algod
    );

    // const createResult = await generatedAppClient.create.createApplication({});
    // deployedAppAddress = createResult.appAddress;
  });

  /*
  Positive test cases
  */

  // Create a listing and confirm that the two boxes are created as we expect
  test('createListing', async () => {
    const suggestedParams = await algorand.getSuggestedParams();
    const payTxn = makePaymentTxnWithSuggestedParamsFromObject({
      from: testAccount.addr,
      to: 'SH7EJO4GUJNKCOCLUVPJRROQABM4VSUITV3ILG4RVXDRVW5LRWDGT3YOZQ', // deployedAppAddress,
      amount: new AlgoAmount({ algos: 1 }).microAlgos,
      suggestedParams,
    });

    const result = await generatedAppClient.createListing({
      collateralPayment: payTxn,
      nfdAppId: 576232891,
      listingTags: new Uint8Array(10),
    });
    expect(result.confirmations?.valueOf()).toBe(!null); // TODO
  });

  // Refresh an existing listing and confirm that the timestamp has been updated

  // Abandon a listing and confirm that the vouched collateral is returned

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
