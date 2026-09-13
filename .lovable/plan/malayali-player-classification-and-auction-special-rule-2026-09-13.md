# Malayali player classification and auction special rule

## Goal

Add a three-state `malayali` classification to players and an optional auction rule requiring every team to finish with exactly a configured number of Non-Malayali players.

## Player changes

- Add a nullable player classification with two stored values: `Malayali` and `Non-Malayali`; `NULL` represents blank.
- Leave every existing player blank during the migration.
- Add the three options to the create/edit player form and show the classification in the player list.
- Extend the CSV template, preview validation, and import payload with a `malayali` column accepting `Malayali`, `Non-Malayali`, or blank.

## Auction setup

- Add a **Special rules** step immediately after **Captains & Icons** and before **Review**.
- Add a **Non-Malayali players** toggle and a numeric **Players per team** field shown when enabled.
- Persist the enabled state and exact per-team quota on the auction so edit mode restores them.
- In the review step, summarize whether the rule is off or the exact number required per team.
- When enabled, block saving/starting if any selected player is unclassified, the quota is invalid, the selected pool has too few Non-Malayali players, or captain/icon assignments already exceed a team's quota.

## Auction enforcement

- Apply the rule to online and offline auctions in the authoritative bidding functions.
- Count sold captains and icon players toward each team's quota.
- Reject a Non-Malayali bid when that team has already reached its quota.
- Reject a Malayali bid when using that roster slot would leave fewer open slots than the team's remaining Non-Malayali requirement. For example, with two slots left and two Non-Malayali players still required, only Non-Malayali bids are allowed.
- Lock the relevant auction-team row during bid validation so concurrent bids cannot bypass squad or quota checks.
- Keep the existing budget, squad-size, timer, membership, and controller rules unchanged.
- Mirror the server checks in both online manager and offline auctioneer buttons, showing a clear disabled reason; the backend remains authoritative.
- Revalidate the selected pool when bidding starts, preventing an invalid edited or directly modified auction from going live.

## Technical details

- Add a nullable database enum-backed `players.malayali` column and two auction columns for rule activation and quota.
- Update generated database types and every explicit player projection used by forms, imports, auction setup, and live bidding.
- Compute each team's current Non-Malayali count from sold auction-player assignments joined to player classification, avoiding a duplicate counter that could drift.
- Preserve the existing behavior that an admin may manually end an auction. Extra Non-Malayali players can remain unsold after every team reaches its exact quota.

## Validation

- Verify create/edit player and CSV import for all three classification states.
- Verify creating and editing auctions with the rule off and on, including invalid blank classifications and insufficient player supply.
- Verify captain/icon counts affect eligibility.
- Verify online and offline bid buttons and server calls enforce both the quota ceiling and reserved-slot rule.
- Check desktop/mobile auction controls and confirm the app builds cleanly.