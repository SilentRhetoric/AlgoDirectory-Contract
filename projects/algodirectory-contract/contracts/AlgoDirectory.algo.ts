import { Contract } from '@algorandfoundation/tealscript';

type Listing = {
  timestamp: uint64; // 8 bytes
  vouchAmount: uint64; // 8 bytes
  nfdAppID: uint64; // 8 bytes
  tags: StaticArray<byte, 10>; // 10 bytes
  isDirectorySegment: boolean; // 1 byte
  name: string; // Up to 27 characters, 29 bytes ABI encoded
};

export class AlgoDirectory extends Contract {
  listedNFDappIDs = BoxMap<uint64, undefined>();

  listings = BoxMap<Listing, Address>();

  private checkCallerIsListingOwner(listingKey: Listing): void {
    assert(this.txn.sender === this.listings(listingKey).value, 'Caller must be listing owner');
  }

  /**
   * Creates a listing in the directory by vouching for an NFD root or segment of directory.algo.
   *
   * @param nfdAppId The uint64 application ID of the NFD that will be listed
   * @param collateralPayment The Algo payment of collateral to vouch for the listing
   */
  createListing(nfdAppID: uint64, listingTags: StaticArray<byte, 10>, collateralPayment: PayTxn): void {
    // Check that the caller is paying a mimimum amount of collateral to vouch for the listing
    verifyPayTxn(collateralPayment, {
      sender: this.txn.sender,
      receiver: this.app.address,
      amount: { greaterThan: 1_000_000 },
    });

    // Check in the NFD instance app that the sender is the owner of the NFD
    assert(
      this.txn.sender === (AppID.fromUint64(nfdAppID).globalState('i.owner.a') as Address),
      'Listing creator must be NFD app owner'
    );
    const nfdName = AppID.fromUint64(nfdAppID).globalState('i.name') as string;

    // Check in the NFD registry that this is a valid NFD app ID
    sendAppCall({
      applicationID: AppID.fromUint64(84366825), // Mainnet 760937186
      applicationArgs: ['is_valid_nfd_appid', nfdName, itob(nfdAppID)],
    });
    assert(btoi(this.itxn.lastLog) === 1, 'NFD app ID is invalid');

    // Check that a directory listing for this NFD App ID does not already exist
    assert(!this.listedNFDappIDs(nfdAppID).exists, 'Listing for this NFD already exists');
    const listingKey: Listing = {
      timestamp: globals.latestTimestamp,
      vouchAmount: collateralPayment.amount,
      nfdAppID: nfdAppID,
      tags: listingTags,
      isDirectorySegment: false,
      name: nfdName,
    };
    this.listings(listingKey).value = this.txn.sender;
  }

  /**
   * Refreshes a listing in the directory and updates its last touched timestamp.
   *
   * @param listingKey The box key of the listing to refresh with the current timestamp.
   */
  refreshListing(listingKey: Listing): void {
    this.checkCallerIsListingOwner(listingKey);

    // The new listing box will be swapped for one with a new timestamp in the key struct
    const newListingKey = listingKey;
    newListingKey.timestamp = globals.latestTimestamp;
    this.listings(newListingKey).value = this.txn.sender;

    // Finally, remove the old listing box
    this.listings(listingKey).delete();
  }

  /**
   * Abandons a listing in the directory and returns the vouched collateral.
   *
   * @param listingKey The box key of the listing to abandon and reclaim collateral.
   */
  abandonListing(listingKey: Listing): void {
    this.checkCallerIsListingOwner(listingKey);

    // Remove both boxes for the listing: the NFD App ID and the listing itself
    this.listedNFDappIDs(listingKey.nfdAppID).delete();
    this.listings(listingKey).delete();
    sendPayment({
      sender: this.app.address,
      receiver: this.txn.sender,
      amount: listingKey.vouchAmount,
      fee: 0,
    });
  }

  /**
   * Deletes a listing from the directory & sends the collateral to the fee sink.
   *
   * @param listingKey The box key of the listing to delete.
   */
  deleteListing(listingKey: Listing): void {
    // This method is restricted to only the creator of the directory contract
    verifyAppCallTxn(this.txn, { sender: globals.creatorAddress });

    // Remove both boxes for the listing: the NFD App ID and the listing itself
    this.listedNFDappIDs(listingKey.nfdAppID).delete();
    this.listings(listingKey).delete();

    // Send the vouched collateral to the fee sink
    sendPayment({
      sender: this.app.address,
      receiver: Address.fromAddress('Y76M3MSY6DKBRHBL7C3NNDXGS5IIMQVQVUAB6MP4XEMMGVF2QWNPL226CA'), // Fee sink
      amount: listingKey.vouchAmount,
      fee: 0,
    });
  }
}
