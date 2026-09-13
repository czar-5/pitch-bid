/**
 * Display labels for the player enums.
 *
 * `none` is a real member of the player_role enum (added in migration 20260531025922)
 * meaning "no role recorded", so it must render as nothing rather than the literal word
 * "none". Anywhere that prints `role` raw — e.g. `role.replace(/_/g, " ")` — leaks it.
 */

const ROLE_LABELS: Record<string, string> = {
  batter: "Batter",
  bowler: "Bowler",
  allrounder: "Allrounder",
  batting_allrounder: "Batting Allrounder",
  bowling_allrounder: "Bowling Allrounder",
  wicket_keeper: "Wicket Keeper",
  none: "",
};

const MALAYALI_LABELS: Record<string, string> = {
  malayali: "Malayali",
  non_malayali: "Non-Malayali",
};

/** Human label for a player role. Returns "" when no role is recorded. */
export function roleLabel(role?: string | null): string {
  if (!role) return "";
  // Fall back to de-underscoring an enum value added after this map was written,
  // so a new role shows up readably instead of disappearing.
  return ROLE_LABELS[role] ?? role.replace(/_/g, " ");
}

/** Human label for a Malayali classification. Returns "" when unclassified. */
export function malayaliLabel(value?: string | null): string {
  if (!value) return "";
  return MALAYALI_LABELS[value] ?? value.replace(/_/g, " ");
}

/**
 * Joins a player's descriptive bits with " · ", skipping the empty ones so an
 * unrecorded role does not leave a stray leading separator.
 */
export function playerMetaLine(...parts: Array<string | null | undefined>): string {
  return parts.filter((p) => p && p.trim().length > 0).join(" · ");
}
