import { Contract } from '@algorandfoundation/tealscript';

type Listing = {
  timestamp: uint64; // 8 bytes
  vouchAmount: uint64; // 8 bytes
  nfdAppID: uint64; // 8 bytes
  tags: StaticArray<byte, 13>; // 13 bytes, each representing one of 255 possible tags
  name: string; // NFD names are up to 27 characters
}; // 64 bytes total

const LISTED_NFD_APP_ID_BOX_COST = 5700; // 2500 + (400 * (8))
const LISTING_BOX_COST = 40900; // 2500 + (400 * (64 + 32))
const TOTAL_LISTING_BOXES_COST = LISTED_NFD_APP_ID_BOX_COST + LISTING_BOX_COST;

export class AlgoDirectory extends Contract {
  listedNFDappIDs = BoxMap<uint64, bytes<0>>(); // 8 byte key + 0 byte value =  8 bytes total

  listings = BoxMap<Listing, Address>(); // 64 byte key + 32 byte value = 96 bytes total

  private checkCallerIsListingOwner(listingKey: Listing): void {
    assert(this.txn.sender === this.listings(listingKey).value, 'Caller must be listing owner');
  }

  private checkNFDIsSegmentOfDirectory(nfdAppID: uint64): void {
    // Ensure the NFD is a segment of directory.algo by checking the parent appID
    assert(
      btoi(AppID.fromUint64(nfdAppID).globalState('i.parentAppID') as bytes) === 576232821,
      'NFD must be a segment of directory.algo with parent app ID 576232821'
    );
  }

  private checkCallerIsNFDOwner(nfdAppID: uint64): void {
    // Check in the NFD instance app that the sender is the owner of the NFD
    assert(
      this.txn.sender === (AppID.fromUint64(nfdAppID).globalState('i.owner.a') as Address),
      'Listing creator must be the NFD app i.owner.a'
    );
  }

  private checkNFDNotExpired(nfdAppID: uint64): void {
    // Check that the segment is current and not expired
    assert(
      globals.latestTimestamp <= btoi(AppID.fromUint64(nfdAppID).globalState('i.expirationTime') as bytes),
      'NFD segment must not be expired'
    );
  }

  /**
   * Creates a listing in the directory by vouching for an NFD root or segment of directory.algo.
   *
   * @param nfdAppID The uint64 application ID of the NFD that will be listed
   * @param collateralPayment The Algo payment of collateral to vouch for the listing
   */
  createListing(collateralPayment: PayTxn, nfdAppID: uint64, listingTags: StaticArray<byte, 13>): Listing {
    // Check that the caller is paying a mimimum amount of collateral to vouch for the listing
    verifyPayTxn(collateralPayment, {
      sender: this.txn.sender,
      receiver: this.app.address,
      amount: { greaterThan: TOTAL_LISTING_BOXES_COST },
    });

    // Ensure the NFD is a directory.algo segment, the caller owns it, and it is not expired
    this.checkNFDIsSegmentOfDirectory(nfdAppID);
    this.checkCallerIsNFDOwner(nfdAppID);
    this.checkNFDNotExpired(nfdAppID);

    // Check in the NFD registry that this is a valid NFD app ID (not a fake NFD)
    const nfdLongName = AppID.fromUint64(nfdAppID).globalState('i.name') as bytes;

    sendAppCall({
      applicationID: AppID.fromUint64(84366825), // Mainnet 760937186
      applicationArgs: ['is_valid_nfd_appid', nfdLongName, itob(nfdAppID)],
      fee: 0,
    });
    assert(btoi(this.itxn.lastLog) === 1, 'NFD app ID must be valid at the NFD registry');

    // Check that a directory listing for this NFD App ID does not already exist
    assert(!this.listedNFDappIDs(nfdAppID).exists, 'Listing for this NFD must not already exist');

    // Create the listing in the directory
    this.listedNFDappIDs(nfdAppID).create();

    // The NFD name needs to have directory.algo trimmed off the end & padded to 27 bytes
    const nfdSegmentName = substring3(nfdLongName, 0, len(nfdLongName) - 15);

    const listingKey: Listing = {
      timestamp: btoi(replace3(itob(globals.latestTimestamp), 4, bzero(4))), // Round the timestamp down to the 5th byte
      vouchAmount: collateralPayment.amount,
      nfdAppID: nfdAppID,
      tags: listingTags,
      name: nfdSegmentName,
    };
    this.listings(listingKey).value = this.txn.sender;
    return listingKey;
  }

  /**
   * Refreshes a listing in the directory and updates its last touched timestamp.
   *
   * @param listingKey The box key of the listing to refresh with the current timestamp.
   */
  refreshListing(listingKey: Listing): void {
    // Ensure the caller owns this listing, owns the NFD, and the NFD has not expired
    this.checkCallerIsListingOwner(listingKey);
    const nfdAppID = listingKey.nfdAppID;
    this.checkCallerIsNFDOwner(nfdAppID);
    this.checkNFDNotExpired(nfdAppID);

    // The new listing box will be swapped for one with a new timestamp in the key struct
    const newListingKey = clone(listingKey);
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

    // Return the vouched collateral to the listing owner
    sendPayment({
      sender: this.app.address,
      receiver: this.listings(listingKey).value,
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

    // Remove both boxes for the listing
    this.listedNFDappIDs(listingKey.nfdAppID).delete();
    this.listings(listingKey).delete();

    // Yeet the vouched collateral into the fee sink as punishment
    sendPayment({
      sender: this.app.address,
      receiver: Address.fromAddress('Y76M3MSY6DKBRHBL7C3NNDXGS5IIMQVQVUAB6MP4XEMMGVF2QWNPL226CA'), // Fee sink
      amount: listingKey.vouchAmount,
      fee: 0,
    });
  }

  createApplication(): void {}

  updateApplication(): void {
    assert(this.txn.sender === this.app.creator, 'Only the creator can update the application');
  }
}
